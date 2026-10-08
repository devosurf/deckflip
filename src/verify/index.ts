// Verification (docs/spec/10-rendering-and-verification.md): after a conversion writes output, compare what
// the source shows with what the output contains. The HTML side is Chromium's measurement and census of the
// rendered Slides, the PPTX side is the package read back by the parser; a mismatch is a deckflip defect,
// never an authoring choice, so every finding is a `VERIFY_*` error.

import type { BrowserCensus } from '../html/browser-script.js';
import { groupToCanvas, transformedBounds, type Matrix2d } from '../model/geometry.js';
import type { Box, Deck, Element, Slide, TextBody } from '../model/index.js';
import { entry } from '../report/codes.js';
import type { Entry, Locator } from '../report/types.js';

/** The kind of Deck a conversion started from: its side is the truth the other is verified against. */
export type Side = 'html' | 'pptx';

/** The HTML side of a conversion as Chromium laid it out: the measured Deck and one census per Slide. */
export interface HtmlSide {
  deck: Deck;
  census: BrowserCensus[];
}

/** An element at its Canvas position: axis-aligned bounds through every enclosing group, plus how far it may legitimately move. */
interface Placed {
  element: Element;
  bounds: Box;
  rotation: number;
  /** CSS px the left and right edges may differ by: the comparison tolerance plus the widening of a wrap-width guard */
  slackX: number;
  /** the same for the top and bottom edges, which a guard only moves when the element is turned */
  slackY: number;
}

interface TextRun {
  locator: Locator | undefined;
  /** how the reason names the owner */
  label: string;
  tokens: string[];
}

const SIDE_NAME: Record<Side, string> = { html: 'HTML', pptx: 'PPTX' };
const IDENTITY: Matrix2d = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** CSS px per edge; Chromium's 1/64 px layout units survive the EMU round trip well inside it */
const GEOMETRY_TOLERANCE = 0.5;
const ROTATION_TOLERANCE = 0.1;
const QUOTE_LIMIT = 80;

export function verifyDecks(html: HtmlSide, pptx: Deck, sourceSide: Side): Entry[] {
  const entries: Entry[] = [];
  const slides = Math.max(html.census.length, pptx.slides.length);
  for (let index = 0; index < slides; index += 1) {
    entries.push(...verifySlide(html.deck.slides[index], html.census[index], pptx.slides[index], sourceSide, index + 1));
  }
  return entries;
}

