import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import type { MeasuredDeckResult } from '../../src/html/measure.js';
import type { Element, PictureElement } from '../../src/model/index.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

async function writeTempDeck(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-raster-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf8');
  return file;
}

function deck(css: string, body: string): string {
  return `<!doctype html><html><head><title>Deck</title><style>${css}</style></head><body>${body}</body></html>`;
}

function pictureBySelector(measured: MeasuredDeckResult, selector: string): PictureElement {
  const find = (elements: Element[]): PictureElement | undefined => {
    for (const element of elements) {
      if (element.kind === 'picture' && element.selector === selector) return element;
      if (element.kind === 'group') {
        const nested = find(element.children);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const picture = find(measured.deck.slides.flatMap((slide) => slide.elements));
  if (!picture) throw new Error(`No picture for ${selector}`);
  return picture;
}

async function pixels(png: Uint8Array): Promise<{ width: number; height: number; at: (x: number, y: number) => [number, number, number, number] }> {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => {
      const i = (y * image.width + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    },
  };
}

describe.skipIf(!browserAvailable)('raster pass', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  async function measure(html: string, rasterDpi = 192) {
    const loaded = await loadDeck(await writeTempDeck(html), {});
    expect(loaded.entries).toEqual([]);
    return measureDeck(loaded, { browser, rasterDpi });
  }

  it('rasterises a text-free element with a CSS filter as one isolated picture at the raster DPI', async () => {
    const measured = await measure(deck(
      `section { background: #f00 }
       .badge { position: absolute; left: 100px; top: 50px; width: 200px; height: 100px; border-radius: 50%; background: #00f; filter: grayscale(1) }
       .badge span { display: block; width: 20px; height: 20px; background: #0f0 }`,
      `<section><div class="badge" id="badge"><span></span></div><p id="text">Text stays native</p></section>`,
    ));

    expect(measured.entries).toEqual([
      {
        code: 'RASTER_CSS_FILTER',
        kind: 'rasterised',
        severity: 'warning',
        slide: 1,
        locator: { selector: '#badge' },
        reason: 'filter: grayscale(1) on div#badge has no DrawingML equivalent',
        hint: 'Move filter: grayscale(1) onto a background image, or accept the picture with data-raster',
      },
    ]);

    const slide = measured.deck.slides[0]!;
    expect(slide.elements.map((element) => [element.kind, element.selector])).toEqual([
      ['shape', 'section:nth-of-type(1)'],
      ['picture', '#badge'],
      ['shape', '#text'],
    ]);

    const picture = pictureBySelector(measured, '#badge');
    expect(picture.box).toEqual({ x: 100, y: 50, w: 200, h: 100 });
    expect(picture.rotation).toBe(0);
    expect(picture.source).toBe('raster');
    expect(picture.explicit).toBe(false);
    expect(picture.media.contentType).toBe('image/png');

    const png = await pixels(picture.media.data);
    expect([png.width, png.height]).toEqual([400, 200]);
    // centre: grayscale of #00f; the child box sits at the top-left corner, the bottom-right corner is outside the
    // ellipse, so it is transparent rather than the section's red
    expect(png.at(200, 100).slice(0, 3).every((channel) => channel < 40)).toBe(true);
    expect(png.at(200, 100)[3]).toBe(255);
    // the child box is part of the same picture, filtered with it (grayscale of #0f0 ~ 182)
    expect(png.at(20, 20)).toEqual([182, 182, 182, 255]);
    expect(png.at(397, 197)[3]).toBe(0);
  });

  it('flattens the same trigger on a text-bearing element: the text stays a native shape', async () => {
    const measured = await measure(deck(
      `.hero { position: absolute; left: 100px; top: 50px; width: 400px; height: 100px; background: #00f; filter: blur(2px) }`,
      `<section><div class="hero" id="hero"><p>Still editable</p></div></section>`,
    ));
    expect(measured.entries).toEqual([
      {
        code: 'FLATTEN_CSS_FILTER',
        kind: 'flattened',
        severity: 'warning',
        slide: 1,
        locator: { selector: '#hero' },
        reason: 'filter: blur(2px) on div#hero cannot be applied to editable text',
        hint: 'filter: blur(2px) was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
      },
    ]);
    const hero = measured.deck.slides[0]!.elements[0]!;
    expect(hero.kind).toBe('shape');
    expect(hero.kind === 'shape' && hero.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Still editable' });
    expect(hero.kind === 'shape' && hero.fill).toEqual({ type: 'solid', color: { hex: '0000FF', alpha: 1 } });
  });

  it('rasterises a data-raster subtree text and all, as an info entry', async () => {
    const measured = await measure(deck(
      `.chart { position: absolute; left: 40px; top: 40px; width: 300px; height: 200px; background: #fff }
       .bar { position: absolute; bottom: 0; width: 40px; background: #0a0 }`,
      `<section><div class="chart" id="chart" data-raster><div class="bar" style="left:20px;height:80px"></div><div class="bar" style="left:80px;height:140px"></div><p>Q1 Q2</p></div><p id="after">after</p></section>`,
    ));
    expect(measured.entries).toEqual([
      {
        code: 'RASTER_EXPLICIT',
        kind: 'rasterised',
        severity: 'info',
        slide: 1,
        locator: { selector: '#chart' },
        reason: 'data-raster on div#chart',
        hint: '(info) Remove data-raster to get editable objects',
      },
    ]);
    expect(measured.deck.slides[0]!.elements.map((element) => [element.kind, element.selector])).toEqual([
      ['picture', '#chart'],
      ['shape', '#after'],
    ]);
    const picture = pictureBySelector(measured, '#chart');
    expect(picture.explicit).toBe(true);
    expect(picture.box).toEqual({ x: 40, y: 40, w: 300, h: 200 });
    const png = await pixels(picture.media.data);
    // the tallest bar: left 80..120, bottom 200, height 140 -> (100, 130) CSS px is green
    expect(png.at(200, 260)).toEqual([0, 170, 0, 255]);
  });

  it('adds no entries for triggers nested inside an already rasterised subtree', async () => {
    const measured = await measure(deck(
      `.outer { position: absolute; left: 0; top: 0; width: 200px; height: 200px; background: #ccc; mix-blend-mode: multiply }
       .inner { width: 50px; height: 50px; background: #f00; filter: blur(1px) }`,
      `<section><div class="outer" id="outer"><div class="inner" id="inner"></div></div></section>`,
    ));
    expect(measured.entries.map((entry) => [entry.code, entry.locator])).toEqual([['RASTER_BLEND_MODE', { selector: '#outer' }]]);
    expect(measured.deck.slides[0]!.elements).toHaveLength(1);
  });

  it('grows the clip to the painted overflow of shadows and clips it to the Canvas', async () => {
    const measured = await measure(deck(
      `.glow { position: absolute; left: 10px; top: 20px; width: 100px; height: 60px; background: #00f; box-shadow: 0 0 10px 5px #000, 0 0 0 30px #f00 }`,
      `<section><div class="glow" id="glow"></div></section>`,
    ));
    expect(measured.entries.map((entry) => entry.code)).toEqual(['RASTER_SHADOW']);
    const picture = pictureBySelector(measured, '#glow');
    // 30px of red ring on every side, clipped by the Canvas edge at x = 0 and y = 0
    expect(picture.box).toEqual({ x: 0, y: 0, w: 140, h: 110 });
    const png = await pixels(picture.media.data);
    expect(png.at(4, 4)).toEqual([255, 0, 0, 255]);
  });

  it.each([
    ['backdrop-filter: blur(4px)', 'RASTER_BACKDROP_FILTER', 'backdrop-filter: blur(4px)'],
    ['mix-blend-mode: multiply', 'RASTER_BLEND_MODE', 'mix-blend-mode: multiply'],
    ['mask-image: linear-gradient(#000, transparent)', 'RASTER_MASK', 'mask-image: linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))'],
    ['clip-path: circle(40%)', 'RASTER_CLIP_PATH', 'clip-path: circle(40%)'],
    ['background: conic-gradient(#f00, #00f)', 'RASTER_GRADIENT', 'background-image: conic-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'],
    ['background: repeating-linear-gradient(#f00 0 10px, #00f 10px 20px)', 'RASTER_GRADIENT', 'background-image: repeating-linear-gradient(rgb(255, 0, 0) 0px, rgb(255, 0, 0) 10px, rgb(0, 0, 255) 10px, rgb(0, 0, 255) 20px)'],
    ['background: linear-gradient(#f00, #00f), linear-gradient(#0f0, #000)', 'RASTER_GRADIENT', 'background-image: linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255)), linear-gradient(rgb(0, 255, 0), rgb(0, 0, 0))'],
    ['box-shadow: 0 0 4px 3px #000', 'RASTER_SHADOW', 'box-shadow: rgb(0, 0, 0) 0px 0px 4px 3px'],
    ['border: 6px double #000', 'RASTER_BORDER_STYLE', 'border-top-style: double'],
    ['border: 6px solid; border-image: linear-gradient(#f00, #00f) 1', 'RASTER_BORDER_IMAGE', 'border-image: linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'],
    ['transform: skewX(20deg)', 'RASTER_TRANSFORM', 'transform: matrix(1, 0, 0.36397, 1, 0, 0)'],
    ['transform: rotateX(45deg)', 'RASTER_TRANSFORM', 'transform: matrix3d(1, 0, 0, 0, 0, 0.707107, 0.707107, 0, 0, -0.707107, 0.707107, 0, 0, 0, 0, 1)'],
    ['outline: 3px solid #000; outline-offset: 4px', 'RASTER_OUTLINE', 'outline: 3px solid rgb(0, 0, 0); outline-offset: 4px'],
  ])('rasterises a text-free element with %s', async (css, code, decl) => {
    const measured = await measure(deck(
      `.box { position: absolute; left: 100px; top: 100px; width: 200px; height: 100px; background: #eee; ${css} }`,
      `<section><div class="box" id="box"></div></section>`,
    ));
    expect(measured.entries.map((entry) => [entry.code, entry.reason])).toEqual([[code, `${decl} on div#box has no DrawingML equivalent`]]);
    expect(pictureBySelector(measured, '#box').source).toBe('raster');
  });

  it('maps native effects without entries: rotate, single shadow, inset clip on img, uniform outline', async () => {
    const measured = await measure(deck(
      `.a { position: absolute; left: 100px; top: 100px; width: 200px; height: 100px; background: #eee; transform: rotate(10deg) translate(4px, 0) scale(1.1); box-shadow: 2px 2px 6px rgba(0,0,0,.5) }
       .b { position: absolute; left: 400px; top: 100px; width: 200px; height: 100px; background: linear-gradient(#f00, #00f); border: 2px dashed #000 }`,
      `<section><div class="a" id="a"></div><div class="b" id="b"></div></section>`,
    ));
    expect(measured.entries).toEqual([]);
    expect(measured.deck.slides[0]!.elements.map((element) => element.kind)).toEqual(['shape', 'shape']);
  });

  it('flattens text effects PowerPoint lacks, once per declaring element, and animations as info', async () => {
    const measured = await measure(deck(
      `@keyframes pulse { to { opacity: .5 } }
       .stroke { -webkit-text-stroke: 1px #000 }
       .clip { background: linear-gradient(#f00, #00f); -webkit-background-clip: text; background-clip: text; color: transparent }
       .wavy { text-decoration: underline wavy }
       .caps { font-variant-caps: all-small-caps }
       .shadows { text-shadow: 1px 1px 0 #000, 2px 2px 0 #f00 }
       .anim { animation: pulse 1s infinite }
       .fade { transition: opacity 300ms }`,
      `<section>
        <p class="stroke" id="stroke">stroked <span>inherits</span></p>
        <p class="clip" id="clip">clipped</p>
        <p class="wavy" id="wavy">wavy</p>
        <p class="caps" id="caps">caps</p>
        <p class="shadows" id="shadows">shadows</p>
        <div class="anim" id="anim"><p>animated</p></div>
        <p class="fade" id="fade">fading</p>
        <video id="clip-1" src="movie.mp4"></video>
      </section>`,
    ));
    expect(measured.entries.map((entry) => [entry.code, entry.severity, entry.locator, entry.reason])).toEqual([
      ['FLATTEN_TEXT_STROKE', 'warning', { selector: '#stroke' }, '-webkit-text-stroke: 1px rgb(0, 0, 0) on p#stroke'],
      ['FLATTEN_TEXT_BACKGROUND_CLIP', 'warning', { selector: '#clip' }, 'background-clip: text on p#clip'],
      ['FLATTEN_TEXT_DECORATION_STYLE', 'warning', { selector: '#wavy' }, 'text-decoration-style: wavy on p#wavy'],
      ['FLATTEN_TEXT_FONT_VARIANT', 'warning', { selector: '#caps' }, 'font-variant-caps: all-small-caps on p#caps'],
      ['FLATTEN_TEXT_SHADOW_MULTI', 'warning', { selector: '#shadows' }, 'text-shadow: rgb(0, 0, 0) 1px 1px 0px, rgb(255, 0, 0) 2px 2px 0px on p#shadows'],
      ['FLATTEN_ANIMATION', 'info', { selector: '#anim' }, 'animation: pulse on div#anim'],
      ['FLATTEN_ANIMATION', 'info', { selector: '#fade' }, 'transition: opacity 0.3s on p#fade'],
      ['FLATTEN_MEDIA_POSTER', 'warning', { selector: '#clip-1' }, 'video#clip-1 has no poster'],
    ]);
  });
});
