// PROTOTYPE (wayfinder #8). Throwaway. Measures slide.html in headless Chromium and hand-writes a PPTX.
// Run: node spike.mjs  -> out/spike.pptx, out/chromium.png, out/measurements.json
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const EMU_PER_PX = 9525;          // 1 CSS px @96dpi = 0.75pt = 9525 EMU
const emu = (px) => Math.round(px * EMU_PER_PX);
const hundredthsPt = (px) => Math.round(px * 75); // px -> pt*100
const CANVAS = { width: 1280, height: 720 };

// ---------- 1. measure ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: CANVAS, deviceScaleFactor: 1 });
await page.goto('file://' + join(here, 'slide.html'));
await page.evaluate(() => document.fonts.ready);

const shapes = await page.evaluate(() => {
  const declared = (el, prop) => {
    let v = null;
    for (const sheet of document.styleSheets)
      for (const rule of sheet.cssRules)
        if (rule.selectorText && el.matches(rule.selectorText) && rule.style[prop]) v = rule.style[prop];
    return v;
  };
  const hex = (rgb) => {
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m || m[4] === '0') return null;
    return [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const lines = (el) => {
    const rows = new Map();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode()); ) {
      const text = node.data;
      const re = /\S+/g;
      for (let m; (m = re.exec(text)); ) {
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const rect = r.getBoundingClientRect();
        const key = Math.round(rect.top * 10) / 10;
        if (!rows.has(key)) rows.set(key, { top: key, height: rect.height, words: [] });
        rows.get(key).words.push(m[0]);
      }
    }
    return [...rows.values()].sort((a, b) => a.top - b.top).map((l) => ({ top: l.top, height: l.height, text: l.words.join(' ') }));
  };
  return [...document.querySelectorAll('[data-shape]')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      id: el.className,
      kind: el.dataset.shape,
      box: { x: r.left, y: r.top, w: r.width, h: r.height },
      padding: { t: parseFloat(cs.paddingTop), r: parseFloat(cs.paddingRight), b: parseFloat(cs.paddingBottom), l: parseFloat(cs.paddingLeft) },
      font: { family: cs.fontFamily.replace(/["']/g, ''), sizePx: parseFloat(cs.fontSize), bold: +cs.fontWeight >= 600 },
      lineHeight: { declared: declared(el, 'lineHeight'), computedPx: parseFloat(cs.lineHeight) },
      align: cs.textAlign,
      color: hex(cs.color),
      fill: hex(cs.backgroundColor),
      text: el.textContent.trim(),
      lines: lines(el),
    };
  });
});
await page.screenshot({ path: join(out, 'chromium.png') });
await browser.close();
writeFileSync(join(out, 'measurements.json'), JSON.stringify(shapes, null, 2));

// ---------- 2. emit OOXML ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

// Round 1 mapped unitless line-height to spcPct: PowerPoint's percentage is of the font's *natural* line
// (~1.15-1.25em for Arial), not of font-size, so pitch drifted +6px/line. Round 2: always spcPts from the
// measured Chromium line box.
// MODE=spcPct | spcPts | corrected (default)
const MODE = process.env.MODE ?? 'corrected';
const lnSpc = (lh) => {
  if (MODE === 'spcPct' && !/px$/.test(lh.declared)) return `<a:lnSpc><a:spcPct val="${Math.round(parseFloat(lh.declared) * 100000)}"/></a:lnSpc>`;
  return `<a:lnSpc><a:spcPts val="${hundredthsPt(lh.computedPx)}"/></a:lnSpc>`;
};
// First-line baseline: CSS splits leading (L - (asc+desc)*f) half above / half below the content area;
// PowerPoint with fixed spacing places the baseline at L*asc/(asc+desc). Difference folded into tIns.
// Arial hhea metrics (em units); a real emitter reads these from the font file.
const ARIAL = { asc: 1854 / 2048, desc: 434 / 2048 };
const baselineShift = (L, f, m = ARIAL) => (MODE === 'corrected' ? ((m.asc - m.desc) / 2) * (L / (m.asc + m.desc) - f) : 0);
const algn = { left: 'l', start: 'l', center: 'ctr', right: 'r', end: 'r', justify: 'just' };

const sp = (s, i) => {
  const geom = s.kind === 'ellipse' ? 'ellipse' : 'rect';
  const fill = s.fill ? `<a:solidFill><a:srgbClr val="${s.fill}"/></a:solidFill>` : '<a:noFill/>';
  const txBody = s.text
    ? `<p:txBody>
  <a:bodyPr wrap="square" lIns="${emu(s.padding.l)}" tIns="${emu(s.padding.t - baselineShift(s.lineHeight.computedPx, s.font.sizePx))}" rIns="${emu(s.padding.r)}" bIns="${emu(s.padding.b)}" anchor="t"><a:noAutofit/></a:bodyPr>
  <a:lstStyle/>
  <a:p><a:pPr algn="${algn[s.align] ?? 'l'}">${lnSpc(s.lineHeight)}</a:pPr>
    <a:r><a:rPr lang="en-US" sz="${hundredthsPt(s.font.sizePx)}" b="${s.font.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:latin typeface="${s.font.family}"/><a:cs typeface="${s.font.family}"/></a:rPr><a:t>${esc(s.text)}</a:t></a:r>
  </a:p>
</p:txBody>`
    : '';
  return `<p:sp>
  <p:nvSpPr><p:cNvPr id="${i + 2}" name="${s.id}"/><p:cNvSpPr txBox="${s.text ? 1 : 0}"/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="${emu(s.box.x)}" y="${emu(s.box.y)}"/><a:ext cx="${emu(s.box.w)}" cy="${emu(s.box.h)}"/></a:xfrm>
    <a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>
    ${fill}<a:ln><a:noFill/></a:ln>
  </p:spPr>
  ${txBody}
</p:sp>`;
};

const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
<p:cSld><p:spTree>
  <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
  <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  ${shapes.map(sp).join('\n')}
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('\n')}
</Relationships>`;

const cx = emu(CANVAS.width), cy = emu(CANVAS.height);
const files = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  '_rels/.rels': rels([
    ['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'extended-properties', 'docProps/app.xml'],
  ]).replace('officeDocument/2006/relationships/metadata/core-properties', 'package/2006/relationships/metadata/core-properties'),
  'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>spike</dc:title><dc:creator>spike</dc:creator></cp:coreProperties>`,
  'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>spike</Application></Properties>`,
  'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
  'ppt/_rels/presentation.xml.rels': rels([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'slide', 'slides/slide1.xml'],
    ['rId3', 'theme', 'theme/theme1.xml'],
  ]),
  'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}>
<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr/></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles>
</p:sldMaster>`,
  'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'theme', '../theme/theme1.xml'],
  ]),
  'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
  'ppt/slides/slide1.xml': slideXml,
  'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
  'ppt/theme/theme1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Spike">
<a:themeElements>
<a:clrScheme name="Spike"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Spike"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Spike">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`,
};

const zip = new JSZip();
for (const [name, body] of Object.entries(files)) zip.file(name, body);
writeFileSync(join(out, 'spike.pptx'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

for (const s of shapes) console.log(`${s.id.padEnd(8)} ${s.kind.padEnd(7)} @${s.box.x},${s.box.y} ${s.box.w}x${s.box.h}  lines=${s.lines.length}${s.lines.length ? ' lh=' + s.lines[0].height : ''}`);
console.log('wrote out/spike.pptx, out/chromium.png, out/measurements.json');
