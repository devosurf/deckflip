import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import type { Entry } from '../../src/report/types.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

async function writeTempDeck(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-validate-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf8');
  return file;
}

function deck(head: string, body: string): string {
  return `<!doctype html><html><head><title>Deck</title>${head}</head><body>${body}</body></html>`;
}

function stripHints(entries: Entry[]): Array<Omit<Entry, 'hint'>> {
  return entries.map(({ hint: _hint, ...rest }) => rest);
}

describe.skipIf(!browserAvailable)('measured validation', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  async function measure(html: string) {
    const loaded = await loadDeck(await writeTempDeck(html), {});
    expect(loaded.entries).toEqual([]);
    return measureDeck(loaded, { browser });
  }

  it('rejects text CSS that PowerPoint cannot reproduce, once per declaring element', async () => {
    const measured = await measure(deck(
      `<style>.hy { hyphens: auto } .cols { column-count: 2 } .vert { writing-mode: vertical-rl }</style>`,
      `<section>
        <div class="hy" id="hy"><p>inherits hyphens from the parent</p><p>so does this</p></div>
        <div class="cols" id="cols"><p>two columns</p></div>
        <p class="vert" id="vert">vertical</p>
        <p id="ok">plain</p>
      </section>`,
    ));
    expect(stripHints(measured.entries)).toEqual([
      { code: 'VALIDATE_TEXT_CSS', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#hy' }, reason: 'hyphens: auto on div#hy' },
      { code: 'VALIDATE_TEXT_CSS', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#cols' }, reason: 'column-count: 2 on div#cols' },
      { code: 'VALIDATE_TEXT_CSS', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#vert' }, reason: 'writing-mode: vertical-rl on p#vert' },
    ]);
    expect(measured.entries[0]!.hint).toBe('Remove hyphens: auto: PowerPoint cannot reproduce its line breaks');
  });

  it('rejects fixed and sticky positioning, zoom, and @page', async () => {
    const measured = await measure(deck(
      `<style>@page { margin: 0 } .pin { position: fixed; top: 0 } .stick { position: sticky; top: 0 } .zoomed { zoom: 1.5 }</style>`,
      `<section>
        <div class="pin" id="pin">pinned</div>
        <div class="stick" id="stick">sticky</div>
        <div class="zoomed" id="zoomed"><p>zoomed text</p></div>
      </section>`,
    ));
    expect(stripHints(measured.entries)).toEqual([
      { code: 'VALIDATE_POSITION', kind: 'error', severity: 'error', slide: 1, locator: { selector: 'body > section' }, reason: '@page rule in a stylesheet' },
      { code: 'VALIDATE_POSITION', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#pin' }, reason: 'position: fixed on div#pin' },
      { code: 'VALIDATE_POSITION', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#stick' }, reason: 'position: sticky on div#stick' },
      { code: 'VALIDATE_POSITION', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#zoomed' }, reason: 'zoom: 1.5 on div#zoomed' },
    ]);
    expect(measured.entries[1]!.hint).toBe('Use absolute or flow layout inside the section');
  });
});
