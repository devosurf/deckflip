import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Media } from '../model/index.js';

export type LoadedMedia =
  /** PNG and JPEG are embedded as they are */
  | { kind: 'raster'; media: Media; reencoded: false }
  /** GIF (first frame) and WebP are re-encoded to PNG */
  | { kind: 'raster'; media: Media; reencoded: true }
  /** SVG: the vector payload; the caller supplies the PNG fallback */
  | { kind: 'vector'; vector: Media };

function sniff(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  const head = Buffer.from(bytes.subarray(0, 512)).toString('utf8');
  if (/<svg[\s>]/i.test(head)) return 'svg';
  return undefined;
}

export async function reencodeToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toBuffer('image/png');
}

/** Reads an image file and classifies it by content, not extension. Unknown formats throw. */
export async function loadMedia(path: string): Promise<LoadedMedia> {
  const bytes = new Uint8Array(await readFile(path));
  const format = sniff(bytes);
  switch (format) {
    case 'png':
      return { kind: 'raster', media: { data: bytes, contentType: 'image/png' }, reencoded: false };
    case 'jpeg':
      return { kind: 'raster', media: { data: bytes, contentType: 'image/jpeg' }, reencoded: false };
    case 'gif':
    case 'webp':
      return { kind: 'raster', media: { data: await reencodeToPng(bytes), contentType: 'image/png' }, reencoded: true };
    case 'svg':
      return { kind: 'vector', vector: { data: bytes, contentType: 'image/svg+xml' } };
    default:
      throw new Error(`Unsupported image format: ${path}`);
  }
}
