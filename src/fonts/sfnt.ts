// Font container formats a Deck may supply, and their decoding to the sfnt bytes deckflip measures and identifies
// (#33: WOFF and WOFF2 are decoded before measurement and embedding; TTF/OTF stay unchanged).

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import woff2Decompress from 'wawoff2/decompress.js';

import type { FontFormat } from '../model/index.js';

/** The container format by signature, not by file extension or `format()` hint; undefined for anything else (EOT, SVG, text). */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | undefined {
  if (bytes.length < 12) return undefined;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === '\u0000\u0001\u0000\u0000' || tag === 'true') return 'ttf';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'ttc';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  return undefined;
}

export interface DecodedFont {
  /** the format of the supplied bytes */
  format: FontFormat;
  /** sfnt (or collection) bytes: the supplied bytes for TTF/OTF/TTC, decoded for WOFF/WOFF2 */
  sfnt: Buffer;
}

/** Decodes WOFF/WOFF2 to sfnt; TTF, OTF and collections pass through. Throws when the bytes are no supported font container. */
export async function decodeFont(bytes: Buffer): Promise<DecodedFont> {
  const format = sniffFontFormat(bytes);
  switch (format) {
    case undefined:
      throw new Error('not a TrueType, OpenType, WOFF or WOFF2 font');
    case 'woff':
      return { format, sfnt: decodeWoff(bytes) };
    case 'woff2':
      return { format, sfnt: Buffer.from(await woff2Decompress(bytes)) };
    default:
      return { format, sfnt: bytes };
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * WOFF 1.0 to sfnt: each table inflated when stored compressed, laid out in the directory's tag order with
 * recomputed directory checksums and `head.checkSumAdjustment`, as google/woff2 does for WOFF2. The #33 PowerPoint
 * proof embedded faces decoded this way.
 */
function decodeWoff(woff: Buffer): Buffer {
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  if (woff.length < 44 + numTables * 20) throw new Error('truncated WOFF table directory');
  const tables: Array<{ tag: string; offset: number; compLength: number; origLength: number }> = [];
  let size = 12 + numTables * 16;
  for (let i = 0; i < numTables; i += 1) {
    const at = 44 + i * 20;
    const tag = woff.toString('latin1', at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    if (offset + compLength > woff.length) throw new Error(`truncated WOFF table ${tag}`);
    tables.push({ tag, offset, compLength, origLength });
    size += (origLength + 3) & ~3;
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const out = Buffer.alloc(size);
  const pow2 = 2 ** Math.floor(Math.log2(Math.max(numTables, 1)));
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(pow2 * 16, 6);
  out.writeUInt16BE(Math.log2(pow2), 8);
  out.writeUInt16BE(numTables * 16 - pow2 * 16, 10);
  let offset = 12 + numTables * 16;
  let headOffset: number | undefined;
  for (const [i, table] of tables.entries()) {
    const { tag, compLength, origLength } = table;
    const stored = woff.subarray(table.offset, table.offset + compLength);
    const data = compLength < origLength ? inflateSync(stored) : stored;
    if (data.length !== origLength) throw new Error(`WOFF table ${tag} does not inflate to its original length`);
    data.copy(out, offset);
    if (tag === 'head' && origLength >= 12) {
      out.writeUInt32BE(0, offset + 8);
      headOffset = offset;
    }
    const at = 12 + i * 16;
    out.write(tag, at, 'latin1');
    out.writeUInt32BE(tableChecksum(out.subarray(offset, offset + origLength)), at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(origLength, at + 12);
    offset += (origLength + 3) & ~3;
  }
  if (headOffset !== undefined) {
    out.writeUInt32BE((0xb1b0afba - tableChecksum(out)) >>> 0, headOffset + 8);
  }
  return out;
}

function tableChecksum(bytes: Buffer): number {
  let sum = 0;
  const whole = bytes.length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + bytes.readUInt32BE(i)) >>> 0;
  if (whole < bytes.length) {
    let tail = 0;
    for (let i = whole; i < bytes.length; i += 1) tail |= bytes[i]! << (24 - (i - whole) * 8);
    sum = (sum + (tail >>> 0)) >>> 0;
  }
  return sum;
}
