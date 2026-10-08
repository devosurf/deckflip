import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';
import { launchChromium, renderHtml } from '../../src/render/chromium.js';

/**
 * The wrap-width guard against PowerPoint itself (spec 04): every paragraph of `text/wrap-guard` sits 0.5 px from
 * a line break in Chromium, and its lines must end where Chromium's do in the PowerPoint oracle. Same breaks leave
 * a gap of at most 1 px plus 0.12 px per em of line between the two (spec 04's calibration); a word moved across a
 * break moves a line end by that word, wider than `SAME_BREAK_PX` at these sizes. The corpus gate binds the oracle
 * to the package this version emits (`oracle.json`), so a guard change cannot pass on stale renders.
 */
const FIXTURE = join('fixtures', 'corpus', 'text', 'wrap-guard');
const SAME_BREAK_PX = 6;

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

type Paragraph = { slide: number; left: number; top: number; width: number; height: number; lineHeight: number; font: string };

/** Where the ink of each line slot of each paragraph ends, in CSS px from a 96 dpi render; -1 for an empty slot. */
async function lineEnds(png: Buffer, paragraphs: Paragraph[]): Promise<number[][]> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return paragraphs.map((paragraph) => Array.from({ length: Math.round(paragraph.height / paragraph.lineHeight) }, (_unused, slot) => {
    const from = Math.round(paragraph.top + slot * paragraph.lineHeight + paragraph.lineHeight * 0.2);
    const to = Math.round(paragraph.top + (slot + 1) * paragraph.lineHeight - paragraph.lineHeight * 0.2);
    let end = -1;
    for (let y = from; y <= to && y < image.height; y += 1) {
      for (let x = Math.min(image.width, Math.ceil(paragraph.left + paragraph.width + 20)) - 1; x > Math.max(end, paragraph.left); x -= 1) {
        if (data[(y * image.width + x) * 4]! < 128) {
          end = x;
          break;
        }
      }
    }
    return end;
  }));
}

describe.skipIf(!browserAvailable)('wrap-width guard against the PowerPoint oracle', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchChromium({ offline: true }); });
  afterAll(async () => { await browser.close(); });

  it('ends every line of each near-boundary paragraph in PowerPoint where Chromium ends it', async () => {
    const deck = join(FIXTURE, 'deck.html');
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(deck).href);
    const paragraphs: Paragraph[] = await page.evaluate(() => Array.from(document.querySelectorAll('section')).flatMap((section, index) => {
      const origin = section.getBoundingClientRect();
      return Array.from(section.querySelectorAll('p')).map((p) => {
        const box = p.getBoundingClientRect();
        const style = getComputedStyle(p);
        return { slide: index + 1, left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height, lineHeight: parseFloat(style.lineHeight), font: style.fontFamily };
      });
    }));
    await page.close();
    const chromium = await renderHtml(await loadDeck(deck, {}), { browser, dpi: 96 });
    expect(paragraphs).toHaveLength(16);

    for (const [slide, png] of chromium) {
      const onSlide = paragraphs.filter((paragraph) => paragraph.slide === slide);
      const file = `slide-${String(slide).padStart(3, '0')}.png`;
      const expected = await lineEnds(png, onSlide);
      const actual = await lineEnds(await readFile(join(FIXTURE, 'expected', 'powerpoint', file)), onSlide);
      onSlide.forEach((paragraph, index) => {
        const where = `slide ${slide}, ${paragraph.font}: Chromium ends lines at ${expected[index]!.join(', ')}, PowerPoint at ${actual[index]!.join(', ')}`;
        expect(expected[index]!.filter((end) => end >= 0).length, where).toBeGreaterThanOrEqual(2);
        expected[index]!.forEach((end, line) => {
          expect(actual[index]![line] === -1, where).toBe(end === -1);
          expect(Math.abs(actual[index]![line]! - end), where).toBeLessThanOrEqual(SAME_BREAK_PX);
        });
      });
    }
  });
});
