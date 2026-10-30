import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseEot, wrapEot } from '../../src/fonts/eot.js';

interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  name: string;
}

/** Replace only temporary name-table records, retaining the real face and valid sfnt checksums. */
async function fontWithNames(records: NameRecord[]): Promise<Buffer> {
  const source = await readFile('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf');
  const strings = records.map((record) => {
    const bytes = Buffer.from(record.name, record.platform === 1 ? 'latin1' : 'utf16le');
    return record.platform === 1 ? bytes : bytes.swap16();
  });
  const name = Buffer.alloc(6 + records.length * 12 + strings.reduce((size, bytes) => size + bytes.length, 0));
  name.writeUInt16BE(records.length, 2);
  name.writeUInt16BE(6 + records.length * 12, 4);
  let stringOffset = 0;
  for (const [index, record] of records.entries()) {
    const at = 6 + index * 12;
    for (const [field, value] of [record.platform, record.encoding, record.language, 1, strings[index]!.length, stringOffset].entries()) name.writeUInt16BE(value, at + field * 2);
    strings[index]!.copy(name, 6 + records.length * 12 + stringOffset);
    stringOffset += strings[index]!.length;
  }
  const at = (source.length + 3) & ~3;
  const out = Buffer.alloc(at + ((name.length + 3) & ~3));
  source.copy(out);
  name.copy(out, at);
  let head = 0;
  for (let index = 0; index < out.readUInt16BE(4); index += 1) {
    const record = 12 + index * 16;
    const tag = out.toString('ascii', record, record + 4);
    if (tag === 'name') {
      out.writeUInt32BE(checksum(name), record + 4);
      out.writeUInt32BE(at, record + 8);
      out.writeUInt32BE(name.length, record + 12);
    } else if (tag === 'head') head = out.readUInt32BE(record + 8);
  }
  out.writeUInt32BE(0, head + 8);
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, head + 8);
  return out;
}

function checksum(bytes: Buffer): number {
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 4) {
    let value = 0;
    for (let byte = 0; byte < 4; byte += 1) value = (value << 8) | (bytes[index + byte] ?? 0);
    sum = (sum + (value >>> 0)) >>> 0;
  }
  return sum;
}

it.each([
  { windows: true, expected: 'Windows English' },
  { windows: false, expected: 'Mac English' },
])('selects EOT names in prototype order with Windows English=$windows', async ({ windows, expected }) => {
  const records: NameRecord[] = [
    ...(windows ? [{ platform: 3, encoding: 1, language: 0x409, name: 'Windows English' }] : []),
    { platform: 1, encoding: 0, language: 0, name: 'Mac English' },
    { platform: 0, encoding: 3, language: 0, name: 'Other Unicode' },
    { platform: 3, encoding: 10, language: 0x409, name: 'Other Windows encoding' },
  ];
  const sfnt = await fontWithNames(records);
  const eot = wrapEot(sfnt);
  expect(parseEot(eot).familyName).toBe(expected);
  const header = parseEot(eot);
  expect(eot.subarray(header.fontDataOffset, header.fontDataOffset + header.fontDataSize)).toEqual(sfnt);
});
