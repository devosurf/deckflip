import type { Deck } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { CT, REL, OpcPackage } from '../ooxml/opc.js';
import { parseXml, el, serialize, type XmlNode } from '../ooxml/xml.js';
import { MediaStore } from './media.js';
import { emitNotesMaster, emitNotesSlide, notesSlidePartName, NOTES_MASTER_PART } from './notes.js';
import { emitPreservedPptx, type PreservedSource } from './preserved.js';
import { deckSections, sectionExtNode } from './sections.js';
import { emitSlide, slidePartName } from './slide.js';

export interface EmitOptions {
  created?: Date;
  appVersion: string;
  /** the round trip's source package and plan: the deck is emitted over it instead of the built-in master */
  preserved?: PreservedSource;
}

const DEFAULT_DATE = new Date('1980-01-01T00:00:00.000Z');
const MASTER_PART = '/ppt/slideMasters/slideMaster1.xml';
const LAYOUT_PART = '/ppt/slideLayouts/slideLayout1.xml';
const THEME_PART = '/ppt/theme/theme1.xml';
const PRESENTATION_PART = '/ppt/presentation.xml';
const CORE_PART = '/docProps/core.xml';
const APP_PART = '/docProps/app.xml';

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

export async function emitPptx(deck: Deck, opts: EmitOptions): Promise<Buffer> {
  const created = opts.created ?? DEFAULT_DATE;
  if (opts.preserved) {
    return emitPreservedPptx(deck, opts.preserved, created);
  }
  const pkg = new OpcPackage();
  const slidePartById = new Map(deck.slides.map((slide) => [slide.id, slidePartName(slide.index)] as const));

  pkg.addRelationship('/', REL.officeDocument, 'ppt/presentation.xml');
  pkg.addRelationship('/', REL.coreProperties, 'docProps/core.xml');
  pkg.addRelationship('/', REL.extendedProperties, 'docProps/app.xml');

  const presentationMasterId = pkg.addRelationship(PRESENTATION_PART, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const notesMasterId = deck.slides.some((slide) => slide.notes) ? pkg.addRelationship(PRESENTATION_PART, REL.notesMaster, 'notesMasters/notesMaster1.xml') : undefined;
  const presentationSlideIds = deck.slides.map((slide) => pkg.addRelationship(PRESENTATION_PART, REL.slide, `slides/slide${slide.index}.xml`));
  pkg.addRelationship(PRESENTATION_PART, REL.theme, 'theme/theme1.xml');

  const masterLayoutId = pkg.addRelationship(MASTER_PART, REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  pkg.addRelationship(MASTER_PART, REL.theme, '../theme/theme1.xml');
  pkg.addRelationship(LAYOUT_PART, REL.slideMaster, '../slideMasters/slideMaster1.xml');

  pkg.addPart(CORE_PART, CT.core, serialize(buildCoreXml(deck, created)));
  pkg.addPart(APP_PART, CT.app, serialize(buildAppXml(opts.appVersion, deck.slides.length)));
  pkg.addPart(PRESENTATION_PART, CT.presentation, serialize(buildPresentationXml(deck, presentationMasterId, notesMasterId, presentationSlideIds)));
  pkg.addPart(MASTER_PART, CT.slideMaster, serialize(buildMasterXml(masterLayoutId)));
  pkg.addPart(LAYOUT_PART, CT.slideLayout, serialize(buildLayoutXml()));
  if (notesMasterId) {
    emitNotesMaster(pkg, deck.canvas, THEME_PART);
  }

  const media = new MediaStore(pkg);
  const notesCtx = { deckLang: deck.lang, masterPart: NOTES_MASTER_PART, slidePartById };
  for (const slide of deck.slides) {
    const slidePart = emitSlide(pkg, slide, { deck, slidePartById, media });
    if (slide.notes) {
      emitNotesSlide(pkg, slide, slidePart, notesSlidePartName(slide.index), notesCtx);
    }
  }

  pkg.addPart(THEME_PART, CT.theme, serialize(buildThemeXml()));

  return pkg.toBuffer({ date: created, compression: 'DEFLATE' });
}

function buildPresentationXml(deck: Deck, masterId: string, notesMasterId: string | undefined, slideIds: string[]): XmlNode {
  const sldIds = slideIds.map((_, index) => 256 + index);
  const sections = deckSections(deck.slides, sldIds);
  return el(
    'p:presentation',
    pptNs(),
    el('p:sldMasterIdLst', {}, el('p:sldMasterId', { id: 2147483648, 'r:id': masterId })),
    notesMasterId ? el('p:notesMasterIdLst', {}, el('p:notesMasterId', { 'r:id': notesMasterId })) : undefined,
    el('p:sldIdLst', {}, ...slideIds.map((rId, index) => el('p:sldId', { id: sldIds[index], 'r:id': rId }))),
    el('p:sldSz', { cx: pxToEmu(deck.canvas.width), cy: pxToEmu(deck.canvas.height) }),
    el('p:notesSz', { cx: 6858000, cy: 9144000 }),
    // CT_Presentation puts extensions last
    sections.length === 0 ? undefined : el('p:extLst', {}, sectionExtNode(sections)),
  );
}

function buildCoreXml(deck: Deck, created: Date): XmlNode {
  const when = toW3CDTF(created);
  return el(
    'cp:coreProperties',
    {
      'xmlns:cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
      'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      'xmlns:dcterms': 'http://purl.org/dc/terms/',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    },
    el('dc:title', {}, deck.title),
    el('dc:creator', {}, 'deckflip'),
    el('cp:lastModifiedBy', {}, 'deckflip'),
    el('dc:language', {}, deck.lang),
    el('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' }, when),
    el('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' }, when),
  );
}

function buildAppXml(appVersion: string, slideCount: number): XmlNode {
  return el(
    'Properties',
    {
      xmlns: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
      'xmlns:vt': 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
    },
    el('Application', {}, 'deckflip'),
    el('Slides', {}, String(slideCount)),
    el('AppVersion', {}, appVersion),
  );
}

function buildMasterXml(layoutId: string): XmlNode {
  return el(
    'p:sldMaster',
    pptNs(),
    el(
      'p:cSld',
      {},
      el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' }))),
      el(
        'p:spTree',
        {},
        el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
        el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
      ),
    ),
    el(
      'p:clrMap',
      {
        bg1: 'lt1',
        tx1: 'dk1',
        bg2: 'lt2',
        tx2: 'dk2',
        accent1: 'accent1',
        accent2: 'accent2',
        accent3: 'accent3',
        accent4: 'accent4',
        accent5: 'accent5',
        accent6: 'accent6',
        hlink: 'hlink',
        folHlink: 'folHlink',
      },
    ),
    el('p:sldLayoutIdLst', {}, el('p:sldLayoutId', { id: 2147483649, 'r:id': layoutId })),
    el('p:txStyles', {}, el('p:titleStyle', {}, el('a:lvl1pPr')), el('p:bodyStyle', {}, el('a:lvl1pPr')), el('p:otherStyle', {}, el('a:lvl1pPr'))),
  );
}

function buildLayoutXml(): XmlNode {
  return el(
    'p:sldLayout',
    { ...pptNs(), type: 'blank', preserve: '1' },
    el(
      'p:cSld',
      { name: 'Blank' },
      el(
        'p:spTree',
        {},
        el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
        el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
      ),
    ),
    el('p:clrMapOvr', {}, el('a:masterClrMapping')),
  );
}

function buildThemeXml(): XmlNode {
  return parseXml(THEME_XML);
}

function pptNs(): Record<string, string> {
  return {
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
  };
}

function toW3CDTF(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
