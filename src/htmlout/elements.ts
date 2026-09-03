// Elements -> absolutely positioned HTML, in paint order. Each element becomes the tag its `name` records
// (`p:cNvPr/@name` is `tag`, `tag#id` or `tag.class`, as html/browser-script.ts `elementName` writes it), so
// that measuring the output names it the same way again.

import { createHash } from 'node:crypto';
import type { Element, GroupElement, Line, Media, OpaqueElement, PictureElement, ShapeElement, TableCell, TableElement } from '../model/index.js';
import { baselineCorrectionPx } from '../emit/text.js';
import { borderCss, boxCss, fillCss, geometryCss, lineValue, num, pxv, shadowCss } from './css.js';
import { attr, text as escape } from './escape.js';
import { firstStyle, layoutParagraph, runCss, Stylesheet, textBlockCss, textBodyHtml } from './text.js';

export interface ElementContext {
  sheet: Stylesheet;
  /** `<name>.assets/` as referenced from the HTML */
  assetsDir: string;
  assets: Map<string, Uint8Array>;
  /** the written `data-shape-id` -> every shape id the element stands for, in paint order, when there is more than its own */
  merged: Map<string, string[]>;
}

const EXTENSION: Record<Media['contentType'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** Content-hash named media under `media/`; the returned path is what `src`/`url()` reference. */
function mediaPath(media: Media, ctx: ElementContext): string {
  const hash = createHash('sha1').update(media.data).digest('hex').slice(0, 16);
  const relative = `media/${hash}.${EXTENSION[media.contentType]}`;
  if (!ctx.assets.has(relative)) {
    ctx.assets.set(relative, media.data);
  }
  return `${ctx.assetsDir}/${relative}`;
}

/** `tag`, `tag#id`, `tag.class` -> the opening-tag pieces that measure back to the same name; the name's class stays first (the measurer reads `classList[0]`). */
export function nameParts(name: string, extraClass?: string): { tag: string; attrs: string } {
  const match = /^([a-z][a-z0-9]*)(?:#([^\s.#]+)|\.([^\s.#]+))?/.exec(name);
  const tag = match?.[1] ?? 'div';
  const classes = [match?.[3], extraClass].filter((value): value is string => value !== undefined);
  const id = match?.[2] ? ` id="${attr(match[2])}"` : '';
  const cls = classes.length > 0 ? ` class="${attr(classes.join(' '))}"` : '';
  return { tag, attrs: `${id}${cls}` };
}

/**
 * `data-shape-id` for an element that came from a PPTX shape (spec 02), the key the round-trip manifest uses,
 * and `data-placeholder` for the layout placeholder it fills (spec 06 "Placeholders").
 */
function identityAttr(element: { shapeId?: string; placeholder?: string }): string {
  const shape = element.shapeId === undefined ? '' : ` data-shape-id="${attr(element.shapeId)}"`;
  return element.placeholder === undefined ? shape : `${shape} data-placeholder="${attr(element.placeholder)}"`;
}

function recordMerge(ctx: ElementContext, written: { shapeId?: string }, parts: Array<{ shapeId?: string }>): void {
  const ids = parts.map((part) => part.shapeId).filter((id): id is string => id !== undefined);
  if (written.shapeId !== undefined && ids.length > 1) ctx.merged.set(written.shapeId, ids);
}

export function elementsHtml(elements: Element[], origin: { x: number; y: number }, ctx: ElementContext): string[] {
  const out: string[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.kind === 'picture') {
      // the emitter writes a picture's border as a shape named `<picture name> border` right after it (emit/picture.ts)
      const next = elements[index + 1];
      const outline = next?.kind === 'shape' && next.name === `${element.name} border` && !next.text ? next : undefined;
      out.push(pictureHtml(element, outline, origin, ctx));
      if (outline) {
        recordMerge(ctx, element, [element, outline]);
        index += 1;
      }
      continue;
    }
    if (element.kind === 'shape' && element.text && nameParts(element.name).tag === 'caption' && elements[index + 1]?.kind === 'table') {
      // the measurer emits a table's caption as a leading shape and the table box without it (measureTable)
      const table = elements[index + 1] as TableElement;
      out.push(tableHtml(table, origin, ctx, element));
      recordMerge(ctx, table, [element, table]);
      index += 1;
      continue;
    }
    out.push(elementHtml(element, origin, ctx));
  }
  return out;
}

function elementHtml(element: Element, origin: { x: number; y: number }, ctx: ElementContext): string {
  switch (element.kind) {
    case 'shape':
      return shapeHtml(element, origin, ctx);
    case 'picture':
      return pictureHtml(element, undefined, origin, ctx);
    case 'table':
      return tableHtml(element, origin, ctx);
    case 'group':
      return groupHtml(element, origin, ctx);
    case 'opaque':
      return opaqueHtml(element, origin);
  }
}

/**
 * Opaque content (spec 06): an empty positioned box the stylesheet labels from `data-preserve` and `title`.
 * Empty on purpose: anything an author puts inside is a content edit the way back drops (`DROPPED_EDIT_OPAQUE`).
 */
function opaqueHtml(element: OpaqueElement, origin: { x: number; y: number }): string {
  return `<div data-preserve="${element.class}"${identityAttr(element)} title="${attr(element.name)}" style="${boxCss(local(element.box, origin), element.rotation).join('; ')}"></div>`;
}

function local(box: { x: number; y: number; w: number; h: number }, origin: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
  return { x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h };
}

function shapeDecorationCss(shape: ShapeElement, ctx: ElementContext): string[] {
  const out = [...geometryCss(shape.geometry)];
  if (shape.fill) {
    out.push(...(shape.fill.type === 'image' ? imageFillCss(shape.fill, shape.box, ctx) : fillCss(shape.fill)));
  }
  out.push(...borderCss(shape.line, shape.borders), ...shadowCss(shape.shadow));
  return out;
}

/** The measurer reads a text-bearing block as one shape; a text-free painted block as one shape too. */
export function shapeHtml(shape: ShapeElement, origin: { x: number; y: number }, ctx: ElementContext): string {
  const { tag, attrs: named } = nameParts(shape.name);
  const attrs = `${named}${identityAttr(shape)}${shape.preserve === undefined ? '' : ` data-preserve="${shape.preserve}"`}`;
  const css = [...boxCss(local(shape.box, origin), shape.rotation), 'box-sizing: border-box', 'margin: 0', ...shapeDecorationCss(shape, ctx)];
  if (!shape.text) {
    return `<${tag}${attrs} style="${css.join('; ')}"></${tag}>`;
  }
  const text = shape.text;
  if (tag === 'pre') {
    // the measurer reads a `pre` as one paragraph per line, all in the element's own style
    const style = firstStyle(text.paragraphs[0]!);
    const pre = nameParts(shape.name, style && ctx.sheet.classFor('t', runCss(style)));
    const lines = text.paragraphs.map((paragraph) => paragraph.runs.map((run) => (run.kind === 'text' ? escape(run.text) : '\n')).join('')).join('\n');
    return `<pre${pre.attrs}${identityAttr(shape)} style="${[...css, ...textBlockCss(text).filter((declaration) => !declaration.startsWith('white-space'))].join('; ')}">${lines}</pre>`;
  }
  return textBodyHtml(text, { tag, attrs, css: [...css, ...textBlockCss(text)] }, ctx.sheet);
}

/**
 * `background-image: url()`: a crop stretches the image over a rect the box is cut from (`background-size` +
 * `background-position`, no repeat); a tile repeats from its offset at the natural size times the scale.
 */
function imageFillCss(fill: Extract<ShapeElement['fill'], { type: 'image' }>, box: { w: number; h: number }, ctx: ElementContext): string[] {
  const out = [`background-image: url('${attr(mediaPath(fill.media, ctx))}')`];
  if ('tile' in fill) {
    const size = imageSize(fill.media);
    out.push('background-repeat: repeat', `background-position: ${pxv(fill.tile.x)} ${pxv(fill.tile.y)}`);
    if (size) {
      out.push(`background-size: ${pxv(size.w * fill.tile.scaleX)} ${pxv(size.h * fill.tile.scaleY)}`);
    }
    return out;
  }
  const { l, t, r, b } = fill.crop;
  const w = box.w / (1 - l - r);
  const h = box.h / (1 - t - b);
  out.push('background-repeat: no-repeat', `background-size: ${pxv(w)} ${pxv(h)}`, `background-position: ${pxv(-l * w)} ${pxv(-t * h)}`);
  return out;
}

/** Natural pixel size from the PNG IHDR or JPEG SOF header; undefined for anything else. */
export function imageSize(media: Media): { w: number; h: number } | undefined {
  const bytes = media.data;
  if (media.contentType === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: view.getUint32(16), h: view.getUint32(20) };
  }
  if (media.contentType === 'image/jpeg') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        return undefined;
      }
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: view.getUint16(offset + 7), h: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

