import type { Align, Box, Color, Fill, Insets, Line, Paragraph, Run, RunStyle, ShapeElement, TextBody } from '../model/index.js';

export interface BrowserFontFace {
  family: string;
  file: string;
  weight?: number;
  italic?: boolean;
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
  for (const child of Array.from(section.children) as HTMLElement[]) {
    shapes.push(...walkElement(child));
  }
  return {
    meta,
    sectionBox,
    shapes,
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

    if (info.selfTextBlock) {
      const measured = measureTextBlock(el);
      return [makeShape(el, measured.box, measured.text)];
    }

    if (info.textBlockDescendants === 1 && info.paintableDescendants === 1) {
      const textEl = findUniqueTextBlockDescendant(el);
      if (textEl) {
        const measured = measureTextBlock(textEl);
        const adjusted = adjustTextForContainer(el, textEl, measured.text);
        return [makeShape(el, measuredBox(el), adjusted)];
      }
    }

    const nested: ShapeElement[] = [];
    for (const child of Array.from(el.children) as HTMLElement[]) {
      nested.push(...walkElement(child));
    }
    return [makeShape(el, measuredBox(el)), ...nested];
  }

  function analyze(el: HTMLElement): { selfPaint: boolean; selfTextBlock: boolean; paintableDescendants: number; textBlockDescendants: number } {
    if (isSkipped(el)) {
      return { selfPaint: false, selfTextBlock: false, paintableDescendants: 0, textBlockDescendants: 0 };
    }
    const selfTextBlock = isTextBlock(el);
    const selfPaint = selfTextBlock || paints(el);
    let paintableDescendants = 0;
    let textBlockDescendants = 0;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const childInfo = analyze(child);
      paintableDescendants += childInfo.paintableDescendants + (childInfo.selfPaint ? 1 : 0);
      textBlockDescendants += childInfo.textBlockDescendants + (childInfo.selfTextBlock ? 1 : 0);
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
  function parseFill(color: string): Fill | undefined {
    const parsed = parseColor(color);
    if (!parsed || parsed.alpha <= 0) {
      return undefined;
    }
    return { type: 'solid', color: parsed };
  }


  function makeShape(el: HTMLElement, box: Box, text?: TextBody): ShapeElement {
    const cs = getComputedStyle(el);
    const shape: ShapeElement = {
      kind: 'shape',
      selector: cssPath(el),
      name: elementName(el),
      box,
      rotation: parseRotation(cs.transform),
      geometry: classifyGeometry(box, cs),
    };
    const fill = parseFill(cs.backgroundColor);
    if (fill) {
      shape.fill = fill;
    }
    const line = parseLine(cs);
    if (line) {
      shape.line = line;
    }
    if (text) {
      shape.text = text;
    }
    return shape;
  }

  function measureTextBlock(el: HTMLElement): { box: Box; text: TextBody | undefined } {
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
      paragraphs: paragraphs.length ? paragraphs : [{ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, level: 0, runs: runs.length ? runs : [{ kind: 'text', text: '', style: styleFromElement(el) }] }],
    };

    const lineHeight = round(lineBox ? lineBox.height : px(cs.fontSize));
    for (const paragraph of text.paragraphs) {
      paragraph.lineHeight = lineHeight;
    }

    return { box, text };
  }

