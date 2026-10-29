// Lists a PPTX's embedded-font structure: presentation settings, content type,
// relationships, slots and each payload's container/EOT header and SHA-256.
// Usage: node inspect-pptx.mjs deck.pptx [...]
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { eotFontData, parseEot } from './lib/eot.mjs';
import { names, sha256 } from './lib/sfnt.mjs';

const hex = (n) => `0x${n.toString(16)}`;

async function inspect(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const text = (p) => zip.file(p)?.async('string');
  const pres = await text('ppt/presentation.xml');
  const rels = await text('ppt/_rels/presentation.xml.rels');
  const types = await text('[Content_Types].xml');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship [^>]*>/g)].map(([r]) => [r.match(/Id="([^"]+)"/)[1], { type: r.match(/Type="([^"]+)"/)[1], target: r.match(/Target="([^"]+)"/)[1] }]));
  const slots = [];
  for (const [, typeface, attrs, body] of pres.matchAll(/<p:embeddedFont><p:font typeface="([^"]+)"([^>]*)\/>(.*?)<\/p:embeddedFont>/g)) {
    for (const [, slot, rid] of body.matchAll(/<p:(\w+) r:id="([^"]+)"\/>/g)) {
      const rel = target[rid];
      const bytes = await zip.file(`ppt/${rel.target}`).async('nodebuffer');
      const row = { typeface, attrs: attrs.trim() || null, slot, part: rel.target, relationshipType: rel.type, bytes: bytes.length, sha256: sha256(bytes) };
      const tag = bytes.toString('latin1', 0, 4);
      if (tag === '\0\x01\0\0' || tag === 'OTTO' || tag === 'true') {
        row.container = 'raw sfnt';
      } else if (bytes.length > 36 && bytes.readUInt16LE(34) === 0x504c) {
        const h = parseEot(bytes);
        row.container = `EOT ${hex(h.version)}`;
        row.eot = { flags: hex(h.flags), compressed: h.compressed, subset: h.subset, xor: h.xor, fsType: hex(h.fsType), weight: h.weight, italic: h.italic, familyName: h.familyName, styleName: h.styleName, fullName: h.fullName };
        if (!h.compressed && !h.xor) {
          const sfnt = eotFontData(bytes);
          const n = names(sfnt);
          row.fontData = { sha256: sha256(sfnt), nameId1: n[1], nameId2: n[2], postscriptName: n[6] };
        }
      } else {
        row.container = 'unknown';
      }
      slots.push(row);
    }
  }
  return {
    file: path,
    presentation: (pres.match(/<p:presentation\b[^>]*>/)[0].match(/\b(embedTrueTypeFonts|saveSubsetFonts)="[^"]*"/g) ?? []),
    fntdataContentType: types.match(/<Default Extension="fntdata" ContentType="([^"]+)"/)?.[1] ?? null,
    embeddedFonts: slots,
  };
}

const out = [];
for (const path of process.argv.slice(2)) out.push(await inspect(path));
console.log(JSON.stringify(out, null, 2));
