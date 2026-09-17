import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { convertHtmlToPptx } from '../../src/convert.js';
import { parsePptx } from '../../src/parse/index.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-embedded-'));
  directories.push(dir);
  return dir;
}

function deckHtml(slides: string[]): string {
  return `<!doctype html><html><head><meta name="deckflip:canvas" content="1280x720">
    <style>* { box-sizing: border-box; margin: 0; padding: 0 }
    img, .fill { position: absolute; left: 40px; top: 40px; width: 160px; height: 100px }
    .fill { top: 200px; background-size: cover; background-repeat: no-repeat }
    </style></head><body>${slides.map((slide) => `<section>${slide}</section>`).join('')}</body></html>`;
}

async function pixels(bytes: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
}

describe.skipIf(!browserAvailable)('embedded image conversion', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });
  const options = { embedFonts: false as const, rasterDpi: 96, offline: true, strict: true };

  it('emits the same PNG and JPEG content and geometry for embedded pictures, fills, and local controls', async () => {
    const dir = await workspace();
    const sources: { bytes: Buffer; type: string; file: string }[] = [
      { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64'), type: 'image/png', file: 'pixel.png' },
      { bytes: await readFile('test/html/fixtures/assets/quad.png'), type: 'image/png', file: 'quad.png' },
      { bytes: await readFile('test/html/fixtures/assets/quad.jpg'), type: 'image/jpeg', file: 'quad.jpg' },
    ];
    const slides: string[] = [];
    for (const source of sources) {
      await writeFile(join(dir, source.file), source.bytes);
      // Exercise both data-URL byte encodings, including non-UTF8 image bytes.
      for (const url of [source.file, `data:${source.type};base64,${source.bytes.toString('base64')}`,
        `data:${source.type},${Array.from(source.bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')}`]) {
        slides.push(`<img src="${url}"><div class="fill" style="background-image: url('${url}')"></div>`);
      }
    }
    const input = join(dir, 'images.html');
    await writeFile(input, deckHtml(slides));
    const result = await convertHtmlToPptx(input, { ...options, browser });
    expect(result.report.entries).toEqual([]);
    expect(result.exitCode).toBe(0);
    const deck = await parsePptx(await readFile(result.outputPath));
    expect(deck.slides).toHaveLength(9);
    for (const [index, slide] of deck.slides.entries()) {
      const source = sources[Math.floor(index / 3)]!;
      const picture = slide.elements.find((el) => el.kind === 'picture');
      const fill = slide.elements.find((el) => el.kind === 'shape' && el.fill?.type === 'image');
      expect(picture?.box).toEqual({ x: 40, y: 40, w: 160, h: 100 });
      expect(picture?.crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });
      expect(fill?.box).toEqual({ x: 40, y: 200, w: 160, h: 100 });
      if (!picture || fill?.kind !== 'shape' || fill.fill?.type !== 'image') throw new Error('Missing native picture or image fill');
      for (const media of [picture.media, fill.fill.media]) {
        expect(media.contentType).toBe(source.type);
        expect(Buffer.from(media.data)).toEqual(source.bytes);
        expect(await pixels(media.data)).toEqual(await pixels(source.bytes));
      }
    }
  });

  it('keeps GIF, WebP and SVG conversion semantics identical to local images', async () => {
    const dir = await workspace();
    const sources = [
      { file: 'tiny.gif', type: 'image/gif' },
      { file: 'quad.webp', type: 'application/octet-stream' },
      { file: 'icon.svg', type: 'image/svg+xml' },
    ];
    const slides: string[] = [];
    for (const source of sources) {
      const bytes = await readFile(`test/html/fixtures/assets/${source.file}`);
      await writeFile(join(dir, source.file), bytes);
      for (const url of [source.file, `data:${source.type};base64,${bytes.toString('base64')}`]) {
        slides.push(`<img src="${url}"><div class="fill" style="background-image: url('${url}')"></div>`);
      }
    }
    const input = join(dir, 'formats.html');
    await writeFile(input, deckHtml(slides));
    const result = await convertHtmlToPptx(input, { ...options, browser });
    expect(result.exitCode).toBe(4);
    expect(result.report.entries.map((entry) => [entry.code, entry.slide])).toEqual([
      ['SUBSTITUTE_IMAGE_FORMAT', 1], ['SUBSTITUTE_IMAGE_FORMAT', 1],
      ['SUBSTITUTE_IMAGE_FORMAT', 2], ['SUBSTITUTE_IMAGE_FORMAT', 2],
      ['SUBSTITUTE_IMAGE_FORMAT', 3], ['SUBSTITUTE_IMAGE_FORMAT', 3],
      ['SUBSTITUTE_IMAGE_FORMAT', 4], ['SUBSTITUTE_IMAGE_FORMAT', 4],
      ['SUBSTITUTE_IMAGE_FORMAT', 5], ['SUBSTITUTE_IMAGE_FORMAT', 6],
    ]);
    const deck = await parsePptx(await readFile(result.outputPath));
    for (let index = 0; index < 6; index += 2) {
      const local = deck.slides[index]!;
      const embedded = deck.slides[index + 1]!;
      const picture = embedded.elements.find((el) => el.kind === 'picture')!;
      const control = local.elements.find((el) => el.kind === 'picture')!;
      expect(picture.box).toEqual(control.box);
      expect(picture.media.contentType).toBe('image/png');
      expect(await pixels(picture.media.data)).toEqual(await pixels(control.media.data));
      const fill = embedded.elements.find((el) => el.kind === 'shape' && el.fill?.type === 'image');
      const controlFill = local.elements.find((el) => el.kind === 'shape' && el.fill?.type === 'image');
      if (fill?.kind !== 'shape' || fill.fill?.type !== 'image' || controlFill?.kind !== 'shape' || controlFill.fill?.type !== 'image') throw new Error('Missing image fill');
      expect(fill.fill.media.contentType).toBe('image/png');
      expect(await pixels(fill.fill.media.data)).toEqual(await pixels(controlFill.fill.media.data));
      if (index === 4) {
        expect(Buffer.from(picture.vector!.data)).toEqual(await readFile('test/html/fixtures/assets/icon.svg'));
      } else {
        expect(picture.vector).toBeUndefined();
      }
    }
  });

  it('rejects HTTP and HTTPS pictures and fills without fetching remote image bytes', async () => {
    const dir = await workspace();
    const bytes = await readFile('test/html/fixtures/assets/quad.png');
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No server address');
      const input = join(dir, 'remote.html');
      await writeFile(input, deckHtml(['http', 'https'].map((scheme) => {
        const url = `${scheme}://127.0.0.1:${address.port}/image.png`;
        return `<img id="picture" src="${url}"><div id="fill" class="fill" style="background-image: url('${url}')"></div>`;
      })));
      const result = await convertHtmlToPptx(input, { ...options, browser });
      expect(result.exitCode).toBe(2);
      expect(result.report.entries.map((entry) => [entry.code, entry.slide, entry.locator])).toEqual([
        ['VALIDATE_REMOTE_ASSET', 1, { selector: '#picture' }],
        ['VALIDATE_REMOTE_ASSET', 1, { selector: '#fill' }],
        ['VALIDATE_REMOTE_ASSET', 2, { selector: '#picture' }],
        ['VALIDATE_REMOTE_ASSET', 2, { selector: '#fill' }],
      ]);
      expect(requests).toBe(0);
      await expect(stat(result.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports blocked images inside rasterised subtrees and keeps absent sources on the missing-asset path', async () => {
    const dir = await workspace();
    const input = join(dir, 'nested.html');
    await writeFile(input, deckHtml([
      `<div data-raster style="width: 200px; height: 200px"><img id="remote" src="https://deckflip.invalid/remote.png"></div>`,
      `<img id="missing">`,
      `<div data-raster style="width: 200px; height: 200px"><video id="poster" width="160" height="100" poster="https://deckflip.invalid/poster.png"></video></div>`,
    ]));
    const result = await convertHtmlToPptx(input, { ...options, browser });
    expect(result.exitCode).toBe(2);
    expect(result.report.entries.filter((entry) => entry.severity === 'error')).toEqual([
      expect.objectContaining({ code: 'VALIDATE_REMOTE_ASSET', slide: 1, locator: { selector: '#remote' } }),
      expect.objectContaining({ code: 'VALIDATE_MISSING_ASSET', slide: 2, locator: { selector: '#missing' } }),
      expect.objectContaining({ code: 'VALIDATE_REMOTE_ASSET', slide: 3, locator: { selector: '#poster' } }),
    ]);
    await expect(stat(result.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not report blocked image requests from skipped Slide content', async () => {
    const dir = await workspace();
    const input = join(dir, 'hidden.html');
    await writeFile(input, deckHtml([
      `<div style="display:none"><img src="https://deckflip.invalid/hidden.png"></div>
       <img style="visibility:hidden" src="https://deckflip.invalid/invisible.png">
       <aside class="notes"><img src="https://deckflip.invalid/notes.png"></aside>`,
    ]));
    const result = await convertHtmlToPptx(input, { ...options, browser });
    expect(result.report.entries).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('omits embedded payloads from CSS fallback Report entries', async () => {
    const dir = await workspace();
    const bytes = await readFile('test/html/fixtures/assets/quad.png');
    const payload = bytes.toString('base64');
    const input = join(dir, 'layers.html');
    await writeFile(input, deckHtml([
      `<div class="fill" style="background-image: url('data:image/png;base64,${payload}'), linear-gradient(red, blue)"></div>`,
    ]));
    const result = await convertHtmlToPptx(input, { ...options, browser });
    expect(result.exitCode).toBe(4);
    expect(result.report.entries.map((entry) => entry.code)).toEqual(['RASTER_GRADIENT']);
    const reportText = JSON.stringify(result.report);
    expect(reportText).not.toContain(payload);
    expect(reportText.length).toBeLessThan(2000);
  });

  it('rejects invalid embedded content with bounded CLI reports and element locators', async () => {
    const dir = await workspace();
    // Chromium decodes BMP, but the converter's local-image policy does not support it.
    const bmp = Buffer.alloc(58);
    bmp.write('BM');
    bmp.writeUInt32LE(58, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(1, 18);
    bmp.writeInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    bmp[56] = 255;
    const unsupported = `data:image/bmp;base64,${bmp.toString('base64')}`;
    for (const size of [64, 64_000]) {
      const payload = 'PAYLOAD_SENTINEL'.repeat(size);
      const urls = [
        `data:image/png;base64,${payload}!`,
        `data:image/png,${payload}%XX`,
        `data:image/png;${payload}`,
        unsupported,
      ];
      const input = join(dir, 'invalid.html');
      await writeFile(input, deckHtml(urls.map((url) =>
        `<img id=\"picture\" src=\"${url}\"><div id=\"fill\" class=\"fill\" style=\"background-image: url('${url}')\"></div>`)));
      const output = join(dir, 'invalid.pptx');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', 'convert', input, '-o', output, '--strict', '--json'], {
        encoding: 'utf8', timeout: 60_000, env: { ...process.env, DECKFLIP_OFFLINE: '1' },
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(2);
      const report = JSON.parse(await readFile(`${output}.report.json`, 'utf8'));
      expect(JSON.parse(result.stdout)).toEqual(report);
      expect(report.entries).toHaveLength(8);
      for (const entry of report.entries) {
        expect(entry).toMatchObject({ code: 'VALIDATE_IMAGE_ASSET', severity: 'error', slide: expect.any(Number) });
        expect(['#picture', '#fill']).toContain(entry.locator.selector);
        expect(entry.hint).toMatch(/PNG.*JPEG/);
      }
      const outputText = result.stdout + result.stderr + JSON.stringify(report);
      expect(outputText).not.toContain('PAYLOAD_SENTINEL');
      expect(outputText).not.toContain(bmp.toString('base64'));
      expect(outputText.length).toBeLessThan(12_000);
      await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
