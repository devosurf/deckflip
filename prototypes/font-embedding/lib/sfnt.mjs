// Minimal sfnt/WOFF helpers for the #33 experiment. They read and rebuild table
// directories; table bytes are copied unchanged unless a caller replaces them.
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseSfnt(buf) {
  const flavor = buf.readUInt32BE(0);
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = buf.toString('latin1', at, at + 4);
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    tables.set(tag, buf.subarray(offset, offset + length));
  }
  return { flavor, tables };
}

function checksum(bytes) {
  const padded = Buffer.alloc((bytes.length + 3) & ~3);
  bytes.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

// Rebuilds an sfnt from tables, recomputing directory checksums and
// head.checkSumAdjustment. Table order follows the OpenType recommendation
// of ascending tags; byte contents are otherwise unchanged.
export function buildSfnt({ flavor, tables }) {
  const tags = [...tables.keys()].sort();
  const numTables = tags.length;
  const pow2 = 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow2 * 16, 6);
  header.writeUInt16BE(Math.log2(pow2), 8);
  header.writeUInt16BE(numTables * 16 - pow2 * 16, 10);
  const head = tables.get('head') && Buffer.from(tables.get('head'));
  if (head) head.writeUInt32BE(0, 8);
  const bodies = [];
  let offset = header.length;
  tags.forEach((tag, i) => {
    const data = tag === 'head' && head ? head : tables.get(tag);
    const at = 12 + i * 16;
    header.write(tag, at, 'latin1');
    header.writeUInt32BE(checksum(data), at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(data.length, at + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const out = Buffer.concat([header, ...bodies]);
  if (head) {
    const headOffset = out.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
    out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
  }
  return out;
}

export function woff1Encode(sfnt) {
  const { flavor, tables } = parseSfnt(sfnt);
  const tags = [...tables.keys()].sort();
  const dir = Buffer.alloc(44 + tags.length * 20);
  const bodies = [];
  let offset = dir.length;
  tags.forEach((tag, i) => {
    const orig = tables.get(tag);
    const z = deflateSync(orig, { level: 9 });
    const data = z.length < orig.length ? z : orig;
    const at = 44 + i * 20;
    dir.write(tag, at, 'latin1');
    dir.writeUInt32BE(offset, at + 4);
    dir.writeUInt32BE(data.length, at + 8);
    dir.writeUInt32BE(orig.length, at + 12);
    dir.writeUInt32BE(checksum(orig), at + 16);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  dir.write('wOFF', 0, 'latin1');
  dir.writeUInt32BE(flavor, 4);
  dir.writeUInt32BE(offset, 8);
  dir.writeUInt16BE(tags.length, 12);
  dir.writeUInt32BE(sfnt.length, 16);
  return Buffer.concat([dir, ...bodies]);
}

export function woff1Decode(woff) {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not WOFF 1.0');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const tag = woff.toString('latin1', at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const data = woff.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? inflateSync(data) : Buffer.from(data));
  }
  return buildSfnt({ flavor, tables });
}

export function os2(sfnt) {
  const t = parseSfnt(sfnt).tables.get('OS/2');
  return {
    version: t.readUInt16BE(0),
    usWeightClass: t.readUInt16BE(4),
    fsType: t.readUInt16BE(8),
    panose: Buffer.from(t.subarray(32, 42)),
    unicodeRange: [42, 46, 50, 54].map((o) => t.readUInt32BE(o)),
    fsSelection: t.readUInt16BE(62),
    codePageRange: t.length >= 86 ? [78, 82].map((o) => t.readUInt32BE(o)) : [0, 0],
  };
}

export function headChecksumAdjustment(sfnt) {
  return parseSfnt(sfnt).tables.get('head').readUInt32BE(8);
}

// Windows Unicode English names, falling back to Mac Roman English.
export function names(sfnt) {
  const t = parseSfnt(sfnt).tables.get('name');
  const count = t.readUInt16BE(2);
  const storage = t.readUInt16BE(4);
  const win = {};
  const mac = {};
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => t.readUInt16BE(at + o));
    const raw = t.subarray(storage + offset, storage + offset + length);
    if (platform === 3 && (encoding === 1 || encoding === 10) && language === 0x409) win[id] = Buffer.from(raw).swap16().toString('utf16le');
    if (platform === 1 && encoding === 0 && language === 0) mac[id] = raw.toString('latin1');
  }
  return { ...mac, ...win };
}

function nameTable(records) {
  const entries = Object.entries(records).map(([id, text]) => [Number(id), Buffer.from(text, 'utf16le').swap16()]);
  entries.sort((a, b) => a[0] - b[0]);
  const header = Buffer.alloc(6 + entries.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(entries.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  entries.forEach(([id, data], i) => {
    const at = 6 + i * 12;
    [3, 1, 0x409, id, data.length, offset].forEach((v, k) => header.writeUInt16BE(v, at + k * 2));
    offset += data.length;
  });
  return Buffer.concat([header, ...entries.map(([, d]) => d)]);
}

// Derives a uniquely named test face. Keeps copyright/licence/version records,
// writes legacy-only family/style names and the requested OS/2.fsType.
export function deriveTestFace(sfnt, { family, style = 'Regular', postscript, fsType }) {
  const parsed = parseSfnt(sfnt);
  const tables = new Map(parsed.tables);
  const src = names(sfnt);
  const keep = Object.fromEntries([0, 5, 7, 8, 9, 11, 12, 13, 14].filter((id) => src[id]).map((id) => [id, src[id]]));
  const full = style === 'Regular' ? family : `${family} ${style}`;
  tables.set('name', nameTable({ ...keep, 1: family, 2: style, 3: `deckflip-33;${postscript}`, 4: full, 6: postscript }));
  if (fsType !== undefined) {
    const t = Buffer.from(tables.get('OS/2'));
    t.writeUInt16BE(fsType, 8);
    tables.set('OS/2', t);
  }
  return buildSfnt({ flavor: parsed.flavor, tables });
}
