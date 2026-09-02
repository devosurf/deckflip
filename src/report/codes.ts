import type { Entry, EntryKind, Locator, Severity } from './types.js';

export const CODE_FAMILIES = [
  'VALIDATE',
  'FONT',
  'RASTER',
  'FLATTEN',
  'SUBSTITUTE',
  'PRESERVE',
  'DROPPED',
  'OVERRIDE',
  'RENDER',
] as const;

export type CodeFamily = (typeof CODE_FAMILIES)[number];

type CodeMeta = {
  kind: EntryKind;
  severity: Severity;
  hint: string;
};

export const CODES = {
  VALIDATE_UNKNOWN_META: {
    kind: 'error',
    severity: 'error',
    hint: 'Remove it or check the spelling; known names: deckflip:canvas',
  },
  VALIDATE_STRAY_CONTENT: {
    kind: 'error',
    severity: 'error',
    hint: 'Move it into a <section>; only sections are Slides',
  },
  VALIDATE_SLIDE_SIZE: {
    kind: 'error',
    severity: 'error',
    hint: 'Do not set width/height on sections, or match {W}x{H} exactly',
  },
  VALIDATE_REMOTE_ASSET: {
    kind: 'error',
    severity: 'error',
    hint: 'Save the file into the Deck\'s asset directory and reference it relatively',
  },
  VALIDATE_MISSING_ASSET: {
    kind: 'error',
    severity: 'error',
    hint: 'Check the path relative to {file}',
  },
  VALIDATE_ELEMENT: {
    kind: 'error',
    severity: 'error',
    hint: 'Replace {el} with static HTML; scripts are never run',
  },
  VALIDATE_TEXT_CSS: {
    kind: 'error',
    severity: 'error',
    hint: 'Remove {decl}: PowerPoint cannot reproduce its line breaks',
  },
  VALIDATE_POSITION: {
    kind: 'error',
    severity: 'error',
    hint: 'Use absolute or flow layout inside the section',
  },
  VALIDATE_LIST_CONTENT: {
    kind: 'error',
    severity: 'error',
    hint: 'Keep list items to inline text plus one nested list',
  },
  VALIDATE_TABLE_CONTENT: {
    kind: 'error',
    severity: 'error',
    hint: 'Keep cell content to text, paragraphs and lists',
  },
  VALIDATE_RASTER_SLIDE: {
    kind: 'error',
    severity: 'error',
    hint: 'Rasterise parts, not the Slide; use deckflip render for PNGs',
  },
  VALIDATE_LINK_TARGET: {
    kind: 'error',
    severity: 'error',
    hint: 'Point {href} at a section id; Slides: {slides}',
  },
  FONT_UNRESOLVED: {
    kind: 'error',
    severity: 'error',
    hint: 'Install {family} or add a safe family such as Arial to the stack',
  },
  FONT_GENERIC_ONLY: {
    kind: 'error',
    severity: 'error',
    hint: 'Put a concrete family before {generic}',
  },
  FONT_NOT_SAFE: {
    kind: 'substituted',
    severity: 'warning',
    hint: 'Use a safe font, or pass --embed-fonts',
  },
  FONT_EMBED_RESTRICTED: {
    kind: 'substituted',
    severity: 'warning',
    hint: 'The licence of {family} forbids embedding; choose another font',
  },
  FONT_EMBED_FORMAT: {
    kind: 'substituted',
    severity: 'warning',
    hint: 'Provide {family} as TTF, OTF or WOFF',
  },
  FONT_MISSING_FOR_LAYOUT: {
    kind: 'substituted',
    severity: 'warning',
    hint: 'Install {family} before editing to keep layout faithful',
  },
  RASTER_CSS_FILTER: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Move {decl} onto a background image, or accept the picture with data-raster',
  },
  RASTER_BACKDROP_FILTER: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Remove {decl}; PowerPoint has no backdrop effects',
  },
  RASTER_BLEND_MODE: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Remove {decl} or pre-compose the image',
  },
  RASTER_MASK: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Apply the mask to the image file instead',
  },
  RASTER_CLIP_PATH: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use border-radius, overflow: hidden with a rectangle, or pre-crop the image',
  },
  RASTER_GRADIENT: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use a single linear-gradient or radial-gradient',
  },
  RASTER_SHADOW: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use one outer shadow without spread',
  },
  RASTER_BORDER_STYLE: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use solid, dashed or dotted',
  },
  RASTER_BORDER_IMAGE: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use a plain border or an img',
  },
  RASTER_TRANSFORM: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Only rotate, scale and translate are native',
  },
  RASTER_OUTLINE: {
    kind: 'rasterised',
    severity: 'warning',
    hint: 'Use border',
  },
  RASTER_EXPLICIT: {
    kind: 'rasterised',
    severity: 'info',
    hint: '(info) Remove data-raster to get editable objects',
  },
  FLATTEN_CSS_FILTER: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_BACKDROP_FILTER: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_BLEND_MODE: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_MASK: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_CLIP_PATH: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_GRADIENT: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_SHADOW: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_BORDER_STYLE: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_BORDER_IMAGE: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_TRANSFORM: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_OUTLINE: {
    kind: 'flattened',
    severity: 'warning',
    hint: '{decl} was dropped to keep the text editable; put the effect on a text-free sibling behind the text',
  },
  FLATTEN_TEXT_STROKE: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'Dropped; use a bold weight or colour instead',
  },
  FLATTEN_TEXT_BACKGROUND_CLIP: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'Dropped; use a solid color',
  },
  FLATTEN_TEXT_DECORATION_STYLE: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'Rendered as solid',
  },
  FLATTEN_TEXT_FONT_VARIANT: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'Dropped',
  },
  FLATTEN_TEXT_SHADOW_MULTI: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'First shadow kept',
  },
  FLATTEN_ANIMATION: {
    kind: 'flattened',
    severity: 'info',
    hint: 'Final state after load was used',
  },
  FLATTEN_OFFCANVAS: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'PowerPoint clips at the slide edge; move {el} inside {W}x{H}',
  },
  FLATTEN_MEDIA_POSTER: {
    kind: 'flattened',
    severity: 'warning',
    hint: 'Add poster so PowerPoint shows a frame',
  },
  SUBSTITUTE_SVG_PICTURE: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Emitted as a vector picture; use HTML boxes for editable shapes',
  },
  SUBSTITUTE_GRADIENT_RADIAL: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Emitted as a path gradient; check render',
  },
  SUBSTITUTE_BORDER_SIDES: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Emitted as separate lines',
  },
  SUBSTITUTE_OPACITY: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Folded into fill/line/text alpha',
  },
  SUBSTITUTE_IMAGE_FORMAT: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Re-encoded to PNG',
  },
  SUBSTITUTE_LIST_STYLE: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Emitted as decimal numbering',
  },
  SUBSTITUTE_FONT_WEIGHT: {
    kind: 'substituted',
    severity: 'info',
    hint: 'Nearest of regular/bold used',
  },
  PRESERVE_OPAQUE_CHART: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_SMARTART: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_OLE: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_VECTOR: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_TEXT_EFFECTS: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_ANIMATION: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_COMMENTS: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_VBA: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_OPAQUE_MASTER: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Editable only as a whole (move/resize/delete)',
  },
  PRESERVE_SOURCE_MISSING: {
    kind: 'preserved',
    severity: 'warning',
    hint: 'Everything was re-emitted from HTML; restore {dir} to keep the original parts',
  },
  PRESERVE_UNKNOWN_ID: {
    kind: 'preserved',
    severity: 'info',
    hint: 'Ignored',
  },
  DROPPED_EDIT_OPAQUE: {
    kind: 'dropped',
    severity: 'warning',
    hint: 'Only geometry of opaque elements is editable; recreate it as HTML to change content',
  },
  DROPPED_ANIMATION: {
    kind: 'dropped',
    severity: 'warning',
    hint: 'Restore the shape or accept the loss',
  },
  DROPPED_TEXT_EFFECTS: {
    kind: 'dropped',
    severity: 'warning',
    hint: 'Effects cannot be re-emitted from HTML',
  },
  DROPPED_EXTENSION: {
    kind: 'dropped',
    severity: 'info',
    hint: 'none needed',
  },
  DROPPED_OFFCANVAS: {
    kind: 'dropped',
    severity: 'info',
    hint: 'Delete it or move it inside',
  },
  OVERRIDE_CANVAS_SIZE: {
    kind: 'overridden',
    severity: 'info',
    hint: '--size differs from deck meta',
  },
  RENDER_FONT_SUBSTITUTED: {
    kind: 'substituted',
    severity: 'info',
    hint: 'LibreOffice rendered with a substitute for an Office-bundled font',
  },
} as const satisfies Record<string, CodeMeta>;

export type Code = keyof typeof CODES;

const TOKEN_KEYS = ['decl', 'el', 'family', 'generic', 'W', 'H', 'file', 'dir', 'href', 'slides'] as const;

function substitute(text: string, params?: Record<string, string>): string {
  let out = text;
  for (const key of TOKEN_KEYS) {
    out = out.replaceAll(`{${key}}`, params?.[key] ?? '');
  }
  return out;
}

export function entry(
  code: string,
  fields: { slide?: number; locator?: Locator; reason: string; params?: Record<string, string> },
): Entry {
  const meta = CODES[code as Code];
  if (!meta) {
    throw new RangeError(`Unknown report code: ${code}`);
  }
  return {
    code,
    kind: meta.kind,
    severity: meta.severity,
    ...(fields.slide === undefined ? {} : { slide: fields.slide }),
    ...(fields.locator === undefined ? {} : { locator: fields.locator }),
    reason: substitute(fields.reason, fields.params),
    hint: substitute(meta.hint, fields.params),
  };
}
