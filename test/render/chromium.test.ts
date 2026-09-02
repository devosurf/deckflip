import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { chromium as playwrightChromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChromium, renderHtml } from '../../src/render/chromium.js';

const canUseManagedChromium = existsSync(playwrightChromium.executablePath()) || Boolean(process.env.DECKFLIP_BROWSER);

describe.skipIf(!canUseManagedChromium)('renderHtml', () => {
  let browser: Browser | undefined;

  beforeAll(async () => {
    browser = await launchChromium({ offline: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('loads a relative stylesheet from the source directory copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-render-html-'));
    const sourceFile = join(dir, 'deck.html');
    await writeFile(join(dir, 'accent.css'), 'body > section { background: rgb(0, 128, 0); }', 'utf8');
    await writeFile(sourceFile, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="accent.css"><style>html,body{margin:0;padding:0}body>section{position:relative;box-sizing:border-box;overflow:hidden;width:1280px;height:720px}</style></head><body><section></section></body></html>', 'utf8');

    const rendered = await renderHtml(
      {
        canvas: { width: 1280, height: 720 },
        documents: [
          {
            index: 1,
            html: await readFile(sourceFile, 'utf8'),
            baseUrl: pathToFileURL(sourceFile).href,
            sourceFile,
          },
        ],
      },
      { browser: browser!, dpi: 96 },
    );

    const png = rendered.get(1);
    expect(png).toBeDefined();
    const image = await loadImage(png!);
    expect(image.width).toBe(1280);
    expect(image.height).toBe(720);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    expect(Array.from(ctx.getImageData(640, 360, 1, 1).data)).toEqual([0, 128, 0, 255]);
  });
});
