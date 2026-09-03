// Speaker notes (docs/spec/06-round-trip.md "Speaker notes"): one `p:notes` part per Slide that carries
// them, all inheriting from a single notes master. PowerPoint's notes pane reads the `body` placeholder;
// the `sldImg` placeholder beside it is where the printed notes page draws the slide thumbnail.

import path from 'node:path';
import type { Canvas, TextBody } from '../model/index.js';
import { CT, REL, type OpcPackage } from '../ooxml/opc.js';
import { el, serialize, type XmlNode } from '../ooxml/xml.js';
import { buildTextBody, type TextEmissionContext } from './text.js';
import { emitOwnTheme } from './theme.js';

export const NOTES_MASTER_PART = '/ppt/notesMasters/notesMaster1.xml';

/** the notes page, as `p:notesSz` declares it: 7.5 x 10 in portrait */
const PAGE_WIDTH = 6858000;
const PAGE_HEIGHT = 9144000;
/** 0.75 in around the thumbnail, 0.125 in between it and the notes, 0.5 in below them */
const MARGIN = 685800;
const GAP = 114300;
const BOTTOM_MARGIN = 457200;

const CLR_MAP = {
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
} as const;

export interface NotesEmissionContext {
  deckLang: string;
  /** the notes master the notes slide inherits from: the source's when there is one, else the tool's */
  masterPart: string;
  /** slide id -> part name, for slide jumps written inside the notes text */
  slidePartById: Map<string, string>;
}

export function notesSlidePartName(index: number): string {
  return `/ppt/notesSlides/notesSlide${index}.xml`;
}

/** The tool's own notes master, for a deck whose source has none, on a theme part of its own at `themePart`. */
export function emitNotesMaster(pkg: OpcPackage, canvas: Canvas, themePart: string): void {
  emitOwnTheme(pkg, NOTES_MASTER_PART, themePart);
  pkg.addPart(NOTES_MASTER_PART, CT.notesMaster, serialize(buildNotesMasterXml(canvas)));
}

/** The notes slide part name, related both ways: the slide points at it, it points back. */
export function emitNotesSlide(pkg: OpcPackage, slidePart: string, partName: string, notes: TextBody, ctx: NotesEmissionContext): void {
  pkg.addRelationship(partName, REL.notesMaster, relativeTarget(partName, ctx.masterPart));
  pkg.addRelationship(partName, REL.slide, relativeTarget(partName, slidePart));

  const textCtx: TextEmissionContext = {
    deckLang: ctx.deckLang,
    sourceSlidePart: partName,
    slidePartById: ctx.slidePartById,
    addRelationship: (type, target, opts) => pkg.addRelationship(partName, type, target, opts),
  };

  pkg.addPart(
    partName,
    CT.notesSlide,
    serialize(
      el(
        'p:notes',
        pptNs(),
        el('p:cSld', {}, el('p:spTree', {}, groupHeader(), slideImagePlaceholder(), notesPlaceholder(buildTextBody(notes, textCtx, {}, { measured: false })))),
        el('p:clrMapOvr', {}, el('a:masterClrMapping')),
      ),
    ),
  );
  pkg.addRelationship(slidePart, REL.notesSlide, relativeTarget(slidePart, partName));
}

function buildNotesMasterXml(canvas: Canvas): XmlNode {
  const thumbnailHeight = Math.round(((PAGE_WIDTH - 2 * MARGIN) * canvas.height) / canvas.width);
  const bodyTop = MARGIN + thumbnailHeight + GAP;
  return el(
    'p:notesMaster',
    pptNs(),
    el(
      'p:cSld',
      {},
      el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' }))),
      el(
        'p:spTree',
        {},
        groupHeader(),
        slideImagePlaceholder(xfrm(MARGIN, MARGIN, PAGE_WIDTH - 2 * MARGIN, thumbnailHeight)),
        notesPlaceholder(el('p:txBody', {}, el('a:bodyPr'), el('a:lstStyle'), el('a:p')), xfrm(MARGIN, bodyTop, PAGE_WIDTH - 2 * MARGIN, PAGE_HEIGHT - bodyTop - BOTTOM_MARGIN)),
      ),
    ),
    el('p:clrMap', CLR_MAP),
    // the size a notes body has in PowerPoint, since the notes text itself carries none
    el('p:notesStyle', {}, el('a:lvl1pPr', {}, el('a:defRPr', { sz: 1200 }))),
  );
}

/** The shape tree's own non-visual properties; the notes page needs no group transform of its own. */
function groupHeader(): XmlNode[] {
  return [
    el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
    el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
  ];
}

function slideImagePlaceholder(transform?: XmlNode): XmlNode {
  return el(
    'p:sp',
    {},
    el(
      'p:nvSpPr',
      {},
      el('p:cNvPr', { id: 2, name: 'Slide Image Placeholder 1' }),
      el('p:cNvSpPr', {}, el('a:spLocks', { noGrp: 1, noRot: 1, noChangeAspect: 1 })),
      el('p:nvPr', {}, el('p:ph', { type: 'sldImg' })),
    ),
    el('p:spPr', {}, transform),
  );
}

function notesPlaceholder(text: XmlNode, transform?: XmlNode): XmlNode {
  return el(
    'p:sp',
    {},
    el(
      'p:nvSpPr',
      {},
      el('p:cNvPr', { id: 3, name: 'Notes Placeholder 2' }),
      el('p:cNvSpPr', {}, el('a:spLocks', { noGrp: 1 })),
      el('p:nvPr', {}, el('p:ph', { type: 'body', idx: 1 })),
    ),
    el('p:spPr', {}, transform),
    text,
  );
}

function xfrm(x: number, y: number, cx: number, cy: number): XmlNode {
  return el('a:xfrm', {}, el('a:off', { x, y }), el('a:ext', { cx, cy }));
}

function relativeTarget(from: string, to: string): string {
  return path.posix.relative(path.posix.dirname(from), to);
}

function pptNs(): Record<string, string> {
  return {
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
  };
}