  /**
   * Line-box geometry of the first and last line, measured with zero-size inline-block probes:
   * `vertical-align: top|bottom` pins a probe to the line box edges, which text-node rects
   * (content area only) cannot give. Probes are zero-width so they never change wrapping.
   */
  function measureLineBox(el: HTMLElement): { firstTop: number; height: number; lastBottom: number } | undefined {
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
    el.appendChild(endBottom);
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
      return raw.split('\n').map((line) => ({ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, level: 0, runs: [{ kind: 'text', text: removeSoftHyphens(line), style: styleFromElement(el) }] }));
    }
    return [{ align, lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent, level: 0, runs }];
  }

  /** Ink extents per line: text-node rects merged when they overlap vertically (mixed sizes share a line). */
  function measureLineGroups(root: HTMLElement): LineGroup[] {
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

  function collectRuns(root: HTMLElement, whiteSpace: string): Run[] {
    const preserve = whiteSpace === 'pre' || whiteSpace === 'pre-wrap';
    const runs: Run[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
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

  function parseLine(cs: CSSStyleDeclaration): Line | undefined {
    const topWidth = px(cs.borderTopWidth);
    const rightWidth = px(cs.borderRightWidth);
    const bottomWidth = px(cs.borderBottomWidth);
    const leftWidth = px(cs.borderLeftWidth);
    const topStyle = cs.borderTopStyle;
    const rightStyle = cs.borderRightStyle;
    const bottomStyle = cs.borderBottomStyle;
    const leftStyle = cs.borderLeftStyle;
    const topColor = parseColor(cs.borderTopColor);
    const rightColor = parseColor(cs.borderRightColor);
    const bottomColor = parseColor(cs.borderBottomColor);
    const leftColor = parseColor(cs.borderLeftColor);
    const visible = [
      { width: topWidth, style: topStyle, color: topColor },
      { width: rightWidth, style: rightStyle, color: rightColor },
      { width: bottomWidth, style: bottomStyle, color: bottomColor },
      { width: leftWidth, style: leftStyle, color: leftColor },
    ].some((side) => side.width > 0 && side.style !== 'none' && !!side.color && side.color.alpha > 0);
    if (!visible) {
      return undefined;
    }
    const uniform = topWidth === rightWidth && topWidth === bottomWidth && topWidth === leftWidth && topStyle === rightStyle && topStyle === bottomStyle && topStyle === leftStyle && colorsEqual(topColor, rightColor) && colorsEqual(topColor, bottomColor) && colorsEqual(topColor, leftColor);
    if (!uniform || !topColor || topColor.alpha <= 0 || topStyle === 'none') {
      return undefined;
    }
    return { width: topWidth, color: topColor, dash: topStyle === 'dashed' ? 'dash' : topStyle === 'dotted' ? 'dot' : 'solid' };
  }

  function classifyGeometry(box: Box, cs: CSSStyleDeclaration): ShapeElement['geometry'] {
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((value) => parseCornerRadius(value, box));
    const first = radii[0];
    if (!first) {
      return { preset: 'rect' };
    }
    const uniform = radii.every((radius) => nearlyEqual(radius.x, first.x) && nearlyEqual(radius.y, first.y));
    if (!uniform) {
      return { preset: 'rect' };
    }
    if (box.w > 0 && box.h > 0 && nearlyEqual(box.w, box.h) && nearlyEqual(first.x, box.w / 2) && nearlyEqual(first.y, box.h / 2)) {
      return { preset: 'ellipse' };
    }
    if (first.x > 0 || first.y > 0) {
      return { preset: 'roundRect', radius: round(Math.max(first.x, first.y)) };
    }
    return { preset: 'rect' };
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

  function parseRotation(transform: string): number {
    if (!transform || transform === 'none') {
      return 0;
    }
    const matrix = transform.match(/^matrix\(([-0-9.eE,\s]+)\)$/);
    if (!matrix) {
      return 0;
    }
    const parts = (matrix[1] ?? '').split(',').map((part) => parseFloat(part.trim()));
    if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) {
      return 0;
    }
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    const c = parts[2] ?? 0;
    const d = parts[3] ?? 0;
    if (!nearlyEqual(c, -b) || !nearlyEqual(a, d) || !nearlyEqual(a * a + b * b, 1)) {
      return 0;
    }
    return round((Math.atan2(b, a) * 180) / Math.PI);
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
    if ((parseColor(cs.backgroundColor)?.alpha ?? 0) > 0) {
      return true;
    }
    if (parseLine(cs)) {
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
