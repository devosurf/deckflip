import type { Line, TableCell, TableElement } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { baselineCorrectionPx, buildEndParaRPr, buildTextBody, firstTextRunStyle, solidFillNode, type TextEmissionContext } from './text.js';

const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';

/** `a:tbl` in a `p:graphicFrame`; every cell gets explicit insets, anchor, four edge lines and its fill (spec 04). */
export function buildTable(table: TableElement, ctx: TextEmissionContext, nextId: () => number): XmlNode {
  return el(
    'p:graphicFrame',
    {},
    el('p:nvGraphicFramePr', {}, el('p:cNvPr', { id: nextId(), name: table.name }), el('p:cNvGraphicFramePr', {}, el('a:graphicFrameLocks', { noGrp: '1' })), el('p:nvPr')),
    el('p:xfrm', {}, el('a:off', { x: pxToEmu(table.box.x), y: pxToEmu(table.box.y) }), el('a:ext', { cx: pxToEmu(table.box.w), cy: pxToEmu(table.box.h) })),
    el(
      'a:graphic',
      {},
      el(
        'a:graphicData',
        { uri: TABLE_URI },
        el(
          'a:tbl',
          {},
          el('a:tblPr'),
          el('a:tblGrid', {}, table.columns.map((width) => el('a:gridCol', { w: pxToEmu(width) }))),
          table.rows.map((row) => el('a:tr', { h: pxToEmu(row.height) }, row.cells.map((cell) => buildCell(cell, ctx)))),
        ),
      ),
    ),
  );
}

function buildCell(cell: TableCell, ctx: TextEmissionContext): XmlNode {
  const attrs: Record<string, string | number | undefined> = {
    gridSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
    rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
    hMerge: cell.merged === 'h' ? '1' : undefined,
    vMerge: cell.merged === 'v' ? '1' : undefined,
  };
  if (cell.merged) {
    // continuation cells carry no content; PowerPoint wants a well-formed empty body
    const style = firstTextRunStyle(cell.text.paragraphs[0]!);
    return el('a:tc', attrs, el('a:txBody', {}, el('a:bodyPr'), el('a:lstStyle'), el('a:p', {}, buildEndParaRPr(style?.size ?? 12, ctx.deckLang))), el('a:tcPr'));
  }
  const text = cell.text;
  const body = buildTextBody(text, ctx, {}, 'a:txBody');
  // the first-baseline correction (spec 04) applies to the top inset exactly as for a text box
  const baseline = cell.anchor === 't' && text.paragraphs[0] ? baselineCorrectionPx(text.paragraphs[0]) : 0;
  const tcPr = el(
    'a:tcPr',
    {
      marL: pxToEmu(text.padding.l + cell.padding.l),
      marR: pxToEmu(text.padding.r + cell.padding.r),
      marT: pxToEmu(Math.max(0, text.padding.t + cell.padding.t + text.firstParagraphGap - baseline)),
      marB: pxToEmu(text.padding.b + cell.padding.b + text.lastParagraphGap),
      anchor: cell.anchor,
    },
    edge('a:lnL', cell.borders.left),
    edge('a:lnR', cell.borders.right),
    edge('a:lnT', cell.borders.top),
    edge('a:lnB', cell.borders.bottom),
    cell.fill?.type === 'solid' ? solidFillNode(cell.fill.color) : undefined,
  );
  return el('a:tc', attrs, body, tcPr);
}

function edge(name: string, line: Line | undefined): XmlNode {
  if (!line) {
    return el(name, {}, el('a:noFill'));
  }
  const children: XmlNode[] = [solidFillNode(line.color)];
  if (line.dash === 'dash') {
    children.push(el('a:prstDash', { val: 'dash' }));
  } else if (line.dash === 'dot') {
    children.push(el('a:prstDash', { val: 'sysDot' }));
  }
  return el(name, { w: pxToEmu(line.width) }, children);
}
