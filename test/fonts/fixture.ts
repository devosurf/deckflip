import { readFile, writeFile } from 'node:fs/promises';

export interface FontMutation {
  removeNameIds?: number[];
  preferredFamily?: string;
  fsSelection?: number;
  macStyle?: number;
}

/** Mutates temporary metadata copies; never writes the licensed source fixture. */
export async function mutateFont(source: string, destination: string, mutation: FontMutation): Promise<void> {
  const bytes = await readFile(source);
  const count = bytes.readUInt16BE(4);
  const tables = new Map<string, { record: number; offset: number; length: number }>();
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16;
    tables.set(bytes.toString('ascii', record, record + 4), {
      record, offset: bytes.readUInt32BE(record + 8), length: bytes.readUInt32BE(record + 12),
    });
  }
  const name = tables.get('name')!.offset;
  for (let index = 0; index < bytes.readUInt16BE(name + 2); index++) {
    const record = name + 6 + index * 12;
    const id = record + 6;
    if (mutation.removeNameIds?.includes(bytes.readUInt16BE(id))) bytes.writeUInt16BE(255, id);
    if (bytes.readUInt16BE(id) === 16 && mutation.preferredFamily !== undefined) {
      const platform = bytes.readUInt16BE(record);
      const unicode = platform === 0 || platform === 3;
      const value = Buffer.from(mutation.preferredFamily, unicode ? 'utf16le' : 'latin1');
      if (unicode) value.swap16();
      if (value.length > bytes.readUInt16BE(record + 8)) throw new Error('Replacement family exceeds the fixture name slot');
      value.copy(bytes, name + bytes.readUInt16BE(name + 4) + bytes.readUInt16BE(record + 10));
      bytes.writeUInt16BE(value.length, record + 8);
    }
  }
  if (mutation.fsSelection !== undefined) bytes.writeUInt16BE(mutation.fsSelection, tables.get('OS/2')!.offset + 62);
  if (mutation.macStyle !== undefined) bytes.writeUInt16BE(mutation.macStyle, tables.get('head')!.offset + 44);
  const adjustment = tables.get('head')!.offset + 8;
  bytes.writeUInt32BE(0, adjustment);
  for (const table of tables.values()) bytes.writeUInt32BE(checksum(bytes, table.offset, table.length), table.record + 4);
  bytes.writeUInt32BE((0xb1b0afba - checksum(bytes, 0, bytes.length)) >>> 0, adjustment);
  await writeFile(destination, bytes);
}

function checksum(bytes: Buffer, offset: number, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 4) {
    let word = 0;
    for (let byte = 0; byte < 4; byte++) word = (word << 8) | (index + byte < length ? bytes[offset + index + byte]! : 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/** Packs standalone fixtures into a temporary TTC without changing their tables. */
export async function fontCollection(sources: string[], destination: string): Promise<void> {
  const fonts = await Promise.all(sources.map((file) => readFile(file)));
  const header = Buffer.alloc(12 + 4 * fonts.length);
  header.write('ttcf');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(fonts.length, 8);
  let offset = header.length;
  const parts = [header];
  for (const [index, font] of fonts.entries()) {
    header.writeUInt32BE(offset, 12 + index * 4);
    for (let table = 0; table < font.readUInt16BE(4); table++) {
      const position = 12 + table * 16 + 8;
      font.writeUInt32BE(font.readUInt32BE(position) + offset, position);
    }
    const padding = Buffer.alloc((4 - font.length % 4) % 4);
    parts.push(font, padding);
    offset += font.length + padding.length;
  }
  await writeFile(destination, Buffer.concat(parts));
}