/**
 * `img` at the painted rect (the box grown by the crop) clipped to the box, so the measurer's visible box and
 * crop fractions come back as they were; the vector payload is the `src` when present, the raster otherwise.
 * A border (the `<name> border` shape) goes on the picture itself, its box being the border box.
 */
function pictureHtml(picture: PictureElement, outline: ShapeElement | undefined, origin: { x: number; y: number }, ctx: ElementContext): string {
  const { tag, attrs: named } = nameParts(picture.name);
  const identity = identityAttr(picture);
  const attrs = `${named}${identity}`;
  const src = (): string => mediaPath(picture.vector ?? picture.media, ctx);
  const { l, t, r, b } = picture.crop;
  const box = local(picture.box, origin);
  const paintedW = box.w / (1 - l - r);
  const paintedH = box.h / (1 - t - b);
  const painted = { x: box.x - l * paintedW, y: box.y - t * paintedH, w: paintedW, h: paintedH };
  const cropped = l || t || r || b;
  const css: string[] = ['display: block', 'box-sizing: border-box', 'margin: 0', 'padding: 0'];
  if (outline) {
    css.push(...boxCss(local(outline.box, origin), picture.rotation), ...geometryCss(outline.geometry), ...borderCss(outline.line, outline.borders), 'object-fit: fill');
  } else if (cropped) {
    css.push(...boxCss(painted, 0), 'object-fit: fill', `clip-path: inset(${pxv(t * paintedH)} ${pxv(r * paintedW)} ${pxv(b * paintedH)} ${pxv(l * paintedW)})`);
    if (picture.rotation !== 0) {
      css.push(`transform-origin: ${pxv(l * paintedW + box.w / 2)} ${pxv(t * paintedH + box.h / 2)}`, `transform: rotate(${num(picture.rotation)}deg)`);
    }
  } else {
    css.push(...boxCss(box, picture.rotation), 'object-fit: fill', ...geometryCss(picture.geometry));
  }
  css.push(...shadowCss(picture.shadow));
  if (picture.opacity !== undefined) {
    css.push(`opacity: ${num(picture.opacity)}`);
  }
  if (picture.source === 'raster' && tag !== 'img' && tag !== 'svg') {
    // a rasterised subtree: the source tag again, showing its capture, marked so the measurer captures it again
    // (at the same DPI the capture is pixel-identical)
    return `<${tag}${attrs} data-raster style="${[...css, `background-image: url('${attr(src())}')`, 'background-size: 100% 100%'].join('; ')}"></${tag}>`;
  }
  const raster = picture.source === 'raster' ? ' data-raster' : '';
  if (tag === 'svg' && picture.vector && !raster) {
    // an inline `svg`: its payload is the measurer's serialisation of the element less `class`/`style`, so the
    // same markup with them added measures back to the same payload
    const markup = Buffer.from(picture.vector.data).toString('utf8');
    return markup.replace(/^(\s*<svg)/, `$1${attrs} style="${css.join('; ')}"`);
  }
  return `<img${tag === 'svg' ? identity : attrs}${raster} src="${attr(src())}" style="${css.join('; ')}">`;
}

