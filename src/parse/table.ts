// `p:graphicFrame` holding an `a:tbl` -> TableElement: the inverse of emit/table.ts. The grid and row heights
// map one to one; a cell's `a:tcPr` insets become its padding (the text body's own padding stays zero, as the
// html side measures cells), its edge lines the per-side borders, its solid fill the fill.

import type { Line, TableCell, TableElement, TableRow } from '../model/index.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { readFill, readLine, readTransform, shapeIdentity, shapeName, type DrawingContext } from './drawing.js';
import { DEFAULT_INSET, readRunStyle, readTextBody, type TextContext } from './text.js';
import { px } from './units.js';
import { child, children } from './xml.js';

const ZERO_INSETS = { l: 0, t: 0, r: 0, b: 0 };

/** Undefined for graphic frames that hold anything but a table (charts, diagrams: opaque records of spec 06, a later slice). */
export async function readTable(frame: XmlNode, ctx: DrawingContext & TextContext & { slide: number }): Promise<TableElement | undefined> {
  const tbl = child(child(child(frame, 'a:graphic'), 'a:graphicData'), 'a:tbl');
  if (!tbl) {
    return undefined;
  }
  const nvPr = child(frame, 'p:nvGraphicFramePr');
  const rows: TableRow[] = [];
  for (const tr of children(tbl, 'a:tr')) {
    const cells: TableCell[] = [];
    for (const tc of children(tr, 'a:tc')) {
      cells.push(await readCell(tc, ctx));
    }
    rows.push({ height: px(tr.attrs.h), cells });
  }
  return {
    kind: 'table',
    ...shapeIdentity(nvPr, ctx.slide),
    name: shapeName(nvPr),
    box: readTransform(child(frame, 'p:xfrm')).frame,
    columns: children(child(tbl, 'a:tblGrid'), 'a:gridCol').map((col) => px(col.attrs.w)),
    rows,
  };
}

const EDGES: ReadonlyArray<[keyof TableCell['borders'], string]> = [
  ['top', 'a:lnT'],
  ['right', 'a:lnR'],
  ['bottom', 'a:lnB'],
  ['left', 'a:lnL'],
];

async function readCell(tc: XmlNode, ctx: DrawingContext & TextContext & { slide: number }): Promise<TableCell> {
  const txBody = child(tc, 'a:txBody');
  // the emitter reads a cell's first paragraph for its end-paragraph size, so a body always has one
  const text = readTextBody(children(txBody, 'a:p').length > 0 ? txBody : el('a:txBody', {}, el('a:p')), ctx)!;
  text.padding = { ...ZERO_INSETS };
  const cell: TableCell = {
    colSpan: Number(tc.attrs.gridSpan ?? 1),
    rowSpan: Number(tc.attrs.rowSpan ?? 1),
    borders: {},
    padding: { ...ZERO_INSETS },
    anchor: 't',
    text,
  };
  const merged = tc.attrs.hMerge === '1' ? 'h' : tc.attrs.vMerge === '1' ? 'v' : undefined;
  if (merged) {
    // a continuation cell carries no content: only its end-paragraph size survives emission, kept as the
    // one empty run the html side gives such cells
    cell.merged = merged;
    const first = text.paragraphs[0]!;
    if (!first.runs.some((run) => run.kind === 'text')) {
      first.runs.push({ kind: 'text', text: '', style: readRunStyle(child(child(txBody, 'a:p'), 'a:endParaRPr') ? [child(child(txBody, 'a:p'), 'a:endParaRPr')!] : [], ctx) });
    }
    return cell;
  }
  const tcPr = child(tc, 'a:tcPr');
  cell.padding = {
    l: px(tcPr?.attrs.marL ?? DEFAULT_INSET.l),
    t: px(tcPr?.attrs.marT ?? DEFAULT_INSET.t),
    r: px(tcPr?.attrs.marR ?? DEFAULT_INSET.r),
    b: px(tcPr?.attrs.marB ?? DEFAULT_INSET.b),
  };
  const anchor = tcPr?.attrs.anchor;
  cell.anchor = anchor === 'ctr' || anchor === 'b' ? anchor : 't';
  for (const [side, name] of EDGES) {
    const line: Line | undefined = readLine(child(tcPr, name), ctx.colors);
    if (line) {
      cell.borders[side] = line;
    }
  }
  const fill = await readFill(tcPr, ctx);
  if (fill) {
    cell.fill = fill;
  }
  return cell;
}
