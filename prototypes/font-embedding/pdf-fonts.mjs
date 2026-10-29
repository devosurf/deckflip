// Lists the actual PDF font (BaseFont) used for each text item of a
// PowerPoint PDF export, plus per-line grouping, as JSON.
// Usage: node pdf-fonts.mjs file.pdf [...]
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function fonts(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    await page.getOperatorList();
    const { items } = await page.getTextContent();
    const baseName = (id) => { try { return page.commonObjs.get(id).name; } catch { return id; } };
    const runs = items.filter((i) => i.str.trim()).map((i) => ({
      text: i.str,
      font: baseName(i.fontName).replace(/^[A-Z]{6}\+/, ''),
      x: Math.round(i.transform[4] * 10) / 10,
      y: Math.round(i.transform[5] * 10) / 10,
      width: Math.round(i.width * 10) / 10,
    }));
    pages.push({ page: n, runs, fonts: [...new Set(runs.map((r) => r.font))].sort() });
  }
  return { file: path, pages };
}

const out = [];
for (const path of process.argv.slice(2)) out.push(await fonts(path));
console.log(JSON.stringify(out, null, 2));
