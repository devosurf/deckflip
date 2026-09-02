import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { rasterisePdf } from '../../src/render/pdf.js';

function buildBlankPdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources <<>> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

it('rasterises a blank 960x540pt PDF at 96dpi', async () => {
  const pages = await rasterisePdf(buildBlankPdf(), { dpi: 96 });
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
