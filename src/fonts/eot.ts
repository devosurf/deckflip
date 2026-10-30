// PowerPoint's Embedded OpenType container (#33). New payloads are EOT 2.2 with flags zero:
// the complete measured sfnt is copied once, unchanged, into the final allocation.

export interface EotHeader {
  version: number;
  flags: number;
  fsType: number;
  subset: boolean;
  compressed: boolean;
  familyName: string;
  styleName: string;
  fontDataOffset: number;
  fontDataSize: number;
}

/** Checks metadata needed by EOT without allocating a font-sized payload. */
export function validateEotSource(sfnt: Buffer): void {
  eotSource(sfnt);
}

function eotSource(sfnt: Buffer): { os2: Buffer; head: Buffer; strings: string[] } {
  const tables = sfntTables(sfnt);
  const os2 = requiredTable(tables, 'OS/2', 64);
  const head = requiredTable(tables, 'head', 12);
  const names = sfntNames(requiredTable(tables, 'name', 6));
  const strings = [names.get(1) ?? '', names.get(2) ?? '', names.get(5) ?? '', names.get(4) ?? ''];
  if (strings.some((name) => Buffer.byteLength(name, 'utf16le') > 0xffff)) throw new Error('EOT font name exceeds 65535 bytes');
  return { os2, head, strings };
}

export function wrapEot(sfnt: Buffer): Buffer {
  const { os2, head, strings } = eotSource(sfnt);
  const headerSize = 120 + strings.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf16le'), 0);
  const out = Buffer.alloc(headerSize + sfnt.length);
  out.writeUInt32LE(out.length, 0);
  out.writeUInt32LE(sfnt.length, 4);
  out.writeUInt32LE(0x00020002, 8);
  // Flags, reserved fields, padding and empty RootString/EUDC/signature remain zero.
  os2.copy(out, 16, 32, 42);
  out[26] = 1; // DEFAULT_CHARSET
  out[27] = os2.readUInt16BE(62) & 1;
  out.writeUInt32LE(os2.readUInt16BE(4), 28);
  out.writeUInt16LE(os2.readUInt16BE(8), 32);
  out.writeUInt16LE(0x504c, 34);
  for (let index = 0; index < 4; index += 1) out.writeUInt32LE(os2.readUInt32BE(42 + index * 4), 36 + index * 4);
  if (os2.length >= 86) {
    out.writeUInt32LE(os2.readUInt32BE(78), 52);
    out.writeUInt32LE(os2.readUInt32BE(82), 56);
  }
  out.writeUInt32LE(head.readUInt32BE(8), 60);
  let at = 82;
  for (const [index, value] of strings.entries()) {
    if (index > 0) at += 2;
    const length = Buffer.byteLength(value, 'utf16le');
    out.writeUInt16LE(length, at);
    at += 2;
    at += out.write(value, at, length, 'utf16le');
  }
  at += 4; // Padding5 and empty RootStringSize
  out.writeUInt32LE(0x50475342, at); // checksum of the empty RootString
  sfnt.copy(out, headerSize);
  return out;
}

/** Reads complete, subset and MTX EOT headers without decoding or modifying their payloads. */
export function parseEot(bytes: Buffer): EotHeader {
  if (bytes.length < 82 || bytes.readUInt16LE(34) !== 0x504c) throw new Error('Invalid EOT header');
  const version = bytes.readUInt32LE(8);
  if (version !== 0x00010000 && version !== 0x00020001 && version !== 0x00020002) throw new Error('Unsupported EOT version');
  const flags = bytes.readUInt32LE(12);
  const fontDataSize = bytes.readUInt32LE(4);
  let at = 82;
  const skip = (length: number): void => {
    if (length > bytes.length - at) throw new Error('Truncated EOT header');
    at += length;
  };
  const u16 = (): number => {
    const start = at;
    skip(2);
    return bytes.readUInt16LE(start);
  };
  const u32 = (): number => {
    const start = at;
    skip(4);
    return bytes.readUInt32LE(start);
  };
  const name = (): string => {
    const length = u16();
    const start = at;
    skip(length);
    return bytes.toString('utf16le', start, at);
  };
  const familyName = name();
  skip(2);
  const styleName = name();
  skip(2);
  name(); // version
  skip(2);
  name(); // full name
  if (version !== 0x00010000) {
    skip(2);
    skip(u16()); // RootString
  }
  if (version === 0x00020002) {
    skip(10); // RootStringCheckSum, EUDCCodePage, Padding6
    skip(u16()); // Signature
    skip(4); // EUDCFlags
    skip(u32()); // EUDCFont
  }
  if (fontDataSize > bytes.length - at || bytes.readUInt32LE(0) > bytes.length) throw new Error('Truncated EOT font data');
  return { version, flags, fsType: bytes.readUInt16LE(32), subset: Boolean(flags & 1), compressed: Boolean(flags & 4), familyName, styleName, fontDataOffset: at, fontDataSize };
}

function sfntTables(sfnt: Buffer): Map<string, Buffer> {
  if (sfnt.length < 12 || ![0x00010000, 0x4f54544f, 0x74727565].includes(sfnt.readUInt32BE(0))) throw new Error('EOT requires a standalone sfnt');
  const count = sfnt.readUInt16BE(4);
  if (12 + count * 16 > sfnt.length) throw new Error('Truncated sfnt directory');
  const tables = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    const offset = sfnt.readUInt32BE(at + 8);
    const length = sfnt.readUInt32BE(at + 12);
    if (offset > sfnt.length || length > sfnt.length - offset) throw new Error('Truncated sfnt table');
    tables.set(sfnt.toString('latin1', at, at + 4), sfnt.subarray(offset, offset + length));
  }
  return tables;
}

function requiredTable(tables: ReadonlyMap<string, Buffer>, tag: string, minimum: number): Buffer {
  const table = tables.get(tag);
  if (table === undefined || table.length < minimum) throw new Error(`Missing or truncated sfnt ${tag} table`);
  return table;
}

function sfntNames(table: Buffer): Map<number, string> {
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  if (6 + count * 12 > table.length) throw new Error('Truncated sfnt name records');
  const selected = new Map<number, { rank: number; text: string }>();
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    const platform = table.readUInt16BE(at);
    const encoding = table.readUInt16BE(at + 2);
    const language = table.readUInt16BE(at + 4);
    const id = table.readUInt16BE(at + 6);
    if (![1, 2, 4, 5].includes(id)) continue;
    const length = table.readUInt16BE(at + 8);
    const offset = storage + table.readUInt16BE(at + 10);
    if (offset > table.length || length > table.length - offset) throw new Error('Truncated sfnt name');
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode && !(platform === 1 && encoding === 0)) continue;
    if (unicode && length % 2 !== 0) throw new Error('Invalid Unicode sfnt name');
    const rank = platform === 3 && encoding === 1 && language === 0x409 ? 3
      : platform === 1 && encoding === 0 && language === 0 ? 2 : 1;
    if ((selected.get(id)?.rank ?? -1) > rank) continue;
    const raw = table.subarray(offset, offset + length);
    const text = unicode ? Buffer.from(raw).swap16().toString('utf16le') : new TextDecoder('macintosh').decode(raw);
    selected.set(id, { rank, text });
  }
  return new Map([...selected].map(([id, value]) => [id, value.text]));
}
