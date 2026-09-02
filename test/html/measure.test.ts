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

function shapeByName(deck: MeasuredDeck, name: string) {
  const shape = deck.slides[0]!.elements.find((element) => element.name === name);
  if (!shape) {
    throw new Error(`Missing shape ${name}`);
  }
  return shape;
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

      const breaks = slide.elements.find((element) => element.name === 'p.breaks')!;
      expect(breaks.text?.paragraphs).toHaveLength(1);
      expect(breaks.text?.paragraphs[0]!.runs.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['a', 'break', 'b']);

      const pre = slide.elements.find((element) => element.name === 'pre.pre')!;
      expect(pre.text?.paragraphs).toHaveLength(2);
      expect(pre.text?.paragraphs[0]!.runs[0]).toMatchObject({ kind: 'text', text: 'line 1' });
      expect(pre.text?.paragraphs[1]!.runs[0]).toMatchObject({ kind: 'text', text: '  line 2' });

      const styled = slide.elements.find((element) => element.name === 'p.styled')!;
      const styledRuns = styled.text?.paragraphs[0]!.runs ?? [];
      expect(styledRuns.map((run) => (run.kind === 'text' ? run.text : 'break'))).toEqual(['A ', 'B ', 'C', ' D\u00A0E']);
      const styledTextRuns = styledRuns.filter((run): run is Extract<typeof run, { kind: 'text' }> => run.kind === 'text');
      expect(styledTextRuns[1]!.style.bold).toBe(true);
      expect(styledTextRuns[2]!.style.bold).toBe(true);
      expect(styledTextRuns[2]!.style.italic).toBe(true);
      expect(styledTextRuns[3]!.text).toBe(' D\u00A0E');

      const rtl = slide.elements.find((element) => element.name === 'p.rtl')!;
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
});
