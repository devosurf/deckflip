import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { findSoffice, renderPptxLibreOffice } from '../../src/render/libreoffice.js';
import { buildBlankPptx } from './pptx-fixture.js';

describe.skipIf(!findSoffice())('renderPptxLibreOffice', () => {
  it('rasterises a blank PPTX to a 1280x720 PNG', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-lo-'));
    const pptxPath = join(dir, 'blank.pptx');
    await writeFile(pptxPath, await buildBlankPptx());
    const pages = await renderPptxLibreOffice(pptxPath, { dpi: 96 });
    const png = pages.get(1);
    expect(png).toBeDefined();
    const image = await loadImage(png!);
    expect(image.width).toBe(1280);
    expect(image.height).toBe(720);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    expect(Array.from(ctx.getImageData(640, 360, 1, 1).data)).toEqual([255, 255, 255, 255]);
  });
});
