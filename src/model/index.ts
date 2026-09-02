// Intermediate Deck Model (IDM): the seam between html/ (producer), fonts/ (enricher),
// emit/ (consumer) and inspect/. Units are CSS px unless a name says otherwise.
// Nothing here knows about the DOM or about OOXML. See docs/spec/11-architecture.md.

export interface Canvas {
  /** CSS px */
  width: number;
  /** CSS px */
  height: number;
  source: 'default' | 'deck-meta' | 'flag';
}

export interface DeckFontFace {
  family: string;
  file: string;
  weight?: number;
  italic?: boolean;
}

export interface Deck {
  title: string;
  lang: string;
  canvas: Canvas;
  slides: Slide[];
  fontFaces: DeckFontFace[];
}

export interface Slide {
  /** 1-based */
  index: number;
  /** `section[id]` or `slide-<n>` */
  id: string;
  /** `data-title`, first h1-h3 text, or `Slide <n>` */
  name: string;
  /** `data-layout`, default `Blank` */
  layout: string;
  /** `data-section` on the first Slide of a PowerPoint section */
  section?: string;
  /** paint order, backmost first */
  elements: Element[];
  notes?: TextBody;
}

export type Element = ShapeElement | PictureElement;

export interface Media {
  data: Uint8Array;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/svg+xml';
}

/** An `img` or inline `svg`, emitted as `p:pic`. */
export interface PictureElement {
  kind: 'picture';
  selector: string;
  name: string;
  /** the visible frame (content box, or the fitted rect for `object-fit: contain`), before rotation, CSS px */
  box: Box;
  /** degrees clockwise */
  rotation: number;
  /** fraction (0..1) of the source image outside the frame on each side -> `a:srcRect` */
  crop: Insets;
  geometry: Geometry;
  /** the element's border box (transformed like `box`), present when a border is drawn around the picture */
  outline?: Box;
  line?: Line;
  borders?: { top?: Line; right?: Line; bottom?: Line; left?: Line };
  shadow?: Shadow;
  opacity?: number;
  /** the raster payload for `a:blip`: PNG, JPEG, or the PNG fallback of an SVG */
  media: Media;
  /** SVG sources: the vector payload for `asvg:svgBlip` */
  vector?: Media;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Color {
  /** `RRGGBB` upper-case */
  hex: string;
  /** 0..1 */
  alpha: number;
}

export interface GradientStop {
  /** 0..1 along the gradient line */
  position: number;
  color: Color;
}

export type Fill =
  | { type: 'solid'; color: Color }
  /** `angle` in CSS degrees: 0 = to top, 90 = to right, clockwise */
  | { type: 'gradient'; kind: 'linear'; angle: number; stops: GradientStop[] }
  | { type: 'gradient'; kind: 'radial'; stops: GradientStop[] };

export interface Line {
  /** CSS px */
  width: number;
  color: Color;
  dash: 'solid' | 'dash' | 'dot';
}

export interface ShapeElement {
  kind: 'shape';
  /** CSS selector locating the source element (report locator) */
  selector: string;
  /** `p:cNvPr/@name`: tag plus id/class hint */
  name: string;
  /** border box relative to the Slide, before rotation, CSS px */
  box: Box;
  /** degrees clockwise */
  rotation: number;
  geometry: Geometry;
  fill?: Fill;
  /** uniform border; absent when sides differ (see `borders`) */
  line?: Line;
  /** per-side borders when they differ; emitted as one line per side */
  borders?: { top?: Line; right?: Line; bottom?: Line; left?: Line };
  /** single `box-shadow` without spread; others are left to the raster/flatten pass */
  shadow?: Shadow;
  text?: TextBody;
}

/** corner radii in CSS px, already scaled down when they overlap as CSS does */
export interface CornerRadius {
  x: number;
  y: number;
}

export type Geometry =
  | { preset: 'rect' }
  | { preset: 'roundRect'; radius: number }
  | { preset: 'ellipse' }
  | { preset: 'custom'; radii: { tl: CornerRadius; tr: CornerRadius; br: CornerRadius; bl: CornerRadius } };

export interface Shadow {
  inset: boolean;
  /** CSS px */
  offsetX: number;
  offsetY: number;
  blur: number;
  color: Color;
}

export interface Insets {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface TextBody {
  /** CSS padding on each side (border/2 and margin folds are applied by emit) */
  padding: Insets;
  /** gap between the box's padding edge and the first paragraph's line box, folded into tIns */
  firstParagraphGap: number;
  /** gap between the last paragraph's line box and the box's padding edge, folded into bIns */
  lastParagraphGap: number;
  /** false for `white-space: nowrap|pre` */
  wrap: boolean;
  rtl: boolean;
  /** widening applied on the trailing side when a line is within 0.5 px of the wrap width (0, 0.5 or 1) */
  trailingGuard: number;
  paragraphs: Paragraph[];
}

export type Align = 'l' | 'ctr' | 'r' | 'just';

export interface Paragraph {
  align: Align;
  /** measured line-box height of this paragraph, CSS px -> `a:spcPts` */
  lineHeight: number;
  /** measured gap to the previous paragraph in the same body, CSS px -> `a:spcBef` */
  spaceBefore: number;
  /** measured gap to the next paragraph in the same body, CSS px -> `a:spcAft` */
  spaceAfter: number;
  /** `a:pPr/@indent`, CSS px: `text-indent` for plain paragraphs; `-(marker advance)` for list items */
  indent: number;
  /** `a:pPr/@marL`, CSS px: list padding + nested indentation measured from the body's padding edge; 0 otherwise */
  marginLeft: number;
  /** list nesting depth 0-8; 0 for non-list paragraphs */
  level: number;
  /** present on list items only */
  bullet?: Bullet;
  runs: Run[];
}

export type AutonumScheme = 'arabicPeriod' | 'alphaLcPeriod' | 'alphaUcPeriod' | 'romanLcPeriod' | 'romanUcPeriod';

export type Bullet =
  | { type: 'char'; char: string; color: Color; sizePct: number }
  | { type: 'autonum'; scheme: AutonumScheme; startAt: number; color: Color; sizePct: number }
  | { type: 'none' };

export type Run = { kind: 'text'; text: string; style: RunStyle } | { kind: 'break' };

export interface RunStyle {
  /** computed `font-family` stack, quotes stripped, in order */
  fontStack: string[];
  /** filled by fonts/; undefined until resolution ran */
  font?: ResolvedFont;
  /** numeric computed `font-weight` */
  weight: number;
  /** CSS px */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Color;
  /** CSS px */
  letterSpacing: number;
  caps: 'none' | 'small';
  /** `a:rPr/@baseline` in 1/1000 %; 0, 30000 (super), -25000 (sub) */
  baseline: number;
  highlight?: Color;
  /** external URL or `#<slide id>` */
  link?: string;
}

export interface FontMetrics {
  /** hhea ascender in em units (>0) */
  ascender: number;
  /** hhea descender in em units (>0, magnitude) */
  descender: number;
}

export type FontClass = 'safe' | 'deck-provided' | 'installed';

export interface ResolvedFont {
  /** the family name written into `a:latin/@typeface` */
  family: string;
  file: string;
  class: FontClass;
  metrics: FontMetrics;
  /** OS/2 fsType; embedding permission */
  fsType: number;
}
