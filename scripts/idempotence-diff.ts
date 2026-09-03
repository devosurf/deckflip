// Runs one fixture through HTML -> PPTX -> HTML -> PPTX and prints the first differing XML element per slide part.
// usage: npx tsx scripts/idempotence-diff.ts <category> <name>
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { convertHtmlToPptx, convertPptxToHtml } from '../src/convert.js';
import { launchChromium } from '../src/render/chromium.js';

const [category, name] = process.argv.slice(2);
const browser = await launchChromium({ offline: true });
const workDir = await mkdtemp(join(tmpdir(), `deckflip-diff-${name}-`));
const convert = { embedFonts: false as const, rasterDpi: 192, strict: false, offline: true, browser };
const firstPath = join(workDir, 'first.pptx');
await convertHtmlToPptx(join('fixtures', 'corpus', category!, name!, 'deck.html'), { ...convert, output: firstPath });
const { outputPath } = await convertPptxToHtml(firstPath, { output: join(workDir, 'first.html') });
const secondPath = join(workDir, 'second.pptx');
const second = await convertHtmlToPptx(outputPath, { ...convert, output: secondPath });
await browser.close();
console.log(workDir);
console.log('entries', second.report.entries.map((entry) => `${entry.code} ${JSON.stringify(entry.locator)} ${entry.reason}`));

const split = (xml: string): string[] => xml.split(/(?=<p:sp>|<p:pic>|<p:cxnSp>|<p:grpSp>|<p:graphicFrame>|<a:p>)/);
const a = await JSZip.loadAsync(await readFile(firstPath));
const b = await JSZip.loadAsync(await readFile(secondPath));
for (const part of Object.keys(a.files).filter((file) => file.startsWith('ppt/slides/slide') || file.startsWith('ppt/media/')).sort()) {
  const other = b.file(part);
  if (!other) {
    console.log('MISSING', part);
    continue;
  }
  if (part.startsWith('ppt/media/')) {
    continue;
  }
  const left = split(await a.file(part)!.async('text'));
  const right = split(await other.async('text'));
  let shown = 0;
  for (let index = 0; index < Math.max(left.length, right.length) && shown < 6; index += 1) {
    const l = left[index] ?? '';
    const r = right[index] ?? '';
    if (l !== r) {
      let at = 0;
      while (at < l.length && l[at] === r[at]) at += 1;
      const from = Math.max(0, at - 160);
      console.log(`\n${part} #${index} ${/name="([^"]*)"/.exec(l)?.[1] ?? ''}\n- ${l.slice(from, at + 120)}\n+ ${r.slice(from, at + 120)}`);
      shown += 1;
    }
  }
}
for (const part of Object.keys(b.files).filter((file) => file.startsWith('ppt/media/'))) {
  if (!a.file(part)) console.log('EXTRA', part);
}
