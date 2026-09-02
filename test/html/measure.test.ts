import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import type { MeasuredDeckResult } from '../../src/html/measure.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

type MeasuredDeck = MeasuredDeckResult['deck'];

function elementByName(deck: MeasuredDeck, name: string) {
  const element = deck.slides[0]!.elements.find((candidate) => candidate.name === name);
  if (!element) {
    throw new Error(`Missing element ${name}`);
  }
  return element;
}

function shapeByName(deck: MeasuredDeck, name: string) {
  const element = elementByName(deck, name);
  if (element.kind !== 'shape') {
    throw new Error(`${name} is a ${element.kind}`);
  }
  return element;
}

function pictureByName(deck: MeasuredDeck, name: string) {
  const element = elementByName(deck, name);
  if (element.kind !== 'picture') {
    throw new Error(`${name} is a ${element.kind}`);
  }
  return element;
}

describe.skipIf(!browserAvailable)('measureDeck', () => {
  it('measures the spike fixture into the expected six shapes and text metrics', async () => {
    const loaded = await loadDeck('test/html/fixtures/spike.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      expect(measured.entries).toEqual([]);
      expect(measured.deck.slides).toHaveLength(1);
      expect(measured.deck.slides[0]!.elements).toHaveLength(6);

      const title = shapeByName(measured.deck, 'h1.title');
      expect(title.box).toEqual({ x: 80, y: 60, w: 1120, h: 80 });
      expect(title.text?.paragraphs[0]!.lineHeight).toBeCloseTo(57.6, 1);
      expect(title.text?.paragraphs[0]!.runs).toHaveLength(1);
      expect(title.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Spike measurement' });

      const body = shapeByName(measured.deck, 'div.body');
      expect(body.box).toEqual({ x: 80, y: 170, w: 560, h: 300 });
      expect(body.fill).toEqual({ type: 'solid', color: { hex: 'F3F4F6', alpha: 1 } });
      expect(body.text?.padding).toEqual({ l: 16, t: 16, r: 16, b: 16 });
      expect(body.text?.paragraphs[0]!.lineHeight).toBeCloseTo(33.6, 1);
      expect(body.text?.paragraphs[0]!.runs).toHaveLength(1);
      expect(body.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Body copy stays editable.' });

      const card = shapeByName(measured.deck, 'div.card');
      expect(card.box).toEqual({ x: 680, y: 170, w: 240, h: 140 });
      expect(card.fill).toEqual({ type: 'solid', color: { hex: '2563EB', alpha: 1 } });
      expect(card.text?.paragraphs[0]!.align).toBe('ctr');
      expect(card.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Centered card' });

      const circle = shapeByName(measured.deck, 'div.circle');
      expect(circle.geometry).toEqual({ preset: 'ellipse' });

      const caption = shapeByName(measured.deck, 'div.caption');
      expect(caption.text?.paragraphs[0]!.align).toBe('r');
      expect(caption.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Caption at right' });

      const footer = shapeByName(measured.deck, 'div.footer');
      expect(footer.text?.paragraphs[0]!.lineHeight).toBeCloseTo(40, 1);
      expect(footer.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Footer line height' });
    } finally {
      await browser.close();
    }
  });

  it('measures text blocks with breaks, preformatted text, nested styles, nbsp, and rtl direction', async () => {
    const loaded = await loadDeck('test/html/fixtures/text.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      const slide = measured.deck.slides[0]!;
      expect(slide.elements).toHaveLength(4);

      const breaks = shapeByName(measured.deck, 'p.breaks');
      expect(breaks.text?.paragraphs).toHaveLength(1);
      expect(breaks.text?.paragraphs[0]!.runs.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['a', 'break', 'b']);

      const pre = shapeByName(measured.deck, 'pre.pre');
      expect(pre.text?.paragraphs).toHaveLength(2);
      expect(pre.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'line 1' });
      expect(pre.text?.paragraphs[1]!.runs[0]).toMatchObject({ kind: 'text', text: '  line 2' });

      const styled = shapeByName(measured.deck, 'p.styled');
      const styledRuns = styled.text?.paragraphs[0]!.runs ?? [];
      expect(styledRuns.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['A ', 'B ', 'C', ' D\u00A0E']);
      const styledTextRuns = styledRuns.filter((run): run is Extract<typeof run, { kind: 'text' }> => run.kind === 'text');
      expect(styledTextRuns[1]!.style.bold).toBe(true);
      expect(styledTextRuns[2]!.style.bold).toBe(true);
      expect(styledTextRuns[2]!.style.italic).toBe(true);
      expect(styledTextRuns[3]!.text).toBe(' D\u00A0E');

      const rtl = shapeByName(measured.deck, 'p.rtl');
      expect(rtl.text?.rtl).toBe(true);
      expect(rtl.text?.paragraphs[0]!.align).toBe('r');
      expect(rtl.text?.paragraphs[0]!.runs.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['אבג ד\u00A0ה']);
    } finally {
      await browser.close();
    }
  });

  it('measures lists as one text body with bullet paragraphs, levels, margins and marker advance', async () => {
    const loaded = await loadDeck('test/html/fixtures/lists.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      expect(measured.entries).toEqual([]);
      const slide = measured.deck.slides[0]!;
      expect(slide.elements).toHaveLength(4);

      const bullets = shapeByName(measured.deck, 'ul.bullets');
      expect(bullets.box).toEqual({ x: 80, y: 40, w: 560, h: bullets.box.h });
      expect(bullets.text?.padding.l).toBe(0);
      const paragraphs = bullets.text!.paragraphs;
      expect(paragraphs.map((p) => p.runs.map((run) => (run.kind === 'text' ? run.text : 'break')).join(''))).toEqual(['First', 'Second', 'Nested one', 'Nested two', 'Third']);
      expect(paragraphs.map((p) => p.level)).toEqual([0, 0, 1, 1, 0]);
      expect(paragraphs.map((p) => p.marginLeft)).toEqual([40, 40, 80, 80, 40]);
      expect(paragraphs.map((p) => p.bullet)).toEqual([
        { type: 'char', char: '•', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 },
        { type: 'char', char: '•', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 },
        { type: 'char', char: '◦', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 },
        { type: 'char', char: '◦', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 },
        { type: 'char', char: '•', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 },
      ]);
      // Arial 24px: "• " advances 0.35em + 0.278em = 15.07px
      expect(paragraphs[0]!.indent).toBeCloseTo(-15.07, 0);
      for (const paragraph of paragraphs) {
        expect(paragraph.lineHeight).toBeCloseTo(28.8, 1);
      }
      expect(paragraphs.map((p) => p.spaceBefore)).toEqual([0, 6, 6, 6, 6]);
      expect(bullets.text?.firstParagraphGap).toBe(6);
      expect(bullets.text?.lastParagraphGap).toBe(6);

      const numbers = shapeByName(measured.deck, 'ol.numbers');
      expect(numbers.text?.paragraphs.map((p) => p.runs.map((run) => (run.kind === 'text' ? run.text : 'break')).join(''))).toEqual(['Alpha', 'Beta']);
      expect(numbers.text?.paragraphs[0]!.bullet).toEqual({ type: 'autonum', scheme: 'alphaLcPeriod', startAt: 3, color: { hex: '111827', alpha: 1 }, sizePct: 100 });
      expect(numbers.text?.paragraphs[0]!.indent).toBeLessThan(0);

      const inside = shapeByName(measured.deck, 'ul.inside');
      // Chromium's inside symbol marker box spans 32 px at Arial 24 px: marL anchors at the text start (40 + 32)
      expect(inside.text?.paragraphs[0]!.marginLeft).toBe(72);
      expect(inside.text?.paragraphs[0]!.indent).toBe(-32);

      const plain = shapeByName(measured.deck, 'ul.plain');
      expect(plain.text?.paragraphs[0]!.bullet).toEqual({ type: 'none' });
      expect(plain.text?.paragraphs[0]!.marginLeft).toBe(0);
      expect(plain.text?.paragraphs[0]!.indent).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it('measures gradient fills and folds opacity into fill, line and run alpha', async () => {
    const loaded = await loadDeck('test/html/fixtures/shapes.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });

      const linear = shapeByName(measured.deck, 'div.linear');
      expect(linear.fill).toEqual({
        type: 'gradient',
        kind: 'linear',
        angle: 135,
        stops: [
          { position: 0, color: { hex: '2563EB', alpha: 1 } },
          { position: 1, color: { hex: '7C3AED', alpha: 0.5 } },
        ],
      });

      const keyword = shapeByName(measured.deck, 'div.keyword');
      expect(keyword.fill).toEqual({
        type: 'gradient',
        kind: 'linear',
        angle: 90,
        stops: [
          { position: 0, color: { hex: 'FF0000', alpha: 1 } },
          { position: 0.3, color: { hex: '00FF00', alpha: 1 } },
          { position: 1, color: { hex: '0000FF', alpha: 1 } },
        ],
      });

      const radial = shapeByName(measured.deck, 'div.radial');
      expect(radial.fill).toEqual({
        type: 'gradient',
        kind: 'radial',
        stops: [
          { position: 0, color: { hex: 'FFFFFF', alpha: 1 } },
          { position: 1, color: { hex: '000000', alpha: 1 } },
        ],
      });
      expect(measured.entries.filter((entry) => entry.code !== 'SUBSTITUTE_BORDER_SIDES')).toEqual([
        expect.objectContaining({ code: 'SUBSTITUTE_GRADIENT_RADIAL', slide: 1, locator: { selector: 'section:nth-of-type(1) > div:nth-child(3)' } }),
        expect.objectContaining({ code: 'SUBSTITUTE_OPACITY', slide: 1, locator: { selector: 'section:nth-of-type(1) > div:nth-child(4)' } }),
        expect.objectContaining({ code: 'SUBSTITUTE_OPACITY', slide: 1, locator: { selector: 'section:nth-of-type(1) > div:nth-child(5) > div:nth-child(1)' } }),
      ]);

      const faded = shapeByName(measured.deck, 'div.faded');
      expect(faded.fill).toEqual({ type: 'solid', color: { hex: 'FF0000', alpha: 0.5 } });
      expect(faded.line).toEqual({ width: 4, color: { hex: '0000FF', alpha: 0.25 }, dash: 'solid' });
      const run = faded.text!.paragraphs[0]!.runs[0]!;
      expect(run.kind === 'text' && run.style.color).toEqual({ hex: '00FF00', alpha: 0.5 });

      const child = shapeByName(measured.deck, 'div.child');
      expect(child.fill).toEqual({ type: 'solid', color: { hex: '000000', alpha: 0.4 } });
    } finally {
      await browser.close();
    }
  });

  it('measures a single spread-free box-shadow as an outer or inner shadow', async () => {
    const loaded = await loadDeck('test/html/fixtures/shapes.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      expect(shapeByName(measured.deck, 'div.shadow').shadow).toEqual({ inset: false, offsetX: 4, offsetY: 6, blur: 12, color: { hex: '000000', alpha: 0.3 } });
      expect(shapeByName(measured.deck, 'div.inset').shadow).toEqual({ inset: true, offsetX: 0, offsetY: 2, blur: 4, color: { hex: '000000', alpha: 1 } });
      expect(shapeByName(measured.deck, 'div.spread').shadow).toBeUndefined();
      expect(shapeByName(measured.deck, 'div.multi').shadow).toBeUndefined();
    } finally {
      await browser.close();
    }
  });

  it('measures per-side borders and per-corner or elliptical radii', async () => {
    const loaded = await loadDeck('test/html/fixtures/shapes.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });

      const sides = shapeByName(measured.deck, 'div.sides');
      expect(sides.line).toBeUndefined();
      expect(sides.borders).toEqual({
        top: { width: 4, color: { hex: 'FF0000', alpha: 1 }, dash: 'solid' },
        left: { width: 2, color: { hex: '0000FF', alpha: 1 }, dash: 'dash' },
      });
      expect(measured.entries).toContainEqual(expect.objectContaining({ code: 'SUBSTITUTE_BORDER_SIDES', locator: { selector: 'section:nth-of-type(1) > div:nth-child(10)' } }));

      expect(shapeByName(measured.deck, 'div.corners').geometry).toEqual({
        preset: 'custom',
        radii: { tl: { x: 20, y: 20 }, tr: { x: 0, y: 0 }, br: { x: 40, y: 40 }, bl: { x: 10, y: 10 } },
      });
      expect(shapeByName(measured.deck, 'div.elliptic').geometry).toEqual({
        preset: 'custom',
        radii: { tl: { x: 30, y: 15 }, tr: { x: 30, y: 15 }, br: { x: 30, y: 15 }, bl: { x: 30, y: 15 } },
      });
      // 120 + 120 > 200 px wide (and > 100 tall): CSS scales every radius by 200 / 240
      expect(shapeByName(measured.deck, 'div.overflowing').geometry).toEqual({
        preset: 'custom',
        radii: { tl: { x: 100, y: 100 }, tr: { x: 100, y: 100 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } },
      });
    } finally {
      await browser.close();
    }
  });

  it('measures transformed elements as their untransformed box plus rotation, translate and scale', async () => {
    const loaded = await loadDeck('test/html/fixtures/shapes.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });

      const rotated = shapeByName(measured.deck, 'div.rotated');
      expect(rotated.box).toEqual({ x: 40, y: 480, w: 200, h: 100 });
      expect(rotated.rotation).toBe(30);

      const moved = shapeByName(measured.deck, 'div.moved');
      expect(moved.box).toEqual({ x: 300, y: 490, w: 200, h: 100 });
      expect(moved.rotation).toBe(345);

      // scale(1.5) about the centre: 200x100 at (520,480) becomes 300x150 centred on (620,530)
      const scaled = shapeByName(measured.deck, 'div.scaled');
      expect(scaled.box).toEqual({ x: 470, y: 455, w: 300, h: 150 });
      expect(scaled.rotation).toBe(0);
      expect(scaled.text?.padding).toEqual({ l: 15, t: 15, r: 15, b: 15 });
      expect(scaled.text?.paragraphs[0]!.lineHeight).toBeCloseTo(43.2, 1);
      const run = scaled.text!.paragraphs[0]!.runs[0]!;
      expect(run.kind === 'text' && run.style.size).toBe(36);

      // rotate(90deg) about the top-left corner: the centre (860,530) maps to (760 - 50, 480 + 100) = (710, 580)
      const cornered = shapeByName(measured.deck, 'div.cornered');
      expect(cornered.box).toEqual({ x: 610, y: 530, w: 200, h: 100 });
      expect(cornered.rotation).toBe(90);
    } finally {
      await browser.close();
    }
  });

  it('measures img and inline svg as pictures with crop, media bytes and format substitutions', async () => {
    const loaded = await loadDeck('test/html/fixtures/pictures.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      const picture = (name: string) => pictureByName(measured.deck, name);

      const plain = picture('img.plain');
      expect(plain.box).toEqual({ x: 40, y: 40, w: 320, h: 200 });
      expect(plain.crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });
      expect(plain.media.contentType).toBe('image/png');
      expect(plain.media.data.length).toBeGreaterThan(0);
      expect(plain.name).toBe('img.plain');

      // 160x100 covering 200x200: painted at 320x200, 60 px cut each side = 0.1875 of the source
      const cover = picture('img.cover');
      expect(cover.box).toEqual({ x: 400, y: 40, w: 200, h: 200 });
      expect(cover.crop).toEqual({ l: 0.1875, t: 0, r: 0.1875, b: 0 });

      // contain at left top: the frame is the fitted 200x125 rect, nothing cropped
      const contain = picture('img.contain');
      expect(contain.box).toEqual({ x: 640, y: 40, w: 200, h: 125 });
      expect(contain.crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });

      // inset(20 40 60 80) on a 320x200 frame: visible 200x120 at (960, 60)
      const clipped = picture('img.clipped');
      expect(clipped.box).toEqual({ x: 960, y: 60, w: 200, h: 120 });
      expect(clipped.crop).toEqual({ l: 0.25, t: 0.1, r: 0.125, b: 0.3 });

      const jpeg = picture('img.jpeg');
      expect(jpeg.media.contentType).toBe('image/jpeg');
      expect(jpeg.line).toEqual({ width: 4, color: { hex: '000000', alpha: 1 }, dash: 'solid' });
      expect(jpeg.geometry).toEqual({ preset: 'roundRect', radius: 12 });
      // the picture frame is the content box inside the border
      expect(jpeg.box).toEqual({ x: 44, y: 304, w: 152, h: 92 });

      const webp = picture('img.webp');
      expect(webp.media.contentType).toBe('image/png');
      expect(webp.opacity).toBe(0.5);

      const gif = picture('img.gif');
      expect(gif.media.contentType).toBe('image/png');

      const svgfile = picture('img.svgfile');
      expect(svgfile.media.contentType).toBe('image/png');
      expect(svgfile.vector?.contentType).toBe('image/svg+xml');
      expect(Buffer.from(svgfile.vector!.data).toString('utf8')).toContain('<circle');

      const inline = picture('svg.inline');
      expect(inline.box).toEqual({ x: 640, y: 300, w: 80, h: 80 });
      expect(inline.media.contentType).toBe('image/png');
      expect(Buffer.from(inline.vector!.data).toString('utf8')).toContain('<rect');

      const rotated = picture('img.rotated');
      expect(rotated.box).toEqual({ x: 840, y: 300, w: 160, h: 100 });
      expect(rotated.rotation).toBe(90);

      expect(measured.deck.slides[0]!.elements.find((element) => element.name === 'img.missing')).toBeUndefined();
      const raised = measured.entries.map((entry) => `${entry.code} ${entry.locator && 'selector' in entry.locator ? entry.locator.selector : ''}`).sort();
      expect(raised).toEqual([
        'SUBSTITUTE_IMAGE_FORMAT section:nth-of-type(1) > img:nth-child(6)',
        'SUBSTITUTE_IMAGE_FORMAT section:nth-of-type(1) > img:nth-child(7)',
        'SUBSTITUTE_OPACITY section:nth-of-type(1) > img:nth-child(6)',
        'SUBSTITUTE_SVG_PICTURE section:nth-of-type(1) > svg:nth-child(9)',
        'VALIDATE_MISSING_ASSET section:nth-of-type(1) > img:nth-child(10)',
      ]);
    } finally {
      await browser.close();
    }
  });

  it('measures tables into a column grid, rows, spans, per-edge borders, fills and cell text', async () => {
    const loaded = await loadDeck('test/html/fixtures/tables.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      const table = elementByName(measured.deck, 'table.grid');
      if (table.kind !== 'table') throw new Error(`table.grid is a ${table.kind}`);

      expect(table.box.x).toBe(40);
      expect(table.box.y).toBe(40);
      expect(table.box.w).toBe(600);
      expect(table.columns).toHaveLength(3);
      expect(table.columns.reduce((sum, w) => sum + w, 0)).toBeCloseTo(600, 0);
      expect(table.rows).toHaveLength(5);
      expect(table.rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(table.box.h, 0);
      expect(table.rows[3]!.height).toBeGreaterThanOrEqual(80);

      const header = table.rows[0]!.cells[0]!;
      expect(header.fill).toEqual({ type: 'solid', color: { hex: 'E2E8F0', alpha: 1 } });
      expect(header.padding).toEqual({ l: 12, t: 8, r: 12, b: 8 });
      expect(header.borders.top).toEqual({ width: 1, color: { hex: '94A3B8', alpha: 1 }, dash: 'solid' });
      expect(header.anchor).toBe('t');
      const headerRun = header.text.paragraphs[0]!.runs[0]!;
      expect(headerRun.kind === 'text' && headerRun.text).toBe('Item');
      expect(headerRun.kind === 'text' && headerRun.style.bold).toBe(true);

      const price = table.rows[1]!.cells[2]!;
      expect(price.text.paragraphs[0]!.align).toBe('r');
      expect(price.anchor).toBe('b');

      // rowspan=2 on the first body cell: the cell below it is a vertical continuation
      const widget = table.rows[1]!.cells[0]!;
      expect(widget.rowSpan).toBe(2);
      expect(widget.text.paragraphs[0]!.runs.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['Widget ', 'A']);
      expect(table.rows[2]!.cells[0]!.merged).toBe('v');
      expect(table.rows[2]!.cells).toHaveLength(3);

      // colspan=2: the second cell is a horizontal continuation; p + ul give two paragraphs
      const merged = table.rows[3]!.cells[0]!;
      expect(merged.colSpan).toBe(2);
      expect(table.rows[3]!.cells[1]!.merged).toBe('h');
      expect(merged.text.paragraphs.map((p) => p.runs.map((run) => (run.kind === 'text' ? run.text : 'break')).join(''))).toEqual(['Merged cell', 'with a list']);
      expect(merged.text.paragraphs[1]!.bullet).toEqual({ type: 'char', char: '•', color: { hex: '111827', alpha: 1 }, sizePct: 100 });

      const total = table.rows[4]!.cells[0]!;
      expect(total.borders.top).toEqual({ width: 3, color: { hex: '0F172A', alpha: 1 }, dash: 'solid' });
      expect(total.fill).toEqual({ type: 'solid', color: { hex: 'FEF3C7', alpha: 1 } });

      // caption becomes a separate text box; borderless cells have no borders
      const caption = shapeByName(measured.deck, 'caption');
      expect(caption.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'Figure 1' });
      const captioned = elementByName(measured.deck, 'table.caption');
      if (captioned.kind !== 'table') throw new Error('table.caption is not a table');
      expect(captioned.rows[0]!.cells[0]!.borders).toEqual({});

      expect(measured.entries.map((entry) => entry.code)).toEqual(['VALIDATE_TABLE_CONTENT']);
      expect(measured.entries[0]!.locator).toEqual({ selector: 'section:nth-of-type(1) > table:nth-child(3) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1)' });
    } finally {
      await browser.close();
    }
  });

  it('measures data-group containers as groups of their painting descendants, nesting allowed', async () => {
    const loaded = await loadDeck('test/html/fixtures/groups.html', {});
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(loaded, { browser });
      expect(measured.entries).toEqual([]);
      const elements = measured.deck.slides[0]!.elements;
      // the empty group emits nothing
      expect(elements.map((element) => `${element.kind} ${element.name}`)).toEqual(['group div.card', 'group div.wrapper', 'group div.rotated']);

      // a painting container with data-group: its own shape is the first child of the group
      const card = elements[0]!;
      if (card.kind !== 'group') throw new Error('card is not a group');
      expect(card.box).toEqual({ x: 40, y: 40, w: 300, h: 200 });
      expect(card.rotation).toBe(0);
      expect(card.children.map((child) => `${child.kind} ${child.name}`)).toEqual(['shape div.card', 'shape h2', 'shape div.badge']);
      // children keep slide coordinates
      expect(card.children[2]!.box).toEqual({ x: 259, y: 189, w: 60, h: 30 });

      // a layout-only wrapper emits no shape of its own; nested groups nest
      const wrapper = elements[1]!;
      if (wrapper.kind !== 'group') throw new Error('wrapper is not a group');
      expect(wrapper.box).toEqual({ x: 400, y: 40, w: 250, h: 200 });
      expect(wrapper.children.map((child) => `${child.kind} ${child.name}`)).toEqual(['shape div.inner', 'group div.nested']);
      const nested = wrapper.children[1]!;
      if (nested.kind !== 'group') throw new Error('nested is not a group');
      expect(nested.box).toEqual({ x: 550, y: 140, w: 100, h: 100 });
      expect(nested.children).toHaveLength(2);

      // a rotated group: children measured untransformed; the union box (centre 850,90) rotates 20deg about the
      // container centre (900,90): centre -> (853.02, 72.9)
      const rotated = elements[2]!;
      if (rotated.kind !== 'group') throw new Error('rotated is not a group');
      expect(rotated.rotation).toBe(20);
      expect(rotated.childBox).toEqual({ x: 800, y: 40, w: 100, h: 100 });
      expect(rotated.box.x).toBeCloseTo(803.02, 1);
      expect(rotated.box.y).toBeCloseTo(72.9 - 50, 1);
      expect(rotated.box.w).toBe(100);
      expect(rotated.children[0]!.box).toEqual({ x: 800, y: 40, w: 100, h: 100 });
    } finally {
      await browser.close();
    }
  });
});