function verifySlide(htmlSlide: Slide | undefined, census: BrowserCensus | undefined, pptxSlide: Slide | undefined, sourceSide: Side, slide: number): Entry[] {
  const outputSide: Side = sourceSide === 'html' ? 'pptx' : 'html';
  const placed: Record<Side, Placed[]> = { html: place(htmlSlide?.elements ?? []), pptx: place(pptxSlide?.elements ?? []) };
  const { pairs, missing, extra } = pair(placed[sourceSide], placed[outputSide]);
  const counterpart = new Map<Element, Element>(pairs.map(([source, output]) => [output.element, source.element]));
  // An element is reported where the input names it: its own source element, or the source element it was paired with.
  const locate = (element: Element, side: Side): Locator => {
    const anchor = side === sourceSide ? element : counterpart.get(element);
    return anchor ? locatorOf(anchor, sourceSide === 'html') : locatorOf(element, false);
  };
  const pptxById = new Map(placed.pptx.flatMap(({ element }) => (element.shapeId === undefined ? [] : [[element.shapeId, element] as const])));

  const text: Record<Side, TextRun[]> = {
    html: (census?.text ?? []).map((run) => {
      const shape = run.owner.shapeId === undefined ? undefined : pptxById.get(run.owner.shapeId);
      return { locator: sourceSide === 'pptx' && shape ? locatorOf(shape, false) : { selector: run.owner.selector }, label: run.owner.selector, tokens: tokens(run.text) };
    }),
    pptx: (pptxSlide?.elements ?? []).flatMap((element) => textRuns(element, locate)),
  };
  const notes: Record<Side, TextRun[]> = {
    html: [{ locator: { selector: 'aside.notes' }, label: 'the speaker notes', tokens: tokens(census?.notes ?? '') }],
    pptx: [{ locator: undefined, label: 'the speaker notes', tokens: tokens(pptxSlide?.notes ? bodyText(pptxSlide.notes) : '') }],
  };

  const entries: Entry[] = [];
  for (const runs of [text, notes]) {
    entries.push(...compareText(runs[sourceSide], runs[outputSide], slide, sourceSide));
  }
  // Opaque content only reaches a PPTX spliced from the source package; when that is gone or incomplete the
  // round trip reports it (`PRESERVE_SOURCE_MISSING`, `PRESERVE_UNKNOWN_ID`), so its absence is no finding here.
  for (const lone of missing.filter(({ element }) => paints(element) && !(sourceSide === 'html' && element.kind === 'opaque'))) {
    entries.push(entry('VERIFY_GEOMETRY', { slide, locator: locate(lone.element, sourceSide), reason: `${lone.element.name} is missing from the ${SIDE_NAME[outputSide]}` }));
  }
  for (const lone of extra.filter(({ element }) => paints(element))) {
    entries.push(entry('VERIFY_GEOMETRY', { slide, locator: locate(lone.element, outputSide), reason: `${lone.element.name} in the ${SIDE_NAME[outputSide]} has no counterpart in the ${SIDE_NAME[sourceSide]}` }));
  }
  for (const [source, output] of pairs) {
    const driftX = Math.max(Math.abs(source.bounds.x - output.bounds.x), Math.abs(source.bounds.x + source.bounds.w - output.bounds.x - output.bounds.w));
    const driftY = Math.max(Math.abs(source.bounds.y - output.bounds.y), Math.abs(source.bounds.y + source.bounds.h - output.bounds.y - output.bounds.h));
    const drift = Math.max(driftX, driftY);
    if (driftX > Math.max(source.slackX, output.slackX) || driftY > Math.max(source.slackY, output.slackY)) {
      entries.push(entry('VERIFY_GEOMETRY', { slide, locator: locate(source.element, sourceSide), reason: `${source.element.name} is ${describe(output.bounds)} in the ${SIDE_NAME[outputSide]}, ${round(drift)} px from ${describe(source.bounds)} in the ${SIDE_NAME[sourceSide]}` }));
    } else if (Math.abs(normalizeAngle(source.rotation - output.rotation)) > ROTATION_TOLERANCE) {
      entries.push(entry('VERIFY_GEOMETRY', { slide, locator: locate(source.element, sourceSide), reason: `${source.element.name} is rotated ${round(output.rotation)}° in the ${SIDE_NAME[outputSide]} but ${round(source.rotation)}° in the ${SIDE_NAME[sourceSide]}` }));
    }
  }
  entries.push(...compareStacking(census?.stacking ?? [], placed, pairs, sourceSide, slide, locate));
  return entries;
}

/** Chromium's stacking of every overlapping pair against the order of their counterparts in the PPTX shape tree. */
function compareStacking(stacking: BrowserCensus['stacking'], placed: Record<Side, Placed[]>, pairs: Array<[Placed, Placed]>, sourceSide: Side, slide: number, locate: (element: Element, side: Side) => Locator): Entry[] {
  // the census leaves out selectors two elements share (browser-script.ts `stackingOrder`); so must the lookup
  const selectors = placed.html.map(({ element }) => element.selector);
  const htmlBySelector = new Map(placed.html.filter(({ element }) => selectors.indexOf(element.selector) === selectors.lastIndexOf(element.selector)).map(({ element }) => [element.selector, element]));
  const pptxOf = new Map(pairs.map(([source, output]) => (sourceSide === 'html' ? [source.element, output.element] : [output.element, source.element])));
  const order = new Map(placed.pptx.map(({ element }, index) => [element, index]));
  const entries: Entry[] = [];
  for (const { above, below } of stacking) {
    const htmlAbove = htmlBySelector.get(above);
    const htmlBelow = htmlBySelector.get(below);
    const pptxAbove = htmlAbove && pptxOf.get(htmlAbove);
    const pptxBelow = htmlBelow && pptxOf.get(htmlBelow);
    if (!htmlAbove || !htmlBelow || !pptxAbove || !pptxBelow || order.get(pptxAbove)! > order.get(pptxBelow)!) continue;
    entries.push(sourceSide === 'html'
      ? entry('VERIFY_STACKING', { slide, locator: locate(htmlAbove, 'html'), reason: `${htmlAbove.name} is painted over ${htmlBelow.name} in the HTML but stacked under it in the PPTX` })
      : entry('VERIFY_STACKING', { slide, locator: locate(pptxBelow, 'pptx'), reason: `${pptxBelow.name} is stacked over ${pptxAbove.name} in the PPTX but Chromium paints it under it in the HTML` }));
  }
  return entries;
}

