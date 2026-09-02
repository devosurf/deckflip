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
});
