import JSZip from 'jszip';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const WIDTH = 12_192_000;
const HEIGHT = 6_858_000;

function rels(items: Array<[string, string, string]>): string {
  const type = (suffix: string): string => (suffix.startsWith('http') ? suffix : `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${suffix}`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${items.map(([id, suffix, target]) => `<Relationship Id="${id}" Type="${type(suffix)}" Target="${target}"${target.startsWith('http') ? ' TargetMode="External"' : ''}/>`).join('\n')}
</Relationships>`;
}

function coreXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>deckflip</dc:title><dc:creator>deckflip</dc:creator></cp:coreProperties>`;
}

function appXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>deckflip</Application></Properties>`;
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Deckflip"><a:themeElements><a:clrScheme name="Deckflip"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Deckflip"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Deckflip"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

export interface FixtureSlide {
  /** part file name under `ppt/slides/`, default `slide<n>.xml` */
  file?: string;
  /** `p:cSld/@name` */
  name?: string;
  /** `p:cSld` children before the shape tree (`p:bg`) */
  background?: string;
  /** `p:spTree` children after the group properties */
  shapes?: string;
  /** `p:sld` children after `p:clrMapOvr` (`p:transition`, `p:timing`, `p:extLst`) */
  tail?: string;
  /** relationships beyond the layout (`rId1`): [id, type suffix, target] */
  rels?: Array<[string, string, string]>;
  /** layout part file name under `ppt/slideLayouts/`, default `slideLayout1.xml` */
  layout?: string;
  /** `p:spTree` children of this slide's notes slide; the package gains a notes master when any slide has them */
  notes?: string;
  /** relationships of the notes slide beyond its notes master (`rId1`) and its slide (`rId2`) */
  notesRels?: Array<[string, string, string]>;
}

export interface FixtureOptions {
  slides?: FixtureSlide[];
  /** extra zip entries: `ppt/media/image1.png` -> bytes */
  parts?: Record<string, string | Uint8Array>;
  /** extra `[Content_Types].xml` entries */
  contentTypes?: { defaults?: Record<string, string>; overrides?: Record<string, string> };
  /** `p:presentation` children after `p:notesSz` (`p:extLst` with a section list) */
  presentationTail?: string;
  /** additional layouts under `ppt/slideLayouts/`: file name -> `p:cSld/@name`, or its name plus `p:spTree` children */
  layouts?: Record<string, string | { name: string; shapes?: string }>;
  /** the slide master's own `p:spTree` children and `p:txStyles`, which placeholder text inherits from */
  master?: { shapes?: string; txStyles?: string };
  /** `p:defaultTextStyle`, the last thing text without a placeholder inherits from */
  defaultTextStyle?: string;
  /** `.pptm`: adds a `vbaProject.bin` part and its relationship */
  vba?: boolean;
}

const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const LAYOUT_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
const NOTES_SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const NOTES_MASTER_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml';

const GROUP_HEADER = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/** The notes master a PowerPoint deck carries: the slide thumbnail and the notes body it inherits from. */
function notesMasterXml(): string {
  const sldImg = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="685800"/><a:ext cx="5486400" cy="3086100"/></a:xfrm></p:spPr></p:sp>';
  const body = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="3886200"/><a:ext cx="5486400" cy="4114800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_HEADER}${sldImg}${body}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr/></p:notesStyle></p:notesMaster>`;
}

