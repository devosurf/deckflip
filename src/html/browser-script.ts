import type { Align, AutonumScheme, Box, Bullet, Color, CornerRadius, Fill, Insets, Line, Paragraph, Run, RunStyle, ShapeElement, TextBody } from '../model/index.js';

export interface BrowserFontFace {
  family: string;
  file: string;
  weight?: number;
  italic?: boolean;
}

/** A report entry raised inside the page; measure.ts attaches slide, kind, severity and hint. */
export interface BrowserEntry {
  code: string;
  selector: string;
  reason: string;
}

export interface BrowserMeasureResult {
  meta: {
    id: string;
    title: string;
    layout: string;
    section: string | undefined;
    heading: string | undefined;
    docTitle: string;
  };
  sectionBox: Box;
  shapes: ShapeElement[];
  entries: BrowserEntry[];
  fontFaces: BrowserFontFace[];
}

export function measureSlideDocument(): BrowserMeasureResult {
  type LineGroup = { top: number; left: number; right: number; bottom: number; height: number };

  const section = document.querySelector('body > section') as HTMLElement | null;
  const docTitle = document.title.trim();

  if (!section) {
    return {
      meta: { id: '', title: docTitle, layout: 'Blank', section: undefined, heading: undefined, docTitle },
      sectionBox: { x: 0, y: 0, w: 0, h: 0 },
      shapes: [],
      entries: [],
      fontFaces: collectFontFaces(document.baseURI),
    };
  }

  const sectionRect = section.getBoundingClientRect();
  const sectionBox: Box = { x: round(sectionRect.left), y: round(sectionRect.top), w: round(sectionRect.width), h: round(sectionRect.height) };
  const sectionIndex = Array.from(section.parentElement?.children ?? []).filter((child) => child.tagName === 'SECTION').indexOf(section) + 1;
  const meta = {
    id: section.id || `slide-${sectionIndex}`,
    title: (section.getAttribute('data-title') || firstHeadingText(section) || `Slide ${sectionIndex}`).trim(),
    layout: (section.getAttribute('data-layout') || 'Blank').trim() || 'Blank',
    section: section.getAttribute('data-section') || undefined,
    heading: firstHeadingText(section) || undefined,
    docTitle,
  };

  const shapes: ShapeElement[] = [];
  const entries: BrowserEntry[] = [];
  for (const child of Array.from(section.children) as HTMLElement[]) {
    shapes.push(...walkElement(child));
  }
  return {
    meta,
    sectionBox,
    shapes,
    entries,
    fontFaces: collectFontFaces(document.baseURI),
  };


  function walkElement(el: HTMLElement): ShapeElement[] {
    if (isSkipped(el)) {
      return [];
    }

    const info = analyze(el);
    if (!info.selfPaint) {
      const nested: ShapeElement[] = [];
      for (const child of Array.from(el.children) as HTMLElement[]) {
        nested.push(...walkElement(child));
      }
      return nested;
    }

    // The element's own transform is disabled while it is measured: DrawingML wants the untransformed box plus
    // `rot`. Children are measured with it re-enabled, so translate-positioned parents place them correctly;
    // a rotated parent's children keep their axis-aligned bounds (a group is the way to rotate a subtree).
    if (info.selfTextBlock) {
      const measured = withoutTransform(el, () => measureTextBlock(el));
      return [makeShape(el, measured.box, measured.text)];
    }

    if (info.textBlockDescendants === 1 && info.paintableDescendants === 1) {
      const textEl = findUniqueTextBlockDescendant(el);
      if (textEl) {
        const measured = withoutTransform(el, () => {
          const inner = measureTextBlock(textEl);
          return { box: measuredBox(el), text: adjustTextForContainer(el, textEl, inner.text) };
        });
        return [makeShape(el, measured.box, measured.text)];
      }
    }

    const box = withoutTransform(el, () => measuredBox(el));
    const nested: ShapeElement[] = [];
    for (const child of Array.from(el.children) as HTMLElement[]) {
      nested.push(...walkElement(child));
    }
    return [makeShape(el, box), ...nested];
  }

  function withoutTransform<T>(el: HTMLElement, measure: () => T): T {
    const prior = el.style.getPropertyValue('transform');
    const priority = el.style.getPropertyPriority('transform');
    el.style.setProperty('transform', 'none', 'important');
    try {
      return measure();
    } finally {
      if (prior) {
        el.style.setProperty('transform', prior, priority);
      } else {
        el.style.removeProperty('transform');
      }
    }
  }

  function analyze(el: HTMLElement): { selfPaint: boolean; selfTextBlock: boolean; paintableDescendants: number; textBlockDescendants: number } {
    if (isSkipped(el)) {
      return { selfPaint: false, selfTextBlock: false, paintableDescendants: 0, textBlockDescendants: 0 };
    }
    const selfTextBlock = isTextBlock(el);
    const selfPaint = selfTextBlock || paints(el);
    let paintableDescendants = 0;
    let textBlockDescendants = 0;
    // A Text block is a leaf of the shape tree: its inline (or list-item) descendants never emit shapes.
    if (!selfTextBlock) {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const childInfo = analyze(child);
        paintableDescendants += childInfo.paintableDescendants + (childInfo.selfPaint ? 1 : 0);
        textBlockDescendants += childInfo.textBlockDescendants + (childInfo.selfTextBlock ? 1 : 0);
      }
    }
    return { selfPaint, selfTextBlock, paintableDescendants, textBlockDescendants };
  }

  function measuredBox(el: HTMLElement): Box {
    const rect = el.getBoundingClientRect();
    return {
      x: round(rect.left - sectionRect.left),
      y: round(rect.top - sectionRect.top),
      w: round(rect.width),
      h: round(rect.height),
    };
  }

  function adjustTextForContainer(container: HTMLElement, textEl: HTMLElement, text: TextBody | undefined): TextBody | undefined {
    if (!text) {
      return text;
    }
    const containerRect = container.getBoundingClientRect();
    const textRect = textEl.getBoundingClientRect();
    const containerBorderL = px(getComputedStyle(container).borderLeftWidth);
    const containerBorderT = px(getComputedStyle(container).borderTopWidth);
    const containerBorderR = px(getComputedStyle(container).borderRightWidth);
    const containerBorderB = px(getComputedStyle(container).borderBottomWidth);
    const offsetL = textRect.left - containerRect.left - containerBorderL;
    const offsetT = textRect.top - containerRect.top - containerBorderT;
    const offsetR = containerRect.right - textRect.right - containerBorderR;
    const offsetB = containerRect.bottom - textRect.bottom - containerBorderB;
    return {
      ...text,
      padding: {
        l: round(offsetL + text.padding.l),
        t: round(offsetT + text.padding.t),
        r: round(offsetR + text.padding.r),
        b: round(offsetB + text.padding.b),
      },
      firstParagraphGap: text.firstParagraphGap,
      lastParagraphGap: text.lastParagraphGap,
    };
  }
  function parseFill(cs: CSSStyleDeclaration, box: Box): Fill | undefined {
    const gradient = parseGradient(cs.backgroundImage, box);
    if (gradient) {
      return gradient;
    }
    const parsed = parseColor(cs.backgroundColor);
    if (!parsed || parsed.alpha <= 0) {
      return undefined;
    }
    return { type: 'solid', color: parsed };
  }

  /**
   * One `linear-gradient()` / `radial-gradient()` layer from the computed `background-image`. Chromium keeps
   * the author's stop positions (missing ones are filled in here per CSS Images 3) and normalises colours to
   * `rgb()`/`rgba()`. Multiple layers, `url()`, conic and repeating gradients are left to the raster pass.
   */
  function parseGradient(value: string, box: Box): Fill | undefined {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'none') {
      return undefined;
    }
    const layers = splitTopLevel(trimmed);
    if (layers.length !== 1) {
      return undefined;
    }
    const match = layers[0]!.match(/^(linear|radial)-gradient\((.*)\)$/s);
    if (!match) {
      return undefined;
    }
    const kind = match[1] as 'linear' | 'radial';
    const args = splitTopLevel(match[2] ?? '');
    let angle = 180;
    if (args.length && !startsWithColor(args[0]!)) {
      const head = args.shift()!;
      if (kind === 'linear') {
        const parsed = parseGradientAngle(head, box);
        if (parsed === undefined) {
          return undefined;
        }
        angle = parsed;
      }
    }
    const lineLength = kind === 'linear'
      ? Math.abs(box.w * Math.sin((angle * Math.PI) / 180)) + Math.abs(box.h * Math.cos((angle * Math.PI) / 180))
      : Math.min(box.w, box.h) / 2;
    const stops = parseGradientStops(args, lineLength);
    if (!stops) {
      return undefined;
    }
    return kind === 'linear' ? { type: 'gradient', kind, angle, stops } : { type: 'gradient', kind, stops };
  }

  function startsWithColor(token: string): boolean {
    return /^(rgba?\(|transparent\b)/i.test(token.trim());
  }

  function parseGradientAngle(token: string, box: Box): number | undefined {
    const value = token.trim();
    const unit = value.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
    if (unit) {
      const n = parseFloat(unit[1]!);
      const degrees = unit[2] === 'deg' ? n : unit[2] === 'grad' ? n * 0.9 : unit[2] === 'rad' ? (n * 180) / Math.PI : n * 360;
      return ((degrees % 360) + 360) % 360;
    }
    if (!value.startsWith('to ')) {
      return undefined;
    }
    const sides = value.slice(3).split(/\s+/).sort().join(' ');
    // corner keywords use the "magic corner" angle: the gradient line's perpendicular passes through the other corners
    const corner = (Math.atan2(box.w, box.h) * 180) / Math.PI;
    switch (sides) {
      case 'top':
        return 0;
      case 'right':
        return 90;
      case 'bottom':
        return 180;
      case 'left':
        return 270;
      case 'right top':
        return corner;
      case 'bottom right':
        return 180 - corner;
      case 'bottom left':
        return 180 + corner;
      case 'left top':
        return 360 - corner;
      default:
        return undefined;
    }
  }

  function parseGradientStops(args: string[], lineLength: number): Array<{ position: number; color: Color }> | undefined {
    const stops: Array<{ position: number | undefined; color: Color }> = [];
    for (const arg of args) {
      const tokens = arg.trim().match(/^(rgba?\([^)]*\)|transparent)\s*(.*)$/i);
      if (!tokens) {
        return undefined;
      }
      const color = parseColor(tokens[1]!);
      if (!color) {
        return undefined;
      }
      const positions = (tokens[2] ?? '').split(/\s+/).filter(Boolean);
      if (positions.length === 0) {
        stops.push({ position: undefined, color });
        continue;
      }
      for (const position of positions) {
        const fraction = position.endsWith('%') ? parseFloat(position) / 100 : lineLength > 0 ? px(position) / lineLength : 0;
        stops.push({ position: Math.max(0, Math.min(1, fraction)), color });
      }
    }
    if (stops.length < 2) {
      return undefined;
    }
    if (stops[0]!.position === undefined) {
      stops[0]!.position = 0;
    }
    if (stops[stops.length - 1]!.position === undefined) {
      stops[stops.length - 1]!.position = 1;
    }
    let previous = 0;
    for (let i = 0; i < stops.length; i += 1) {
      const stop = stops[i]!;
      if (stop.position === undefined) {
        let next = i + 1;
        while (stops[next]!.position === undefined) {
          next += 1;
        }
        const span = next - (i - 1);
        const step = (stops[next]!.position! - previous) / span;
        for (let j = i; j < next; j += 1) {
          stops[j]!.position = previous + step * (j - (i - 1));
        }
      }
      // positions never decrease (CSS clamps a stop to the largest preceding position)
      stop.position = Math.max(previous, stop.position!);
      previous = stop.position;
    }
    return stops.map((stop) => ({ position: round(stop.position!), color: stop.color }));
  }

  /** Splits on commas outside parentheses. */
  function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      } else if (ch === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  }

  /** Product of `opacity` from the element up to the section. */
  function effectiveOpacity(el: HTMLElement): number {
    let opacity = 1;
    for (let current: HTMLElement | null = el; current && current !== section; current = current.parentElement) {
      opacity *= Math.max(0, Math.min(1, px(getComputedStyle(current).opacity) || 0));
    }
    return opacity;
  }

  function withAlpha(color: Color, factor: number): Color {
    return factor >= 1 ? color : { hex: color.hex, alpha: round(color.alpha * factor) };
  }

  function makeShape(el: HTMLElement, box: Box, text?: TextBody): ShapeElement {
    const cs = getComputedStyle(el);
    const transform = decomposeTransform(cs.transform);
    const shape: ShapeElement = {
      kind: 'shape',
      selector: cssPath(el),
      name: elementName(el),
      box: transform ? transformedBox(cs, box, transform) : box,
      rotation: transform?.rotation ?? 0,
      geometry: classifyGeometry(box, cs),
    };
    const fill = parseFill(cs, box);
    if (fill) {
      shape.fill = fill;
      if (fill.type === 'gradient' && fill.kind === 'radial') {
        entries.push({ code: 'SUBSTITUTE_GRADIENT_RADIAL', selector: shape.selector, reason: `radial-gradient on ${shape.name} is approximated by a circular path gradient` });
      }
    }
    const sides = parseBorderSides(cs);
    const line = parseLine(cs);
    if (line) {
      shape.line = line;
    } else if (sides) {
      shape.borders = sides;
      entries.push({ code: 'SUBSTITUTE_BORDER_SIDES', selector: shape.selector, reason: `border on ${shape.name} differs per side` });
    }
    const shadow = parseShadow(cs.boxShadow);
    if (shadow) {
      shape.shadow = shadow;
    }
    if (text) {
      shape.text = text;
    }
    if (transform) {
      scaleShape(shape, transform.scale);
    }
    const opacity = effectiveOpacity(el);
    if (opacity < 1) {
      applyOpacity(shape, opacity);
      entries.push({ code: 'SUBSTITUTE_OPACITY', selector: shape.selector, reason: `opacity ${round(opacity)} on ${shape.name} folded into fill, line and text alpha` });
    }
    return shape;
  }

  /**
   * Computed `box-shadow`: `<color> <x> <y> <blur> <spread> [inset]` per layer. Only one layer without
   * spread maps to `a:outerShdw`/`a:innerShdw`; anything else is left for the raster/flatten pass.
   */
  function parseShadow(value: string): ShapeElement['shadow'] {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'none') {
      return undefined;
    }
    const layers = splitTopLevel(trimmed);
    if (layers.length !== 1) {
      return undefined;
    }
    const match = layers[0]!.match(/^(rgba?\([^)]*\)|transparent)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(\s+inset)?$/i);
    if (!match) {
      return undefined;
    }
    const color = parseColor(match[1]!);
    if (!color || color.alpha <= 0 || parseFloat(match[5]!) !== 0) {
      return undefined;
    }
    return { inset: Boolean(match[6]), offsetX: round(parseFloat(match[2]!)), offsetY: round(parseFloat(match[3]!)), blur: round(parseFloat(match[4]!)), color };
  }

  function applyOpacity(shape: ShapeElement, opacity: number): void {
    if (shape.fill?.type === 'solid') {
      shape.fill.color = withAlpha(shape.fill.color, opacity);
    } else if (shape.fill?.type === 'gradient') {
      for (const stop of shape.fill.stops) {
        stop.color = withAlpha(stop.color, opacity);
      }
    }
    if (shape.line) {
      shape.line.color = withAlpha(shape.line.color, opacity);
    }
    for (const side of Object.values(shape.borders ?? {})) {
      side.color = withAlpha(side.color, opacity);
    }
    if (shape.shadow) {
      shape.shadow.color = withAlpha(shape.shadow.color, opacity);
    }
    for (const paragraph of shape.text?.paragraphs ?? []) {
      if (paragraph.bullet && paragraph.bullet.type !== 'none') {
        paragraph.bullet.color = withAlpha(paragraph.bullet.color, opacity);
      }
      for (const run of paragraph.runs) {
        if (run.kind === 'text') {
          run.style.color = withAlpha(run.style.color, opacity);
          if (run.style.highlight) {
            run.style.highlight = withAlpha(run.style.highlight, opacity);
          }
        }
      }
    }
  }

  function measureTextBlock(el: HTMLElement): { box: Box; text: TextBody | undefined } {
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      return measureListBlock(el);
    }
    const cs = getComputedStyle(el);
    const box = measuredBox(el);
    const padding: Insets = { l: px(cs.paddingLeft), t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom) };
    const whiteSpace = cs.whiteSpace;
    const rtl = cs.direction === 'rtl';
    const wrap = whiteSpace !== 'nowrap' && whiteSpace !== 'pre';
    const align = resolveAlign(cs.textAlign, rtl);
    const indent = px(cs.textIndent);
    const runs = mergeRuns(collectRuns(el, whiteSpace));
    const paragraphs = buildParagraphs(el, runs, align, indent);
    const lineGroups = measureLineGroups(el);
    const lineBox = measureLineBox(el);
    const rect = el.getBoundingClientRect();
    const contentTop = rect.top + px(cs.borderTopWidth) + padding.t;
    const contentBottom = rect.bottom - px(cs.borderBottomWidth) - padding.b;
    const availWidth = rect.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - padding.l - padding.r;

    const text: TextBody = {
      padding,
      firstParagraphGap: lineBox ? round(Math.max(0, lineBox.firstTop - contentTop)) : 0,
      lastParagraphGap: lineBox ? round(Math.max(0, contentBottom - lineBox.lastBottom)) : 0,
      wrap,
      rtl,
      trailingGuard: resolveTrailingGuard(lineGroups, availWidth, align),
      paragraphs: paragraphs.length ? paragraphs : [{ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, marginLeft: 0, level: 0, runs: runs.length ? runs : [{ kind: 'text', text: '', style: styleFromElement(el) }] }],
    };

    const lineHeight = round(lineBox ? lineBox.height : px(cs.fontSize));
    for (const paragraph of text.paragraphs) {
      paragraph.lineHeight = lineHeight;
    }

    return { box, text };
  }

  /**
   * A `ul`/`ol` is one text body: each `li` (any depth) is a paragraph at `level` = nesting depth. The list's
   * left padding and nested indentation go into `marginLeft` (`marL`), never into `lIns`, so `marL + indent`
   * stays >= 0 (PowerPoint clamps a bullet position left of the inset). `indent` is `-(marker advance)`, the
   * measured width of the marker string in the marker's font, so the bullet lands where CSS paints it.
   */
  function measureListBlock(list: HTMLElement): { box: Box; text: TextBody | undefined } {
    const cs = getComputedStyle(list);
    const box = measuredBox(list);
    const rect = list.getBoundingClientRect();
    const padding: Insets = { l: 0, t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom) };
    const rtl = cs.direction === 'rtl';
    const whiteSpace = cs.whiteSpace;
    const wrap = whiteSpace !== 'nowrap' && whiteSpace !== 'pre';
    const bodyLeft = rect.left + px(cs.borderLeftWidth);
    const contentTop = rect.top + px(cs.borderTopWidth) + padding.t;
    const contentBottom = rect.bottom - px(cs.borderBottomWidth) - padding.b;

    const paragraphs: Paragraph[] = [];
    let firstTop: number | undefined;
    let previousBottom: number | undefined;
    let trailingGuard = 0;

    function visitList(current: HTMLElement, level: number): void {
      if (level > 8) {
        entries.push({ code: 'VALIDATE_LIST_CONTENT', selector: cssPath(current), reason: `List nesting deeper than 9 levels in ${elementName(list)}` });
        return;
      }
      const ordered = current.tagName === 'OL';
      const start = ordered ? parseInt(current.getAttribute('start') ?? '1', 10) || 1 : 1;
      const reversed = ordered && current.hasAttribute('reversed');
      const items = (Array.from(current.children) as HTMLElement[]).filter((child) => child.tagName === 'LI' && !isSkipped(child));
      items.forEach((li, position) => {
        const parts = classifyListItem(li);
        if (!parts) {
          entries.push({ code: 'VALIDATE_LIST_CONTENT', selector: cssPath(li), reason: `${elementName(li)} contains block content other than one p and one nested list` });
          return;
        }
        const host = parts.host;
        const liStyle = getComputedStyle(li);
        const hostStyle = getComputedStyle(host);
        const align = resolveAlign(hostStyle.textAlign, rtl);
        const runs = mergeRuns(collectRuns(host, hostStyle.whiteSpace, true));
        const firstRun = runs.find((run): run is Extract<Run, { kind: 'text' }> => run.kind === 'text');
        const runStyle = firstRun ? firstRun.style : styleFromElement(host);
        const lineBox = measureLineBox(host, host === li ? parts.nested : null);
        const lineHeight = round(lineBox ? lineBox.height : px(hostStyle.fontSize));
        const contentLeft = li.getBoundingClientRect().left + px(liStyle.borderLeftWidth) + px(liStyle.paddingLeft);
        let marginLeft = round(contentLeft - bodyLeft);
        const marker = resolveMarker(li, liStyle, current, reversed ? items.length - position : start + position);
        const bullet = marker.bullet;
        if (marker.substituted && position === 0) {
          entries.push({ code: 'SUBSTITUTE_LIST_STYLE', selector: cssPath(current), reason: `list-style-type ${liStyle.listStyleType}${reversed ? ' (reversed)' : ''} on ${elementName(current)} has no PowerPoint numbering scheme` });
        }
        let indent = 0;
        if (bullet.type !== 'none') {
          bullet.sizePct = Math.round((marker.fontSize / runStyle.size) * 100);
          const textStart = liStyle.listStylePosition === 'inside' ? firstTextLeft(host) : undefined;
          if (textStart !== undefined) {
            // An inside marker is part of the first line, which a hanging indent cannot express: anchor marL at the
            // text start so bullet and first line match Chromium; wrapped lines shift right by the marker width.
            indent = -round(textStart - contentLeft);
            marginLeft = round(textStart - bodyLeft);
          } else {
            indent = -marker.advance;
          }
        }

        const spaceBefore = lineBox && previousBottom !== undefined ? round(Math.max(0, lineBox.firstTop - previousBottom)) : 0;
        if (lineBox && firstTop === undefined) {
          firstTop = lineBox.firstTop;
        }
        if (lineBox) {
          previousBottom = lineBox.lastBottom;
        }
        const availWidth = li.getBoundingClientRect().width - px(liStyle.borderLeftWidth) - px(liStyle.borderRightWidth) - px(liStyle.paddingLeft) - px(liStyle.paddingRight);
        trailingGuard = Math.max(trailingGuard, resolveTrailingGuard(measureLineGroups(host, true), availWidth, align));

        paragraphs.push({
          align,
          lineHeight,
          spaceBefore,
          spaceAfter: 0,
          indent,
          marginLeft,
          level,
          bullet,
          runs: runs.length ? runs : [{ kind: 'text', text: '', style: runStyle }],
        });
        if (parts.nested) {
          visitList(parts.nested, level + 1);
        }
      });
    }
    visitList(list, 0);

    const text: TextBody = {
      padding,
      firstParagraphGap: firstTop === undefined ? 0 : round(Math.max(0, firstTop - contentTop)),
      lastParagraphGap: previousBottom === undefined ? 0 : round(Math.max(0, contentBottom - previousBottom)),
      wrap,
      rtl,
      trailingGuard,
      paragraphs: paragraphs.length ? paragraphs : [{ align: resolveAlign(cs.textAlign, rtl), lineHeight: round(px(cs.fontSize)), spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs: [{ kind: 'text', text: '', style: styleFromElement(list) }] }],
    };
    return { box, text };
  }

  /** `li` content: inline content directly, or in one `p`, plus at most one nested list; anything else is invalid. */
  function classifyListItem(li: HTMLElement): { host: HTMLElement; nested: HTMLElement | null } | undefined {
    let paragraph: HTMLElement | null = null;
    let nested: HTMLElement | null = null;
    for (const child of Array.from(li.children) as HTMLElement[]) {
      if (isSkipped(child)) {
        continue;
      }
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        if (nested) {
          return undefined;
        }
        nested = child;
        continue;
      }
      if (isInlineRendered(child)) {
        continue;
      }
      if (child.tagName === 'P' && !paragraph) {
        paragraph = child;
        continue;
      }
      return undefined;
    }
    if (paragraph) {
      // A `p` host must be the only inline content: stray text next to it would be a second anonymous block.
      const strayText = Array.from(li.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
      if (strayText) {
        return undefined;
      }
    }
    return { host: paragraph ?? li, nested };
  }

  function resolveMarker(li: HTMLElement, liStyle: CSSStyleDeclaration, list: HTMLElement, ordinal: number): { bullet: Bullet; advance: number; fontSize: number; substituted: boolean } {
    const markerStyle = getComputedStyle(li, '::marker');
    const fontSize = px(markerStyle.fontSize) || px(liStyle.fontSize);
    const color = parseColor(markerStyle.color) ?? parseColor(liStyle.color) ?? { hex: '000000', alpha: 1 };
    const type = liStyle.listStyleType;
    const reversed = list.hasAttribute('reversed');
    if (type === 'none') {
      return { bullet: { type: 'none' }, advance: 0, fontSize, substituted: false };
    }
    const char = type === 'disc' ? '•' : type === 'circle' ? '◦' : type === 'square' ? '▪' : undefined;
    if (char) {
      return { bullet: { type: 'char', char, color, sizePct: 100 }, advance: measureMarkerAdvance(`${char} `, markerStyle, liStyle), fontSize, substituted: false };
    }
    const scheme = autonumScheme(type);
    const substituted = scheme === undefined || reversed;
    const effectiveScheme: AutonumScheme = scheme ?? 'arabicPeriod';
    const start = list.tagName === 'OL' && !reversed ? parseInt(list.getAttribute('start') ?? '1', 10) || 1 : 1;
    const label = `${autonumLabel(effectiveScheme, ordinal)}. `;
    return {
      bullet: { type: 'autonum', scheme: effectiveScheme, startAt: start, color, sizePct: 100 },
      advance: measureMarkerAdvance(label, markerStyle, liStyle),
      fontSize,
      substituted,
    };
  }

  function autonumScheme(type: string): AutonumScheme | undefined {
    switch (type) {
      case 'decimal':
        return 'arabicPeriod';
      case 'lower-alpha':
      case 'lower-latin':
        return 'alphaLcPeriod';
      case 'upper-alpha':
      case 'upper-latin':
        return 'alphaUcPeriod';
      case 'lower-roman':
        return 'romanLcPeriod';
      case 'upper-roman':
        return 'romanUcPeriod';
      default:
        return undefined;
    }
  }

  function autonumLabel(scheme: AutonumScheme, n: number): string {
    const value = Math.max(1, n);
    switch (scheme) {
      case 'alphaLcPeriod':
        return alphaLabel(value);
      case 'alphaUcPeriod':
        return alphaLabel(value).toUpperCase();
      case 'romanLcPeriod':
        return romanLabel(value).toLowerCase();
      case 'romanUcPeriod':
        return romanLabel(value);
      default:
        return String(value);
    }
  }

  function alphaLabel(n: number): string {
    let out = '';
    let value = n;
    while (value > 0) {
      value -= 1;
      out = String.fromCharCode(97 + (value % 26)) + out;
      value = Math.floor(value / 26);
    }
    return out;
  }

  function romanLabel(n: number): string {
    const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let value = n;
    for (const [weight, glyph] of table) {
      while (value >= weight) {
        out += glyph;
        value -= weight;
      }
    }
    return out;
  }

  /** Width of the marker string in the marker's font, measured off-flow so nothing reflows. */
  function measureMarkerAdvance(label: string, markerStyle: CSSStyleDeclaration, liStyle: CSSStyleDeclaration): number {
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;';
    span.style.fontFamily = markerStyle.fontFamily || liStyle.fontFamily;
    span.style.fontSize = markerStyle.fontSize || liStyle.fontSize;
    span.style.fontWeight = markerStyle.fontWeight || liStyle.fontWeight;
    span.style.fontStyle = markerStyle.fontStyle || liStyle.fontStyle;
    span.style.letterSpacing = liStyle.letterSpacing;
    span.textContent = label;
    section!.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return round(width);
  }

  function firstTextLeft(root: HTMLElement): number | undefined {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, nestedListFilter(root));
    let node = walker.nextNode();
    while (node) {
      const range = document.createRange();
      range.selectNodeContents(node as Text);
      for (const rect of Array.from(range.getClientRects()) as DOMRect[]) {
        if (rect.width > 0) {
          return rect.left;
        }
      }
      node = walker.nextNode();
    }
    return undefined;
  }

  /** TreeWalker filter that leaves nested lists to their own paragraphs. */
  function nestedListFilter(root: HTMLElement): NodeFilter {
    return {
      acceptNode(node: Node): number {
        for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
          if (current.nodeType === Node.ELEMENT_NODE && ((current as Element).tagName === 'UL' || (current as Element).tagName === 'OL')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    };
  }

  /**
   * Line-box geometry of the first and last line, measured with zero-size inline-block probes:
   * `vertical-align: top|bottom` pins a probe to the line box edges, which text-node rects
   * (content area only) cannot give. Probes are zero-width so they never change wrapping.
   * `endBefore` places the last-line probe in front of that child (a nested list) instead of at the end.
   */
  function measureLineBox(el: HTMLElement, endBefore: Node | null = null): { firstTop: number; height: number; lastBottom: number } | undefined {
    if (!el.firstChild) {
      return undefined;
    }
    // Function declaration, not a const arrow: esbuild (tsx) would wrap the arrow in a `__name` helper that does not exist in the page.
    function probe(align: 'top' | 'bottom'): HTMLSpanElement {
      const span = document.createElement('span');
      span.style.cssText = `display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:${align};`;
      return span;
    }
    const startTop = probe('top');
    const startBottom = probe('bottom');
    const endBottom = probe('bottom');
    el.insertBefore(startBottom, el.firstChild);
    el.insertBefore(startTop, el.firstChild);
    el.insertBefore(endBottom, endBefore);
    const firstTop = startTop.getBoundingClientRect().top;
    const firstBottom = startBottom.getBoundingClientRect().bottom;
    const lastBottom = endBottom.getBoundingClientRect().bottom;
    startTop.remove();
    startBottom.remove();
    endBottom.remove();
    return { firstTop, height: firstBottom - firstTop, lastBottom };
  }

  function buildParagraphs(el: HTMLElement, runs: Run[], align: Align, indent: number): Paragraph[] {
    if (el.tagName === 'PRE') {
      const raw = (el.textContent || '').replace(/\r\n?/g, '\n');
      return raw.split('\n').map((line) => ({ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, marginLeft: 0, level: 0, runs: [{ kind: 'text', text: removeSoftHyphens(line), style: styleFromElement(el) }] }));
    }
    return [{ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, marginLeft: 0, level: 0, runs }];
  }

  /** Ink extents per line: text-node rects merged when they overlap vertically (mixed sizes share a line). */
  function measureLineGroups(root: HTMLElement, skipNestedLists = false): LineGroup[] {
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, skipNestedLists ? nestedListFilter(root) : null);
    let node = walker.nextNode();
    while (node) {
      const range = document.createRange();
      range.selectNodeContents(node as Text);
      for (const rect of Array.from(range.getClientRects()) as DOMRect[]) {
        if (rect.width || rect.height) {
          rects.push(rect);
        }
      }
      node = walker.nextNode();
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const groups: LineGroup[] = [];
    for (const rect of rects) {
      const line = groups[groups.length - 1];
      if (line && rect.top < line.bottom - 1) {
        line.top = Math.min(line.top, rect.top);
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.bottom = Math.max(line.bottom, rect.bottom);
        line.height = line.bottom - line.top;
      } else {
        groups.push({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height });
      }
    }
    return groups;
  }

  function resolveTrailingGuard(groups: LineGroup[], availWidth: number, align: Align): number {
    let guard = 0;
    for (const group of groups) {
      if (availWidth - Math.max(0, group.right - group.left) < 0.5) {
        guard = Math.max(guard, align === 'ctr' ? 0.5 : 1);
      }
    }
    return guard;
  }

  function mergeRuns(runs: Run[]): Run[] {
    const merged: Run[] = [];
    for (const run of runs) {
      if (run.kind === 'text') {
        const prev = merged[merged.length - 1];
        if (prev && prev.kind === 'text' && sameStyle(prev.style, run.style)) {
          prev.text += run.text;
          continue;
        }
        merged.push({ kind: 'text', text: run.text, style: run.style });
        continue;
      }
      merged.push(run);
    }
    return trimTextRuns(merged);
  }
  function sameStyle(a: RunStyle, b: RunStyle): boolean {
    return a.fontStack.join('\u0000') === b.fontStack.join('\u0000')
      && a.weight === b.weight
      && a.size === b.size
      && a.bold === b.bold
      && a.italic === b.italic
      && a.underline === b.underline
      && a.strike === b.strike
      && a.color.hex === b.color.hex
      && a.color.alpha === b.color.alpha
      && a.letterSpacing === b.letterSpacing
      && a.caps === b.caps
      && a.baseline === b.baseline
      && a.highlight?.hex === b.highlight?.hex
      && a.highlight?.alpha === b.highlight?.alpha
      && a.link === b.link;
  }

  function trimTextRuns(runs: Run[]): Run[] {
    let first = -1;
    let last = -1;
    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i]!;
      if (run.kind === 'text' && run.text.length > 0) {
        first = i;
        break;
      }
    }
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const run = runs[i]!;
      if (run.kind === 'text' && run.text.length > 0) {
        last = i;
        break;
      }
    }
    if (first === -1 || last === -1) {
      return runs;
    }
    const trimmed: Run[] = [];
    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i]!;
      if (run.kind !== 'text') {
        trimmed.push(run);
        continue;
      }
      let text = run.text;
      if (i === first) {
        text = text.replace(/^\s+/, '');
      }
      if (i === last) {
        text = text.replace(/\s+$/, '');
      }
      if (text.length > 0 || i === first || i === last) {
        trimmed.push({ kind: 'text', text, style: run.style });
      }
    }
    return trimmed;
  }

  function collectRuns(root: HTMLElement, whiteSpace: string, skipNestedLists = false): Run[] {
    const preserve = whiteSpace === 'pre' || whiteSpace === 'pre-wrap';
    const runs: Run[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, skipNestedLists ? nestedListFilter(root) : null);
    let node = walker.firstChild();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const raw = removeSoftHyphens(textNode.data);
        const text = preserve ? raw : collapseWhitespace(raw);
        if (text) {
          const parent = (textNode.parentElement || root) as HTMLElement;
          runs.push({ kind: 'text', text: applyTextTransform(parent, text), style: styleFromElement(parent) });
        }
      } else if ((node as HTMLElement).tagName === 'BR') {
        runs.push({ kind: 'break' });
      }
      node = walker.nextNode();
    }
    return runs;
  }

  function styleFromElement(el: Element): RunStyle {
    const cs = getComputedStyle(el);
    const fontStack = cs.fontFamily.split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const weight = parseFontWeight(cs.fontWeight);
    const size = px(cs.fontSize);
    const italic = /italic|oblique/i.test(cs.fontStyle);
    const underline = hasTextDecoration(el, 'underline');
    const strike = hasTextDecoration(el, 'line-through');
    const color = parseColor(cs.color) ?? { hex: '000000', alpha: 1 };
    const letterSpacing = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
    const caps = /small-caps/i.test(cs.fontVariantCaps || cs.fontVariant) ? 'small' : 'none';
    const baseline = baselineOffset(el);
    const highlight = findHighlight(el);
    const link = findLink(el);
    return {
      fontStack,
      weight,
      size,
      bold: weight >= 600,
      italic,
      underline,
      strike,
      color,
      letterSpacing,
      caps,
      baseline,
      ...(highlight ? { highlight } : {}),
      ...(link ? { link } : {}),
    };
  }

  function findHighlight(el: Element): Color | undefined {
    for (let current: Element | null = el; current && current !== section; current = current.parentElement) {
      const cs = getComputedStyle(current);
      if (!cs.display.startsWith('inline') && current.tagName !== 'MARK') {
        continue;
      }
      const color = parseColor(cs.backgroundColor);
      if (color && color.alpha > 0) {
        return color;
      }
    }
    return undefined;
  }

  function findLink(el: Element): string | undefined {
    for (let current: Element | null = el; current && current !== section; current = current.parentElement) {
      if (current.tagName === 'A' && current.hasAttribute('href')) {
        const href = current.getAttribute('href') || '';
        if (!href) {
          continue;
        }
        return href.startsWith('#') ? href : (current as HTMLAnchorElement).href;
      }
    }
    return undefined;
  }

  function hasTextDecoration(el: Element, wanted: 'underline' | 'line-through'): boolean {
    for (let current: Element | null = el; current && current !== section; current = current.parentElement) {
      if (getComputedStyle(current).textDecorationLine.split(/\s+/).includes(wanted)) {
        return true;
      }
    }
    return false;
  }

  function baselineOffset(el: Element): number {
    for (let current: Element | null = el; current && current !== section; current = current.parentElement) {
      const cs = getComputedStyle(current);
      if (cs.verticalAlign === 'super' || current.tagName === 'SUP') {
        return 30000;
      }
      if (cs.verticalAlign === 'sub' || current.tagName === 'SUB') {
        return -25000;
      }
    }
    return 0;
  }

  function applyTextTransform(el: Element, text: string): string {
    switch (getComputedStyle(el).textTransform) {
      case 'uppercase':
        return text.toUpperCase();
      case 'lowercase':
        return text.toLowerCase();
      case 'capitalize':
        return text.replace(/(^|\s)(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
      default:
        return text;
    }
  }

  function collapseWhitespace(text: string): string {
    return text.replace(/[\t\n\r\f\v ]+/g, ' ');
  }

  function removeSoftHyphens(text: string): string {
    return text.replace(/\u00AD/g, '');
  }

  function parseFontWeight(value: string): number {
    if (value === 'normal') {
      return 400;
    }
    if (value === 'bold') {
      return 700;
    }
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 400 : parsed;
  }

  function resolveAlign(value: string, rtl: boolean): Align {
    switch (value) {
      case 'center':
        return 'ctr';
      case 'right':
        return 'r';
      case 'justify':
        return 'just';
      case 'start':
        return rtl ? 'r' : 'l';
      case 'end':
        return rtl ? 'l' : 'r';
      default:
        return 'l';
    }
  }

  type BorderSides = NonNullable<ShapeElement['borders']>;

  function parseBorderSide(width: string, style: string, color: string): Line | undefined {
    const parsedWidth = px(width);
    const parsedColor = parseColor(color);
    if (parsedWidth <= 0 || style === 'none' || style === 'hidden' || !parsedColor || parsedColor.alpha <= 0) {
      return undefined;
    }
    return { width: parsedWidth, color: parsedColor, dash: style === 'dashed' ? 'dash' : style === 'dotted' ? 'dot' : 'solid' };
  }

  /** Visible border sides, or undefined when no side paints. */
  function parseBorderSides(cs: CSSStyleDeclaration): BorderSides | undefined {
    const sides: BorderSides = {};
    const top = parseBorderSide(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
    const right = parseBorderSide(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor);
    const bottom = parseBorderSide(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
    const left = parseBorderSide(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
    if (top) sides.top = top;
    if (right) sides.right = right;
    if (bottom) sides.bottom = bottom;
    if (left) sides.left = left;
    return top || right || bottom || left ? sides : undefined;
  }

  function sameLine(a: Line | undefined, b: Line | undefined): boolean {
    return !!a && !!b && a.width === b.width && a.dash === b.dash && colorsEqual(a.color, b.color);
  }

  /** The uniform border as one line, or undefined when sides differ or nothing paints. */
  function parseLine(cs: CSSStyleDeclaration): Line | undefined {
    const sides = parseBorderSides(cs);
    if (!sides) {
      return undefined;
    }
    return sameLine(sides.top, sides.right) && sameLine(sides.top, sides.bottom) && sameLine(sides.top, sides.left) ? sides.top : undefined;
  }

  function classifyGeometry(box: Box, cs: CSSStyleDeclaration): ShapeElement['geometry'] {
    const [tl, tr, br, bl] = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((value) => parseCornerRadius(value, box)) as [CornerRadius, CornerRadius, CornerRadius, CornerRadius];
    // CSS Backgrounds 3 §5.5: when adjacent radii overlap, every radius is scaled by the smallest ratio
    const ratios = [box.w / (tl.x + tr.x), box.w / (bl.x + br.x), box.h / (tl.y + bl.y), box.h / (tr.y + br.y)].filter((ratio) => Number.isFinite(ratio));
    const scale = Math.min(1, ...ratios);
    const radii = { tl: scaleRadius(tl, scale), tr: scaleRadius(tr, scale), br: scaleRadius(br, scale), bl: scaleRadius(bl, scale) };
    const uniform = [radii.tr, radii.br, radii.bl].every((radius) => nearlyEqual(radius.x, radii.tl.x) && nearlyEqual(radius.y, radii.tl.y));
    if (radii.tl.x <= 0 && radii.tl.y <= 0 && uniform) {
      return { preset: 'rect' };
    }
    if (uniform && box.w > 0 && box.h > 0 && nearlyEqual(radii.tl.x, box.w / 2) && nearlyEqual(radii.tl.y, box.h / 2)) {
      return { preset: 'ellipse' };
    }
    if (uniform && nearlyEqual(radii.tl.x, radii.tl.y)) {
      return { preset: 'roundRect', radius: radii.tl.x };
    }
    return { preset: 'custom', radii };
  }

  function scaleRadius(radius: CornerRadius, scale: number): CornerRadius {
    return { x: round(radius.x * scale), y: round(radius.y * scale) };
  }

  function parseCornerRadius(value: string, box: Box): { x: number; y: number } {
    const parts = value.trim().split(/\s+/);
    const horizontal = parts[0] ?? '0';
    const vertical = parts[1] ?? parts[0] ?? '0';
    return { x: parseRadius(horizontal, box.w), y: parseRadius(vertical, box.h) };
  }

  function parseRadius(token: string, size: number): number {
    const trimmed = token.trim();
    if (trimmed.endsWith('%')) {
      return (parseFloat(trimmed) / 100) * size;
    }
    return px(trimmed);
  }

  type Transform2d = { rotation: number; scale: number; a: number; b: number; c: number; d: number; e: number; f: number };

  /** Rotation + uniform scale + translate from the computed 2-D matrix; anything else (skew, 3-D, non-uniform scale) is undefined. */
  function decomposeTransform(transform: string): Transform2d | undefined {
    if (!transform || transform === 'none') {
      return undefined;
    }
    const matrix = transform.match(/^matrix\(([-0-9.eE,\s]+)\)$/);
    if (!matrix) {
      return undefined;
    }
    const parts = (matrix[1] ?? '').split(',').map((part) => parseFloat(part.trim()));
    if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) {
      return undefined;
    }
    const [a, b, c, d, e, f] = parts as [number, number, number, number, number, number];
    const sx = Math.hypot(a, b);
    const sy = Math.hypot(c, d);
    if (sx <= 0 || !nearlyEqual(sx, sy) || !nearlyEqual(a * c + b * d, 0)) {
      return undefined;
    }
    const degrees = (Math.atan2(b, a) * 180) / Math.PI;
    return { rotation: round(((degrees % 360) + 360) % 360) % 360, scale: round(sx), a, b, c, d, e, f };
  }

  /**
   * Applies the element's transform to its untransformed box: the box centre goes through the matrix about
   * `transform-origin`, the size takes the uniform scale, and the rotation goes to `rotation`.
   */
  function transformedBox(cs: CSSStyleDeclaration, box: Box, transform: Transform2d): Box {
    const origin = cs.transformOrigin.split(/\s+/).map((part) => px(part));
    const ox = box.x + (origin[0] ?? 0);
    const oy = box.y + (origin[1] ?? 0);
    const cx = box.x + box.w / 2 - ox;
    const cy = box.y + box.h / 2 - oy;
    const centreX = ox + transform.a * cx + transform.c * cy + transform.e;
    const centreY = oy + transform.b * cx + transform.d * cy + transform.f;
    const w = box.w * transform.scale;
    const h = box.h * transform.scale;
    return { x: round(centreX - w / 2), y: round(centreY - h / 2), w: round(w), h: round(h) };
  }

  /** `transform: scale()` folds into every CSS-px quantity of the shape, text included. */
  function scaleShape(shape: ShapeElement, s: number): void {
    if (s === 1) {
      return;
    }
    const g = shape.geometry;
    if (g.preset === 'roundRect') {
      g.radius = round(g.radius * s);
    } else if (g.preset === 'custom') {
      for (const corner of Object.values(g.radii)) {
        corner.x = round(corner.x * s);
        corner.y = round(corner.y * s);
      }
    }
    if (shape.line) {
      shape.line.width = round(shape.line.width * s);
    }
    for (const side of Object.values(shape.borders ?? {})) {
      side.width = round(side.width * s);
    }
    if (shape.shadow) {
      shape.shadow.offsetX = round(shape.shadow.offsetX * s);
      shape.shadow.offsetY = round(shape.shadow.offsetY * s);
      shape.shadow.blur = round(shape.shadow.blur * s);
    }
    const text = shape.text;
    if (!text) {
      return;
    }
    text.padding = { l: round(text.padding.l * s), t: round(text.padding.t * s), r: round(text.padding.r * s), b: round(text.padding.b * s) };
    text.firstParagraphGap = round(text.firstParagraphGap * s);
    text.lastParagraphGap = round(text.lastParagraphGap * s);
    for (const paragraph of text.paragraphs) {
      paragraph.lineHeight = round(paragraph.lineHeight * s);
      paragraph.spaceBefore = round(paragraph.spaceBefore * s);
      paragraph.spaceAfter = round(paragraph.spaceAfter * s);
      paragraph.indent = round(paragraph.indent * s);
      paragraph.marginLeft = round(paragraph.marginLeft * s);
      for (const run of paragraph.runs) {
        if (run.kind === 'text') {
          run.style.size = round(run.style.size * s);
          run.style.letterSpacing = round(run.style.letterSpacing * s);
        }
      }
    }
  }

  function parseColor(value: string): Color | undefined {
    const trimmed = value.trim();
    if (trimmed === 'transparent') {
      return { hex: '000000', alpha: 0 };
    }
    const match = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) {
      return undefined;
    }
    const parts = (match[1] ?? '').split(',').map((part) => part.trim());
    const r = parts[0] ?? '0';
    const g = parts[1] ?? '0';
    const b = parts[2] ?? '0';
    const a = parts[3] === undefined ? 1 : parseFloat(parts[3]);
    const red = clampByte(parseComponent(r));
    const green = clampByte(parseComponent(g));
    const blue = clampByte(parseComponent(b));
    return { hex: [red, green, blue].map((component) => component.toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: Number.isNaN(a) ? 1 : Math.max(0, Math.min(1, a)) };
  }

  function parseComponent(value: string): number {
    if (value.endsWith('%')) {
      return (parseFloat(value) / 100) * 255;
    }
    return parseFloat(value);
  }

  function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function colorsEqual(a: Color | undefined, b: Color | undefined): boolean {
    return !!a && !!b && a.hex === b.hex && nearlyEqual(a.alpha, b.alpha);
  }

  function firstHeadingText(root: HTMLElement): string | undefined {
    const heading = root.querySelector('h1, h2, h3');
    if (!heading) {
      return undefined;
    }
    const text = (heading.textContent || '').trim();
    return text || undefined;
  }

  function elementName(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `${tag}#${el.id}`;
    }
    const className = el.classList[0];
    return className ? `${tag}.${className}` : tag;
  }

  function cssPath(el: HTMLElement): string {
    if (el.id) {
      return `#${el.id}`;
    }
    const parts: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== section) {
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) {
        break;
      }
      const index = Array.from(parent.children).indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      current = parent === section ? section : parent;
      if (current === section) {
        break;
      }
    }
    parts.unshift(`section:nth-of-type(${sectionIndex})`);
    return parts.join(' > ');
  }

  function isSkipped(el: HTMLElement): boolean {
    if (el.tagName === 'ASIDE' && el.classList.contains('notes')) {
      return true;
    }
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }

  function paints(el: HTMLElement): boolean {
    if (isTextBlock(el)) {
      return true;
    }
    const cs = getComputedStyle(el);
    if ((parseColor(cs.backgroundColor)?.alpha ?? 0) > 0 || /-gradient\(/.test(cs.backgroundImage)) {
      return true;
    }
    if (parseBorderSides(cs)) {
      return true;
    }
    if (cs.boxShadow !== 'none') {
      return true;
    }
    return ['IMG', 'SVG', 'TABLE', 'VIDEO', 'AUDIO', 'HR'].includes(el.tagName);
  }

  function isTextBlock(el: HTMLElement): boolean {
    const display = getComputedStyle(el).display;
    if (display.startsWith('inline') || display === 'contents') {
      return false;
    }
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      return Array.from(el.children).some((child) => child.tagName === 'LI' && !isSkipped(child as HTMLElement));
    }
    let sawContent = false;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (el.tagName === 'PRE') {
          if (text.length > 0) {
            sawContent = true;
          }
        } else if (text.replace(/[\s\u00AD\u200B\u200C\u200D]/g, '') !== '') {
          sawContent = true;
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const childEl = child as HTMLElement;
      if (isSkipped(childEl)) {
        continue;
      }
      if (!isInlineRendered(childEl)) {
        return false;
      }
      sawContent = true;
    }
    return sawContent;
  }

  function isInlineRendered(el: HTMLElement): boolean {
    return el.tagName === 'BR' || el.tagName === 'IMG' || getComputedStyle(el).display.startsWith('inline');
  }

  function findUniqueTextBlockDescendant(root: HTMLElement): HTMLElement | undefined {
    const blocks: HTMLElement[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.firstChild() as Element | null;
    while (node) {
      const el = node as HTMLElement;
      if (!isSkipped(el) && isTextBlock(el)) {
        blocks.push(el);
      }
      node = walker.nextNode() as Element | null;
    }
    return blocks.length === 1 ? blocks[0] : undefined;
  }

  function collectFontFaces(baseUrl: string): BrowserFontFace[] {
    const faces: BrowserFontFace[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) {
          continue;
        }
        const fontFace = rule as CSSFontFaceRule;
        const family = fontFace.style.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g, '');
        const src = fontFace.style.getPropertyValue('src');
        const urlMatch = src.match(/url\((['"]?)([^'")]+)\1\)/i);
        if (!family || !urlMatch) {
          continue;
        }
        const resolved = new URL(urlMatch[2]!, baseUrl);
        if (resolved.protocol !== 'file:') {
          continue;
        }
        const face: BrowserFontFace = { family, file: resolved.href };
        const weightValue = fontFace.style.getPropertyValue('font-weight').trim();
        const styleValue = fontFace.style.getPropertyValue('font-style').trim();
        if (weightValue) {
          const parsed = parseInt(weightValue, 10);
          if (!Number.isNaN(parsed)) {
            face.weight = parsed;
          }
        }
        if (styleValue === 'italic') {
          face.italic = true;
        }
        faces.push(face);
      }
    }
    return faces;
  }

  function round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  function px(value: string): number {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
    return Math.abs(a - b) <= epsilon;
  }
}
