// Minimal one-Slide PPTX writer for the #33 cases. Parts mirror deckflip's
// emitter output (master, blank layout, theme) plus PowerPoint's embedded-font
// structure: p:embeddedFontLst, font relationships and fntdata parts.
import JSZip from 'jszip';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SLOTS = ['regular', 'bold', 'italic', 'boldItalic'];
export const EMU_PER_PT = 12700;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const master = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${grp}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr/></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles></p:sldMaster>`;
const layout = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${grp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const theme = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${solid}</a:ln><a:ln w="12700">${solid}</a:ln><a:ln w="19050">${solid}</a:ln></a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

function shape(id, box) {
  const { x, y, cx, cy, runs, sizePt = 16 } = box;
  const r = runs.map(({ text, family, bold, italic }) => {
    const face = `<a:latin typeface="${esc(family)}"/><a:ea typeface="${esc(family)}"/><a:cs typeface="${esc(family)}"/>`;
    return `<a:r><a:rPr lang="en-US" sz="${sizePt * 100}" b="${bold ? 1 : 0}" i="${italic ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>${face}</a:rPr><a:t xml:space="preserve">${esc(text)}</a:t></a:r>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(box.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"/>${r}</a:p></p:txBody></p:sp>`;
}

/**
 * @param {object} deck
 * @param {string} deck.title
 * @param {Array} deck.boxes  text boxes: {name, x, y, cx, cy, sizePt, runs:[{text,family,bold,italic}]}
 * @param {Array} deck.embedded  [{typeface, attrs?, slots:{regular?,bold?,italic?,boldItalic?: Buffer}}]
 * @param {object} [deck.presentationAttrs]  e.g. {embedTrueTypeFonts:'1'}
 * @param {string} [deck.fontContentType]
 * @param {string} [deck.fontExtension]
 */
export async function buildDeck({ title, boxes, embedded = [], presentationAttrs = {}, fontContentType = 'application/x-fontdata', fontExtension = 'fntdata' }) {
  const zip = new JSZip();
  const presRels = [
    `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/>`,
    `<Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/>`,
  ];
  const fontParts = [];
  let rid = 4;
  const fontList = embedded.map(({ typeface, attrs = {}, slots }) => {
    const slotXml = SLOTS.filter((s) => slots[s]).map((s) => {
      const n = fontParts.length + 1;
      const target = `fonts/font${n}.${fontExtension}`;
      fontParts.push({ path: `ppt/${target}`, bytes: slots[s] });
      presRels.push(`<Relationship Id="rId${rid}" Type="${REL}/font" Target="${target}"/>`);
      return `<p:${s} r:id="rId${rid++}"/>`;
    }).join('');
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<p:embeddedFont><p:font typeface="${esc(typeface)}"${a}/>${slotXml}</p:embeddedFont>`;
  }).join('');
  const pAttrs = Object.entries(presentationAttrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const presentation = `${XML}<p:presentation ${NS}${pAttrs}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>${fontList ? `<p:embeddedFontLst>${fontList}</p:embeddedFontLst>` : ''}</p:presentation>`;
  const slide = `${XML}<p:sld ${NS}><p:cSld name="Slide 1"><p:spTree>${grp}${boxes.map((b, i) => shape(i + 2, b)).join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const ov = (part, type) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;
  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${fontParts.length ? `<Default Extension="${fontExtension}" ContentType="${fontContentType}"/>` : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${ov('/docProps/app.xml', 'extended-properties+xml')}${ov('/ppt/presentation.xml', 'presentationml.presentation.main+xml')}${ov('/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster+xml')}${ov('/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout+xml')}${ov('/ppt/slides/slide1.xml', 'presentationml.slide+xml')}${ov('/ppt/theme/theme1.xml', 'theme+xml')}</Types>`;
  const files = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>deckflip #33</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>deckflip #33 prototype</Application><Slides>1</Slides></Properties>`,
    'ppt/presentation.xml': presentation,
    'ppt/_rels/presentation.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join('')}</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    'ppt/theme/theme1.xml': theme,
  };
  const date = new Date('1980-01-01T00:00:00Z');
  // createFolders:false keeps OPC parts only; folder entries carry wall-clock timestamps.
  for (const [path, text] of Object.entries(files)) zip.file(path, text, { date, createFolders: false });
  for (const { path, bytes } of fontParts) zip.file(path, bytes, { date, createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

// Digest over part names and bytes (folder entries and ZIP metadata excluded),
// so a generated package and an earlier tested copy of it can be compared.
export async function partsDigest(pptx) {
  const { createHash } = await import('node:crypto');
  const zip = await JSZip.loadAsync(pptx);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const h = createHash('sha256');
  for (const n of names) {
    const bytes = await zip.file(n).async('nodebuffer');
    h.update(`${n}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return h.digest('hex');
}