/** A hand-assembled package, no deckflip emit involved: the shape a foreign deck has. */
export async function buildPptx(options: FixtureOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  const slides = options.slides ?? [{}];
  const layouts: Record<string, { name: string; shapes?: string }> = Object.fromEntries(
    Object.entries({ 'slideLayout1.xml': 'Blank', ...options.layouts }).map(([file, layout]) => [file, typeof layout === 'string' ? { name: layout } : layout]),
  );
  const slideFiles = slides.map((slide, index) => slide.file ?? `slide${index + 1}.xml`);
  const notesFiles = slides.map((slide, index) => (slide.notes === undefined ? undefined : `notesSlide${index + 1}.xml`));
  const hasNotes = notesFiles.some((file) => file !== undefined);

  const defaults = { rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', ...options.contentTypes?.defaults };
  const overrides: Record<string, string> = {
    '/ppt/presentation.xml': `application/vnd.openxmlformats-officedocument.presentationml.${options.vba ? 'presentation.macroEnabled' : 'presentation'}.main+xml`,
    '/ppt/slideMasters/slideMaster1.xml': 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
    ...Object.fromEntries(Object.keys(layouts).map((file) => [`/ppt/slideLayouts/${file}`, LAYOUT_CT])),
    ...Object.fromEntries(slideFiles.map((file) => [`/ppt/slides/${file}`, SLIDE_CT])),
    '/ppt/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
    '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
    '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    ...(options.vba ? { '/ppt/vbaProject.bin': 'application/vnd.ms-office.vbaProject' } : {}),
    ...(hasNotes ? { '/ppt/notesMasters/notesMaster1.xml': NOTES_MASTER_CT, '/ppt/theme/theme2.xml': 'application/vnd.openxmlformats-officedocument.theme+xml' } : {}),
    ...Object.fromEntries(notesFiles.filter((file) => file !== undefined).map((file) => [`/ppt/notesSlides/${file}`, NOTES_SLIDE_CT])),
    ...options.contentTypes?.overrides,
  };
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${Object.entries(defaults).map(([ext, ct]) => `<Default Extension="${ext}" ContentType="${ct}"/>`).join('')}${Object.entries(overrides).map(([part, ct]) => `<Override PartName="${part}" ContentType="${ct}"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', rels([
    ['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'extended-properties', 'docProps/app.xml'],
  ]));
  zip.file('docProps/core.xml', coreXml());
  zip.file('docProps/app.xml', appXml());

  const sldIds = slideFiles.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${2 + index}"/>`).join('');
  const presentationRels: Array<[string, string, string]> = [
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ...slideFiles.map((file, index): [string, string, string] => [`rId${2 + index}`, 'slide', `slides/${file}`]),
    [`rId${2 + slideFiles.length}`, 'theme', 'theme/theme1.xml'],
  ];
  if (options.vba) {
    presentationRels.push([`rId${presentationRels.length + 1}`, 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin']);
  }
  const notesMasterRelId = `rId${presentationRels.length + 1}`;
  if (hasNotes) {
    presentationRels.push([notesMasterRelId, 'notesMaster', 'notesMasters/notesMaster1.xml']);
  }
  const notesMasterIdLst = hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRelId}"/></p:notesMasterIdLst>` : '';
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesMasterIdLst}<p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${WIDTH}" cy="${HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/>${options.defaultTextStyle ?? ''}${options.presentationTail ?? ''}</p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels(presentationRels));

  if (hasNotes) {
    // PowerPoint gives each master a theme part of its own, and repairs a deck whose masters share one
    zip.file('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme2.xml']]));
    zip.file('ppt/theme/theme2.xml', themeXml());
  }

  const layoutFiles = Object.keys(layouts);
  const layoutIds = layoutFiles.map((_, index) => `<p:sldLayoutId id="${2147483649 + index}" r:id="rId${1 + index}"/>`).join('');
  const txStyles = options.master?.txStyles ?? '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr/></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles>';
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_HEADER}${options.master?.shapes ?? ''}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>${txStyles}</p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    ...layoutFiles.map((file, index): [string, string, string] => [`rId${1 + index}`, 'slideLayout', `../slideLayouts/${file}`]),
    [`rId${1 + layoutFiles.length}`, 'theme', '../theme/theme1.xml'],
  ]));
  for (const [file, layout] of Object.entries(layouts)) {
    zip.file(`ppt/slideLayouts/${file}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="${layout.name}"><p:spTree>${GROUP_HEADER}${layout.shapes ?? ''}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    zip.file(`ppt/slideLayouts/_rels/${file}.rels`, rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  }

  slides.forEach((slide, index) => {
    const file = slideFiles[index]!;
    const notesFile = notesFiles[index];
    const slideRels: Array<[string, string, string]> = [['rId1', 'slideLayout', `../slideLayouts/${slide.layout ?? 'slideLayout1.xml'}`], ...(slide.rels ?? [])];
    if (notesFile !== undefined) {
      const taken = slideRels.map(([id]) => Number(/^rId(\d+)$/.exec(id)?.[1] ?? 0));
      slideRels.push([`rId${Math.max(...taken) + 1}`, 'notesSlide', `../notesSlides/${notesFile}`]);
      zip.file(`ppt/notesSlides/${notesFile}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${NS}><p:cSld><p:spTree>${GROUP_HEADER}${slide.notes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      zip.file(`ppt/notesSlides/_rels/${notesFile}.rels`, rels([
        ['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'],
        ['rId2', 'slide', `../slides/${file}`],
        ...(slide.notesRels ?? []),
      ]));
    }
    zip.file(`ppt/slides/${file}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld${slide.name === undefined ? '' : ` name="${slide.name}"`}>${slide.background ?? ''}<p:spTree>${GROUP_HEADER}${slide.shapes ?? ''}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${slide.tail ?? ''}</p:sld>`);
    zip.file(`ppt/slides/_rels/${file}.rels`, rels(slideRels));
  });
  zip.file('ppt/theme/theme1.xml', themeXml());
  if (options.vba) zip.file('ppt/vbaProject.bin', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
  for (const [path, content] of Object.entries(options.parts ?? {})) {
    zip.file(path, content);
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

export function buildBlankPptx(): Promise<Buffer> {
  return buildPptx();
}