/** `div[data-group]` at its box; children are positioned relative to it, in the child coordinate space. */
function groupHtml(group: GroupElement, origin: { x: number; y: number }, ctx: ElementContext): string {
  const { tag, attrs: named } = nameParts(group.name);
  const attrs = `${named}${identityAttr(group)}`;
  const box = local(group.box, origin);
  const css = boxCss(box, group.rotation);
  const children = elementsHtml(group.children, { x: group.childBox.x, y: group.childBox.y }, ctx);
  return `<${tag}${attrs} data-group style="${css.join('; ')}">${children.join('')}</${tag}>`;
}

/**
 * `table` with fixed layout and collapsed borders. Chromium grows a collapsed table's box by half its outer
 * borders and insets the rows by the same; the measurer folds those halves into the first/last column and
 * row and into the box, so the CSS sizes are the measurements less the halves.
 *
 * Each shared edge is drawn once, on the cell above/left of it (top/left edges only where that neighbour
 * cannot carry them). Ownership matters: computed style reports a cell's own border while only half the
 * collapsed edge lies inside its rect, so the measurer's content edge is off by `collapsed/2 - own`. The
 * IDM holds pass-one's offsets (in `padding.t` via the top inset, in block `marginLeft`); `cellHtml` removes
 * the offset this ownership will produce again, so the measurement comes back the same.
 *
 * A caption sits in the table wrapper above the grid: the element's `top` is the caption's, its `height` the
 * grid's (CSS `height` on a table is the grid, not the wrapper).
 */
