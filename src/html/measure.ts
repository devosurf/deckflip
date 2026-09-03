import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { textBodiesOf } from '../model/index.js';
import type { Box, Canvas, Deck, Element, ImageFill, PictureElement, Slide, TextBody } from '../model/index.js';
import { entry as reportEntry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import type { BrowserElement, BrowserImageFill, BrowserMeasureResult, BrowserPicture, BrowserRaster } from './browser-script.js';
import { loadMedia, reencodeToPng } from './media.js';
import { FREEZE_ATTR, measureSlideDocument, preloadBackgroundImages } from './browser-script.js';
import type { LoadedDeck, SlideDocument } from './load.js';
import { readNotes } from './notes.js';
import { captureRaster } from './raster.js';
import type { HtmlNode } from '../roundtrip/fingerprint.js';

export interface MeasureOptions {
  browser: Browser;
  /** raster density for captured subtrees (spec 05), default 192 */
  rasterDpi?: number;
}

/** What one page's element resolution needs beyond the elements: where the Slide sits and how to capture rasters. */
interface PageContext {
  page: Page;
  slide: number;
  canvas: Canvas;
  /** the section's offset in page coordinates */
  origin: { x: number; y: number };
  rasterDpi: number;
}

export interface MeasuredDeckResult {
  deck: Deck;
  entries: Entry[];
  /** each Slide's section as parsed, in Slide order: what the round trip fingerprints against the manifest */
  sections: HtmlNode[];
}

const SLIDE_SIZE_HINT = 'Do not set width/height on sections, or match {W}x{H} exactly';
const DROPPED_OFFCANVAS_HINT = 'Delete it or move it inside';
const FLATTEN_OFFCANVAS_HINT = 'PowerPoint clips at the slide edge; move {el} inside {W}x{H}';

export async function measureDeck(loaded: LoadedDeck, opts: MeasureOptions): Promise<MeasuredDeckResult> {
  const context = await opts.browser.newContext({ viewport: { width: loaded.canvas.width, height: loaded.canvas.height }, deviceScaleFactor: 1 });
  const entries: Entry[] = [...loaded.entries];
  const slides: Slide[] = [];
  const sections: HtmlNode[] = [];
  const fontFaces = new Map<string, { family: string; file: string; weight?: number; italic?: boolean }>();

  try {
    for (const document of loaded.documents) {
      const page = await context.newPage();
      try {
        const result = await measureDocumentPage(page, document);
        if (result.sectionBox.w !== loaded.canvas.width || result.sectionBox.h !== loaded.canvas.height) {
          entries.push(errorEntry('VALIDATE_SLIDE_SIZE', `Section size ${result.sectionBox.w}x${result.sectionBox.h} does not match canvas ${loaded.canvas.width}x${loaded.canvas.height}`, SLIDE_SIZE_HINT, 'body > section', document.index));
        }
        for (const raised of result.entries) {
          entries.push(reportEntry(raised.code, { slide: document.index, locator: { selector: raised.selector }, reason: raised.reason, ...(raised.params === undefined ? {} : { params: raised.params }) }));
        }

        const measuredElements = await resolveElements({ page, slide: document.index, canvas: loaded.canvas, origin: { x: result.sectionBox.x, y: result.sectionBox.y }, rasterDpi: opts.rasterDpi ?? 192 }, result.shapes, entries);

        for (const face of result.fontFaces) {
          const normalized = { ...face, file: fileURLToPath(face.file) };
          const key = `${normalized.family}\u0000${normalized.file}\u0000${normalized.weight ?? ''}\u0000${normalized.italic ? '1' : '0'}`;
          if (!fontFaces.has(key)) {
            fontFaces.set(key, normalized);
          }
        }

        const notes = readNotes(result.tree);
        const slide: Slide = {
          index: document.index,
          id: result.meta.id,
          name: resolveSlideName(document, result),
          layout: result.meta.layout || 'Blank',
          elements: measuredElements,
          ...(result.meta.section ? { section: result.meta.section } : {}),
          ...(notes ? { notes } : {}),
        };
        slides.push(slide);
        sections.push(result.tree);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  entries.push(...linkTargetEntries(slides));

  return {
    deck: {
      title: loaded.title,
      lang: loaded.lang,
      canvas: loaded.canvas,
      slides,
      fontFaces: Array.from(fontFaces.values()),
    },
    entries,
    sections,
  };
}

/** `VALIDATE_LINK_TARGET` once per text body and unknown `#<slide id>` jump (spec 02: internal hyperlinks target a section id). */
function linkTargetEntries(slides: Slide[]): Entry[] {
  const ids = new Set(slides.map((slide) => slide.id));
  const list = slides.map((slide) => `#${slide.id}`).join(', ');
  const entries: Entry[] = [];
  const check = (body: TextBody, selector: string, slide: number, owner: string) => {
    const seen = new Set<string>();
    for (const paragraph of body.paragraphs) {
      for (const run of paragraph.runs) {
        const link = run.kind === 'text' ? run.style.link : undefined;
        if (!link?.startsWith('#') || ids.has(link.slice(1)) || seen.has(link)) {
          continue;
        }
        seen.add(link);
        entries.push(reportEntry('VALIDATE_LINK_TARGET', { slide, locator: { selector }, reason: `href="${link}" on ${owner} points at no Slide`, params: { href: link, slides: list } }));
      }
    }
  };
  for (const slide of slides) {
    for (const element of slide.elements) {
      for (const { body, selector, name } of textBodiesOf(element)) {
        check(body, selector, slide.index, name);
      }
    }
    if (slide.notes) {
      check(slide.notes, 'aside.notes', slide.index, 'aside.notes');
    }
  }
  return entries;
}

async function measureDocumentPage(page: Page, slideDoc: SlideDocument): Promise<BrowserMeasureResult> {
  const tempPath = join(dirname(slideDoc.sourceFile), `.deckflip-${slideDoc.index}-${randomUUID().slice(0, 8)}.html`);
  await writeFile(tempPath, slideDoc.html, 'utf8');
  try {
    await page.goto(pathToFileURL(tempPath).href, { waitUntil: 'load' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Tagged so the page script can lift it while reading `transition` (see `validateDocument`). Animations are
    // also rewound to their first frame so a paused animation does not leave a timing-dependent state behind.
    const freeze = await page.addStyleTag({ content: '*{animation-play-state:paused!important;transition:none!important}' });
    await freeze.evaluate((style, attr) => (style as HTMLElement).setAttribute(attr, ''), FREEZE_ATTR);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    });
    // esbuild-transpiled builds (tsx, vitest) wrap nested function declarations in a `__name` helper that only
    // exists in the Node bundle; the serialised page script needs an identity shim for it.
    await page.evaluate('globalThis.__name = globalThis.__name || ((fn) => fn)');
    await page.evaluate(preloadBackgroundImages);
    return await page.evaluate(measureSlideDocument);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}


/** Off-canvas classification, picture byte loading and raster capture, recursing into groups (whose children are already inside the group's box). */
async function resolveElements(ctx: PageContext, measured: BrowserElement[], entries: Entry[]): Promise<Element[]> {
  const { slide, canvas } = ctx;
  const out: Element[] = [];
  for (const element of measured) {
    const offcanvas = classifyOffcanvas(element.box, canvas.width, canvas.height);
    if (offcanvas === 'dropped') {
      entries.push({
        code: 'DROPPED_OFFCANVAS',
        kind: 'dropped',
        severity: 'info',
        slide,
        locator: { selector: element.selector },
        reason: `Element ${element.name} is fully outside the canvas`,
        hint: DROPPED_OFFCANVAS_HINT,
      });
      continue;
    }
    if (element.kind === 'raster') {
      out.push(await resolveRaster(ctx, element, entries));
      continue;
    }
    if (offcanvas === 'flattened') {
      entries.push({
        code: 'FLATTEN_OFFCANVAS',
        kind: 'flattened',
        severity: 'warning',
        slide,
        locator: { selector: element.selector },
        reason: `Element ${element.name} extends beyond the canvas`,
        hint: FLATTEN_OFFCANVAS_HINT.replace('{el}', element.name).replace('{W}', String(canvas.width)).replace('{H}', String(canvas.height)),
      });
    }
    if (element.kind === 'picture') {
      const picture = await resolvePicture(ctx.page, element, slide, entries);
      if (picture) {
        out.push(picture);
      }
      continue;
    }
    if (element.kind === 'group') {
      const children = await resolveElements(ctx, element.children, entries);
      if (children.length > 0) {
        out.push({ ...element, children });
      }
      continue;
    }
    if (element.kind === 'shape') {
      const { fill, ...shape } = element;
      out.push(fill === undefined ? shape : { ...shape, fill: fill.type === 'image' ? await resolveImageFill(fill, element, slide, entries) : fill });
      continue;
    }
    if (element.kind === 'opaque') {
      const { edited, ...opaque } = element;
      if (edited) {
        entries.push(reportEntry('DROPPED_EDIT_OPAQUE', { slide, locator: { selector: element.selector }, reason: `${element.name} is opaque ${element.class} content; what was written inside it is ignored` }));
      }
      out.push({ ...opaque, parts: [] });
      continue;
    }
    out.push(element);
  }
  return out;
}

/** Loads an image fill's bytes: PNG/JPEG as they are; GIF, WebP and SVG re-encoded to PNG (`SUBSTITUTE_IMAGE_FORMAT`), since `a:blipFill` on a shape takes no vector. */
async function resolveImageFill(fill: BrowserImageFill, shape: { selector: string; name: string }, slide: number, entries: Entry[]): Promise<ImageFill> {
  const { url, ...rest } = fill;
  const path = fileURLToPath(url);
  const loaded = await loadMedia(path);
  const media = loaded.kind === 'vector' ? { data: await reencodeToPng(loaded.vector.data), contentType: 'image/png' as const } : loaded.media;
  if (loaded.kind === 'vector' || loaded.reencoded) {
    entries.push(reportEntry('SUBSTITUTE_IMAGE_FORMAT', { slide, locator: { selector: shape.selector }, reason: `background-image on ${shape.name} (${basename(path)}) is not PNG or JPEG` }));
  }
  return { ...rest, media };
}

/**
 * One `RASTER_*` entry and one PNG picture per rasterised subtree (spec 05): the clip is the painted extent
 * intersected with the Canvas, so a partly off-canvas raster is simply cropped rather than flattened.
 */
async function resolveRaster(ctx: PageContext, raster: BrowserRaster, entries: Entry[]): Promise<PictureElement> {
  const { canvas, slide } = ctx;
  const left = Math.max(0, raster.box.x);
  const top = Math.max(0, raster.box.y);
  const box: Box = { x: left, y: top, w: Math.min(canvas.width, raster.box.x + raster.box.w) - left, h: Math.min(canvas.height, raster.box.y + raster.box.h) - top };
  const locator = { selector: raster.selector };
  if (raster.trigger) {
    entries.push(reportEntry(`RASTER_${raster.trigger.suffix}`, { slide, locator, reason: `${raster.trigger.decl} on ${raster.name} has no DrawingML equivalent`, params: { decl: raster.trigger.decl } }));
  } else {
    entries.push(reportEntry('RASTER_EXPLICIT', { slide, locator, reason: `data-raster on ${raster.name}` }));
  }
  const data = await captureRaster(ctx.page, {
    selector: raster.selector,
    clip: { x: box.x + ctx.origin.x, y: box.y + ctx.origin.y, w: box.w, h: box.h },
    dpi: ctx.rasterDpi,
    viewport: { width: canvas.width, height: canvas.height },
  });
  return {
    kind: 'picture',
    source: 'raster',
    explicit: raster.trigger === undefined,
    ...(raster.shapeId === undefined ? {} : { shapeId: raster.shapeId }),
    selector: raster.selector,
    name: raster.name,
    box,
    rotation: 0,
    crop: { l: 0, t: 0, r: 0, b: 0 },
    geometry: { preset: 'rect' },
    media: { data, contentType: 'image/png' },
  };
}

/**
 * Loads the picture's bytes: PNG/JPEG as they are, GIF/WebP re-encoded (`SUBSTITUTE_IMAGE_FORMAT`), SVG as the
 * vector payload with a PNG fallback captured from the page (the element alone, untransformed and opaque).
 */
async function resolvePicture(page: Page, measured: BrowserPicture, slide: number, entries: Entry[]): Promise<PictureElement | undefined> {
  const { source, ...picture } = measured;
  if (source.kind === 'inline-svg') {
    const fallback = await captureElement(page, picture.selector);
    return { ...picture, media: { data: fallback, contentType: 'image/png' }, vector: { data: Buffer.from(source.svg, 'utf8'), contentType: 'image/svg+xml' } };
  }
  const path = fileURLToPath(source.url);
  const loaded = await loadMedia(path);
  if (loaded.kind === 'vector') {
    const fallback = await captureElement(page, picture.selector);
    return { ...picture, media: { data: fallback, contentType: 'image/png' }, vector: loaded.vector };
  }
  if (loaded.reencoded) {
    entries.push(reportEntry('SUBSTITUTE_IMAGE_FORMAT', { slide, locator: { selector: picture.selector }, reason: `${picture.name} (${basename(path)}) is not PNG or JPEG` }));
  }
  return { ...picture, media: loaded.media };
}

async function captureElement(page: Page, selector: string): Promise<Buffer> {
  const locator = page.locator(selector).first();
  const restore = await locator.evaluate((el) => {
    const element = el as HTMLElement;
    const prior = element.getAttribute('style');
    element.style.setProperty('transform', 'none', 'important');
    element.style.setProperty('opacity', '1', 'important');
    element.style.setProperty('clip-path', 'none', 'important');
    return prior;
  });
  try {
    return await locator.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await locator.evaluate((el, prior) => {
      if (prior === null) {
        el.removeAttribute('style');
      } else {
        el.setAttribute('style', prior);
      }
    }, restore);
  }
}
function resolveSlideName(document: SlideDocument, result: BrowserMeasureResult): string {
  if (!document.inlineSection) {
    return result.meta.docTitle || result.meta.title || result.meta.heading || `Slide ${document.index}`;
  }
  return result.meta.title || result.meta.heading || `Slide ${document.index}`;
}

function classifyOffcanvas(box: { x: number; y: number; w: number; h: number }, canvasWidth: number, canvasHeight: number): 'inside' | 'flattened' | 'dropped' {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  if (right <= 0 || bottom <= 0 || left >= canvasWidth || top >= canvasHeight) {
    return 'dropped';
  }
  if (left < 0 || top < 0 || right > canvasWidth || bottom > canvasHeight) {
    return 'flattened';
  }
  return 'inside';
}

function errorEntry(code: string, reason: string, hint: string, selector: string, slide: number): Entry {
  return {
    code,
    kind: 'error',
    severity: 'error',
    slide,
    locator: { selector },
    reason,
    hint,
  };
}
