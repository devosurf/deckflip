// Measures the same text in Chromium with each source encoding of a face and
// reports advance widths, so WOFF/WOFF2 decoding and variable instancing can
// be compared with the pinned static face Chromium would otherwise measure.
// Usage: node chromium-measure.mjs  (after build-cases.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { decompress as woff2Decompress } from 'wawoff2';
import { woff1Decode } from './lib/sfnt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../fixtures/corpus/fonts/_assets');
const cases = join(here, 'out/cases');
const sources = join(here, 'sources');
const TEXT = 'Heebo Medium: the quick brown fox jumps over the lazy dog while vexed nymphs pack my box with five dozen liquor jugs 0123456789 QWZ ÅÄÖ éñ€ß';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const faces = [
  { id: 'heebo-medium-ttf', mime: 'font/ttf', bytes: readFileSync(join(assets, 'heebo/Heebo-Medium.ttf')) },
  { id: 'heebo-medium-woff2', mime: 'font/woff2', bytes: readFileSync(join(cases, 'heebo-medium.woff2')) },
  { id: 'heebo-medium-woff2-decoded-ttf', mime: 'font/ttf', bytes: Buffer.from(await woff2Decompress(readFileSync(join(cases, 'heebo-medium.woff2')))) },
  { id: 'ss3-regular-ttf', mime: 'font/ttf', bytes: readFileSync(join(assets, 'source-sans-3/SourceSans3-Regular.ttf')) },
  { id: 'ss3-regular-woff', mime: 'font/woff', bytes: readFileSync(join(cases, 'ss3-regular.woff')) },
  { id: 'ss3-regular-woff-decoded-ttf', mime: 'font/ttf', bytes: woff1Decode(readFileSync(join(cases, 'ss3-regular.woff'))) },
  { id: 'ss3-regular-otf', mime: 'font/otf', bytes: readFileSync(join(sources, 'SourceSans3-Regular.otf')) },
  { id: 'heebo-variable-wght500', mime: 'font/ttf', bytes: readFileSync(join(assets, 'heebo/Heebo-Variable.ttf')), weight: '100 900', use: 500 },
  { id: 'heebo-variable-instance-wght500', mime: 'font/ttf', bytes: readFileSync(join(sources, 'Heebo-Variable-wght500.instance.ttf')) },
  { id: 'heebo-variable-wght100', mime: 'font/ttf', bytes: readFileSync(join(assets, 'heebo/Heebo-Variable.ttf')), weight: '100 900', use: 100 },
];

const css = faces.map((f) => `@font-face{font-family:"m-${f.id}";src:url(data:${f.mime};base64,${b64(f.bytes)});font-weight:${f.weight ?? 'normal'};}`).join('\n');
const html = `<!doctype html><meta charset="utf-8"><style>${css} span{font-size:200px;white-space:pre;font-kerning:normal}</style>${faces.map((f) => `<span id="${f.id}" style="font-family:'m-${f.id}';font-weight:${f.use ?? 400}">${TEXT}</span><br>`).join('')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const results = await page.evaluate(async (ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    const face = getComputedStyle(el).fontFamily;
    const loaded = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === face.replace(/"/g, '')).map((f) => f.status);
    out[id] = { widthPx: el.getBoundingClientRect().width, fontStatus: loaded };
  }
  return out;
}, faces.map((f) => f.id));
const version = browser.version();
await browser.close();

const report = { chromium: version, fontSizePx: 200, text: TEXT, results };
writeFileSync(join(here, 'out/chromium-measure.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