function tableHtml(table: TableElement, origin: { x: number; y: number }, ctx: ElementContext, caption?: ShapeElement): string {
  // a table is a `table` element whatever PowerPoint named the frame ("Table 3"), because that is what the
  // measurer reads the grid, the columns and the cells back from
  const named = nameParts(table.name);
  const attrs = `${named.tag === 'table' ? named.attrs : ''}${identityAttr(table)}`;
  const box = local(table.box, origin);
  const top = caption ? local(caption.box, origin).y : box.y;
  const outer = outerBorders(table);
  const width = box.w - (outer.left + outer.right) / 2;
  const css = [...boxCss({ ...box, y: top, w: width, h: box.h - (outer.top + outer.bottom) / 2 }, 0), 'box-sizing: border-box', 'border-collapse: collapse', 'border-spacing: 0', 'table-layout: fixed', 'margin: 0'];
  const last = table.columns.length - 1;
  const cols = table.columns.map((measured, c) => `<col style="width: ${pxv(measured - (c === 0 ? outer.left / 2 : 0) - (c === last ? outer.right / 2 : 0))}">`).join('');
  const lastRow = table.rows.length - 1;
  const rows = table.rows
    .map((row, r) => `<tr style="height: ${pxv(row.height - (r === 0 ? outer.top / 2 : 0) - (r === lastRow ? outer.bottom / 2 : 0))}">${row.cells.map((cell, c) => (cell.merged ? '' : cellHtml(cell, edgeOwnership(table, r, c), ctx))).join('')}</tr>`)
    .join('');
  const captionHtml = caption ? textBodyHtml(caption.text!, { tag: 'caption', attrs: '', css: [`height: ${pxv(caption.box.h)}`, 'box-sizing: border-box', 'margin: 0', 'caption-side: top', ...shapeDecorationCss(caption, ctx), ...textBlockCss(caption.text!)] }, ctx.sheet) : '';
  return `<table${attrs} style="${css.join('; ')}">${captionHtml}<colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

/** The widest edge on each outer side of the grid: what the collapsed model draws half outside the rows. */
function outerBorders(table: TableElement): { top: number; right: number; bottom: number; left: number } {
  const widest = (cells: TableCell[], side: keyof TableCell['borders']): number => Math.max(0, ...cells.map((cell) => cell.borders[side]?.width ?? 0));
  const rows = table.rows;
  return {
    top: rows[0] ? widest(rows[0].cells, 'top') : 0,
    bottom: rows[rows.length - 1] ? widest(rows[rows.length - 1]!.cells, 'bottom') : 0,
    left: widest(rows.map((row) => row.cells[0]!).filter(Boolean), 'left'),
    right: widest(rows.map((row) => row.cells[row.cells.length - 1]!).filter(Boolean), 'right'),
  };
}

/** Whether the cell draws its own top/left edge: on the grid's edge, or when the neighbour there is a continuation slot (the emitter drops those cells' edges) or has no matching edge. */
function edgeOwnership(table: TableElement, r: number, c: number): { top: boolean; left: boolean } {
  const cell = table.rows[r]!.cells[c]!;
  const above = r > 0 ? table.rows[r - 1]!.cells[c] : undefined;
  const leftOf = c > 0 ? table.rows[r]!.cells[c - 1] : undefined;
  return {
    top: !above || above.merged !== undefined || (cell.borders.top !== undefined && above.borders.bottom === undefined),
    left: !leftOf || leftOf.merged !== undefined || (cell.borders.left !== undefined && leftOf.borders.right === undefined),
  };
}

function cellHtml(cell: TableCell, own: { top: boolean; left: boolean }, ctx: ElementContext): string {
  const first = cell.text.paragraphs[0] && layoutParagraph(cell.text.paragraphs[0]);
  const baseline = cell.anchor === 't' && first ? baselineCorrectionPx(first) : 0;
  // the offsets this ownership makes the measurer report: `collapsed/2 - own`; the top one is clamped at zero
  // and only kept for top-anchored cells (measureCellBody zeroes the gap on the unanchored side)
  const topOffset = own.top || cell.anchor !== 't' ? 0 : (cell.borders.top?.width ?? 0) / 2;
  const leftOffset = ((cell.borders.left?.width ?? 0) / 2) * (own.left ? -1 : 1);
  const css = [
    `padding: ${pxv(cell.padding.t - topOffset + baseline)} ${pxv(cell.padding.r)} ${pxv(cell.padding.b)} ${pxv(cell.padding.l)}`,
    `vertical-align: ${cell.anchor === 'ctr' ? 'middle' : cell.anchor === 'b' ? 'bottom' : 'top'}`,
    'box-sizing: border-box',
  ];
  const drawn: Array<[keyof TableCell['borders'], boolean]> = [['top', own.top], ['right', true], ['bottom', true], ['left', own.left]];
  for (const [side, draw] of drawn) {
    const edge: Line | undefined = cell.borders[side];
    css.push(`border-${side}: ${edge && draw ? lineValue(edge) : '0 none'}`);
  }
  if (cell.fill && cell.fill.type !== 'image') {
    css.push(...fillCss(cell.fill));
  }
  const block = textBlockCss({ ...cell.text, padding: { l: 0, t: 0, r: 0, b: 0 }, firstParagraphGap: 0, lastParagraphGap: 0 }).filter((declaration) => !declaration.startsWith('padding'));
  const span = `${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}`;
  const paragraphs = cell.text.paragraphs;
  const blocks = paragraphs.length > 1 || paragraphs[0]?.bullet;
  const text = blocks ? { ...cell.text, paragraphs: paragraphs.map((paragraph) => ({ ...paragraph, marginLeft: paragraph.marginLeft - leftOffset })) } : cell.text;
  return textBodyHtml(text, { tag: 'td', attrs: span, css: [...css, ...block] }, ctx.sheet);
}