/**
 * Every element that paints, in paint order, at its Canvas bounds. A group contributes its children only: its own
 * box and child space are one of many equivalent framings. A picture's border, which the emitter writes as a
 * `<picture name> border` shape right after it, is part of the picture.
 */
function place(elements: Element[], toCanvas: Matrix2d = IDENTITY): Placed[] {
  const out: Placed[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.kind === 'group') {
      out.push(...place(element.children, groupToCanvas(element, toCanvas)));
      continue;
    }
    const next = elements[index + 1];
    if (element.kind === 'picture' && next?.kind === 'shape' && next.name === `${element.name} border` && !next.text) index += 1;
    const rotation = 'rotation' in element ? element.rotation : 0;
    // a guard widens the shape horizontally (narrowing stays in the insets), which only stays horizontal unrotated
    const widened = element.kind === 'shape' && element.text ? Math.max(0, element.text.trailingGuard) : 0;
    const axisAligned = rotation % 180 === 0 && toCanvas.b === 0 && toCanvas.c === 0;
    out.push({ element, bounds: transformedBounds(element.box, rotation, toCanvas), rotation, slackX: GEOMETRY_TOLERANCE + widened, slackY: GEOMETRY_TOLERANCE + (axisAligned ? 0 : widened) });
  }
  return out;
}

/**
 * Source and output elements that are the same element: equal `shapeId`s first (a round trip keeps them),
 * then the longest common subsequence of kind and name, which is how a fresh conversion names its shapes,
 * then leftovers of the same kind and name in order, so a reordered element is compared, not lost.
 */
