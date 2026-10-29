// Embedded OpenType (EOT) v2.2 container as used by PowerPoint font parts.
// Reference: https://www.w3.org/submissions/EOT/ (header layout, flags).
// The writer emits Flags=0: no subsetting, no MTX compression, no XOR
// obfuscation. FontData is the unmodified sfnt.
import { headChecksumAdjustment, names, os2 } from './sfnt.mjs';

export const TTEMBED_SUBSET = 0x1;
export const TTEMBED_TTCOMPRESSED = 0x4;
export const TTEMBED_XORENCRYPTDATA = 0x10000000;

function utf16Name(text) {
  const data = Buffer.from(text ?? '', 'utf16le');
  const size = Buffer.alloc(2);
  size.writeUInt16LE(data.length, 0);
  return Buffer.concat([Buffer.alloc(2), size, data]); // padding, size, bytes
}

export function wrapEot(sfnt, { flags = 0 } = {}) {
  const o = os2(sfnt);
  const n = names(sfnt);
  const fixed = Buffer.alloc(82);
  let at = 8; // EOTSize and FontDataSize are written last
  fixed.writeUInt32LE(0x00020002, at); at += 4;
  fixed.writeUInt32LE(flags, at); at += 4;
  o.panose.copy(fixed, at); at += 10;
  fixed.writeUInt8(1, at); at += 1; // DEFAULT_CHARSET
  fixed.writeUInt8(o.fsSelection & 1 ? 1 : 0, at); at += 1;
  fixed.writeUInt32LE(o.usWeightClass, at); at += 4;
  fixed.writeUInt16LE(o.fsType, at); at += 2;
  fixed.writeUInt16LE(0x504c, at); at += 2;
  for (const v of o.unicodeRange) { fixed.writeUInt32LE(v, at); at += 4; }
  for (const v of o.codePageRange) { fixed.writeUInt32LE(v, at); at += 4; }
  fixed.writeUInt32LE(headChecksumAdjustment(sfnt), at); at += 4;
  at += 16; // Reserved1-4
  // Padding1 is the trailing two bytes of `fixed` (offset 80), so the family
  // name starts with its size; the later names each carry their own padding.
  const strings = Buffer.concat([
    utf16Name(n[1]).subarray(2),
    utf16Name(n[2]),
    utf16Name(n[5]),
    utf16Name(n[4]),
    utf16Name(''), // Padding5 + RootStringSize 0
  ]);
  const tail = Buffer.alloc(20);
  tail.writeUInt32LE(0x50475342, 0); // RootStringCheckSum of the empty RootString
  tail.writeUInt32LE(0, 4); // EUDCCodePage
  // Padding6 (2), SignatureSize 0 (2), EUDCFlags 0 (4), EUDCFontSize 0 (4)
  const header = Buffer.concat([fixed, strings, tail]);
  header.writeUInt32LE(header.length + sfnt.length, 0);
  header.writeUInt32LE(sfnt.length, 4);
  return Buffer.concat([header, sfnt]);
}

export function parseEot(b) {
  let o = 0;
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const u16 = () => { const v = b.readUInt16LE(o); o += 2; return v; };
  const h = { eotSize: u32(), fontDataSize: u32(), version: u32(), flags: u32() };
  h.panose = b.subarray(o, o + 10).toString('hex'); o += 10;
  h.charset = b[o]; h.italic = b[o + 1]; o += 2;
  h.weight = u32(); h.fsType = u16(); h.magic = u16();
  h.unicodeRange = [u32(), u32(), u32(), u32()];
  h.codePageRange = [u32(), u32()];
  h.checkSumAdjustment = u32();
  o += 16; u16();
  const str = () => { const n = u16(); const s = b.subarray(o, o + n).toString('utf16le'); o += n; return s; };
  h.familyName = str(); u16(); h.styleName = str(); u16(); h.versionName = str(); u16(); h.fullName = str();
  if (h.version === 0x00020001 || h.version === 0x00020002) { u16(); h.rootString = str(); }
  if (h.version === 0x00020002) {
    h.rootStringCheckSum = u32(); h.eudcCodePage = u32(); u16();
    const signatureSize = u16(); o += signatureSize;
    h.eudcFlags = u32();
    const eudcFontSize = u32(); o += eudcFontSize;
  }
  h.fontDataOffset = o;
  h.compressed = Boolean(h.flags & TTEMBED_TTCOMPRESSED);
  h.subset = Boolean(h.flags & TTEMBED_SUBSET);
  h.xor = Boolean(h.flags & TTEMBED_XORENCRYPTDATA);
  return h;
}

export function eotFontData(b) {
  const h = parseEot(b);
  return b.subarray(h.fontDataOffset, h.fontDataOffset + h.fontDataSize);
}
