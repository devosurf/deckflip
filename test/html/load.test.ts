import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';

async function writeTempDeck(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-load-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf8');
  return file;
}

describe('loadDeck', () => {
  it('splits a single-file deck into slide documents, parses canvas, and reports unknown meta', async () => {
    const file = await writeTempDeck(`<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <title>Sample Deck</title>
    <meta name="deckflip:canvas" content="4:3" />
    <meta name="deckflip:unknown" content="x" />
  </head>
  <body>
    <section id="one"><h1>First</h1></section>
    <section id="two"><h1>Second</h1></section>
  </body>
</html>`);

    const loaded = await loadDeck(file, { size: '1024x768' });
    const first = loaded.documents[0]!;
    const second = loaded.documents[1]!;

    expect(loaded.canvas).toEqual({ width: 1024, height: 768, source: 'flag' });
    expect(loaded.canvasOverridden).toBe(true);
    expect(loaded.title).toBe('Sample Deck');
    expect(loaded.lang).toBe('sv');
    expect(loaded.documents).toHaveLength(2);
    expect(first.inlineSection).toBe(true);
    expect(first.html).toContain('<section id="one"><h1>First</h1></section>');
    expect(first.html).not.toContain('id="two"');
    expect(second.html).toContain('<section id="two"><h1>Second</h1></section>');
    expect(loaded.entries).toEqual([
      {
        code: 'VALIDATE_UNKNOWN_META',
        kind: 'error',
        severity: 'error',
        reason: 'Unknown deck meta deckflip:unknown',
        hint: 'Remove it or check the spelling; known names: deckflip:canvas',
      },
    ]);
  });

  it('keeps deck.html precedence in a directory deck', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-dir-'));
    await writeFile(join(dir, 'deck.html'), `<!doctype html><html><head><title>Deck</title></head><body><section id="deck">deck</section></body></html>`, 'utf8');
    await writeFile(join(dir, 'index.html'), `<!doctype html><html><head><title>Index</title></head><body><section id="index">index</section></body></html>`, 'utf8');

    const loaded = await loadDeck(dir, {});
    const doc = loaded.documents[0]!;
    expect(loaded.documents).toHaveLength(1);
    expect(doc.html).toContain('id="deck"');
    expect(doc.html).not.toContain('id="index"');
  });

  it('rejects script and other non-static elements before anything is measured', async () => {
    const file = await writeTempDeck(`<!doctype html>
<html>
  <head><title>Deck</title><script>document.title = 'changed'</script></head>
  <body>
    <section id="one"><h1>First</h1><iframe id="map" src="x.html"></iframe></section>
    <section id="two"><button class="cta">Go</button><p>text</p></section>
  </body>
</html>`);

    const loaded = await loadDeck(file, {});
    expect(loaded.entries).toEqual([
      { code: 'VALIDATE_ELEMENT', kind: 'error', severity: 'error', locator: { selector: 'script' }, reason: 'script is not static HTML', hint: 'Replace script with static HTML; scripts are never run' },
      { code: 'VALIDATE_ELEMENT', kind: 'error', severity: 'error', slide: 1, locator: { selector: 'iframe#map' }, reason: 'iframe#map is not static HTML', hint: 'Replace iframe#map with static HTML; scripts are never run' },
      { code: 'VALIDATE_ELEMENT', kind: 'error', severity: 'error', slide: 2, locator: { selector: 'button.cta' }, reason: 'button.cta is not static HTML', hint: 'Replace button.cta with static HTML; scripts are never run' },
    ]);
  });

  it('refuses data-raster on a section: a rasterised Slide is a screenshot', async () => {
    const file = await writeTempDeck(`<!doctype html>
<html>
  <head><title>Deck</title></head>
  <body>
    <section id="one"><h1>First</h1></section>
    <section id="two" data-raster><div data-raster class="chart">chart</div></section>
  </body>
</html>`);

    const loaded = await loadDeck(file, {});
    expect(loaded.entries).toEqual([
      { code: 'VALIDATE_RASTER_SLIDE', kind: 'error', severity: 'error', slide: 2, locator: { selector: 'section#two' }, reason: 'data-raster on section#two would rasterise the whole Slide', hint: 'Rasterise parts, not the Slide; use deckflip render for PNGs' },
    ]);
  });
});