function pair(source: Placed[], output: Placed[]): { pairs: Array<[Placed, Placed]>; missing: Placed[]; extra: Placed[] } {
  const pairs: Array<[Placed, Placed]> = [];
  const byId = new Map(output.flatMap((item) => (item.element.shapeId === undefined ? [] : [[item.element.shapeId, item] as const])));
  const paired = new Set<Placed>();
  const restSource: Placed[] = [];
  for (const item of source) {
    const match = item.element.shapeId === undefined ? undefined : byId.get(item.element.shapeId);
    if (match && !paired.has(match)) {
      pairs.push([item, match]);
      paired.add(match);
    } else {
      restSource.push(item);
    }
  }
  const restOutput = output.filter((item) => !paired.has(item));
  // a section's background shape is named after the section, whose id the HTML may carry or be given
  const key = (item: Placed): string => `${item.element.kind}\u0000${/^section\b/.test(item.element.name) ? 'section' : item.element.name}`;
  // lcs[i][j]: the longest common subsequence of restSource[i..] and restOutput[j..]
  const lcs = Array.from({ length: restSource.length + 1 }, () => new Array<number>(restOutput.length + 1).fill(0));
  for (let i = restSource.length - 1; i >= 0; i -= 1) {
    for (let j = restOutput.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = key(restSource[i]!) === key(restOutput[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const missing: Placed[] = [];
  const extra: Placed[] = [];
  let i = 0;
  let j = 0;
  while (i < restSource.length && j < restOutput.length) {
    if (key(restSource[i]!) === key(restOutput[j]!)) {
      pairs.push([restSource[i++]!, restOutput[j++]!]);
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      missing.push(restSource[i++]!);
    } else {
      extra.push(restOutput[j++]!);
    }
  }
  missing.push(...restSource.slice(i));
  extra.push(...restOutput.slice(j));
  for (const item of [...missing]) {
    const match = extra.find((candidate) => key(candidate) === key(item));
    if (!match) continue;
    pairs.push([item, match]);
    missing.splice(missing.indexOf(item), 1);
    extra.splice(extra.indexOf(match), 1);
  }
  return { pairs, missing, extra };
}

/** Whether a lone element would be seen: a shape needs a fill, stroke, shadow or text; everything else paints by nature. */
function paints(element: Element): boolean {
  if (element.kind !== 'shape') return true;
  const filled = element.fill !== undefined && !(element.fill.type === 'solid' && element.fill.color.alpha === 0);
  return filled || element.line !== undefined || element.borders !== undefined || element.shadow !== undefined || (element.text !== undefined && tokens(bodyText(element.text)).length > 0);
}

function locatorOf(element: Element, bySelector: boolean): Locator {
  return bySelector || element.shapeId === undefined ? { selector: element.selector } : { shapeId: element.shapeId, name: element.name };
}

/** Tokens missing from the output, at their source owner; tokens only the output holds, at their output owner. */
function compareText(source: TextRun[], output: TextRun[], slide: number, sourceSide: Side): Entry[] {
  const outputName = SIDE_NAME[sourceSide === 'html' ? 'pptx' : 'html'];
  const available = new Map<string, number>();
  for (const run of output) {
    for (const token of run.tokens) available.set(token, (available.get(token) ?? 0) + 1);
  }
  const entries: Entry[] = [];
  for (const run of source) {
    const lost = run.tokens.filter((token) => !take(available, token));
    if (lost.length > 0) {
      entries.push(entry('VERIFY_TEXT_MISSING', { slide, ...(run.locator ? { locator: run.locator } : {}), reason: `Text ${quote(lost)} of ${run.label} is missing from the ${outputName}` }));
    }
  }
  for (const run of output) {
    const extra = run.tokens.filter((token) => take(available, token));
    if (extra.length > 0) {
      entries.push(entry('VERIFY_TEXT_EXTRA', { slide, ...(run.locator ? { locator: run.locator } : {}), reason: `Text ${quote(extra)} of ${run.label} in the ${outputName} is not in the ${SIDE_NAME[sourceSide]}` }));
    }
  }
  return entries;
}

/** Consumes one occurrence of `token`; false when none is left. */
function take(counts: Map<string, number>, token: string): boolean {
  const left = counts.get(token) ?? 0;
  if (left === 0) return false;
  counts.set(token, left - 1);
  return true;
}

function textRuns(element: Element, locate: (element: Element, side: Side) => Locator): TextRun[] {
  const run = (body: TextBody): TextRun => ({ locator: locate(element, 'pptx'), label: element.name, tokens: tokens(bodyText(body)) });
  switch (element.kind) {
    case 'shape':
      return element.text ? [run(element.text)] : [];
    case 'table':
      return element.rows.flatMap((row) => row.cells.filter((cell) => !cell.merged).map((cell) => run(cell.text)));
    case 'group':
      return element.children.flatMap((child) => textRuns(child, locate));
    default:
      return [];
  }
}

function bodyText(body: TextBody): string {
  return body.paragraphs.map((paragraph) => paragraph.runs.map((run) => (run.kind === 'text' ? run.text : ' ')).join('')).join(' ');
}

function tokens(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean);
}

function quote(words: string[]): string {
  const text = words.join(' ');
  return `"${text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT - 1)}…` : text}"`;
}

function describe(box: Box): string {
  return `at (${round(box.x)}, ${round(box.y)}) sized ${round(box.w)}x${round(box.h)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 540) % 360 - 180;
}
