import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import type { Deck, Element, Slide } from '../model/index.js';
import type { Entry } from '../report/types.js';
import type { BrowserMeasureResult } from './browser-script.js';
import { measureSlideDocument } from './browser-script.js';
import type { LoadedDeck, SlideDocument } from './load.js';

export interface MeasureOptions {
  browser: Browser;
}

export interface MeasuredDeckResult {
  deck: Deck;
  entries: Entry[];
}

const SLIDE_SIZE_HINT = 'Do not set width/height on sections, or match {W}x{H} exactly';
const DROPPED_OFFCANVAS_HINT = 'Delete it or move it inside';
const FLATTEN_OFFCANVAS_HINT = 'PowerPoint clips at the slide edge; move {el} inside {W}x{H}';

export async function measureDeck(loaded: LoadedDeck, opts: MeasureOptions): Promise<MeasuredDeckResult> {
  const context = await opts.browser.newContext({ viewport: { width: loaded.canvas.width, height: loaded.canvas.height }, deviceScaleFactor: 1 });
  const entries: Entry[] = [...loaded.entries];
  const slides: Slide[] = [];
  const fontFaces = new Map<string, { family: string; file: string; weight?: number; italic?: boolean }>();

  try {
    for (const document of loaded.documents) {
      const page = await context.newPage();
      try {
        const result = await measureDocumentPage(page, document);
        if (result.sectionBox.w !== loaded.canvas.width || result.sectionBox.h !== loaded.canvas.height) {
          entries.push(errorEntry('VALIDATE_SLIDE_SIZE', `Section size ${result.sectionBox.w}x${result.sectionBox.h} does not match canvas ${loaded.canvas.width}x${loaded.canvas.height}`, SLIDE_SIZE_HINT, 'body > section', document.index));
        }

        const measuredElements: Element[] = [];
        for (const shape of result.shapes) {
          const offcanvas = classifyOffcanvas(shape.box, loaded.canvas.width, loaded.canvas.height);
          if (offcanvas === 'dropped') {
            entries.push({
              code: 'DROPPED_OFFCANVAS',
              kind: 'dropped',
              severity: 'info',
              slide: document.index,
              locator: { selector: shape.selector },
              reason: `Element ${shape.name} is fully outside the canvas`,
              hint: DROPPED_OFFCANVAS_HINT,
            });
            continue;
          }
          if (offcanvas === 'flattened') {
            entries.push({
              code: 'FLATTEN_OFFCANVAS',
              kind: 'flattened',
              severity: 'warning',
              slide: document.index,
              locator: { selector: shape.selector },
              reason: `Element ${shape.name} extends beyond the canvas`,
              hint: FLATTEN_OFFCANVAS_HINT.replace('{el}', shape.name).replace('{W}', String(loaded.canvas.width)).replace('{H}', String(loaded.canvas.height)),
            });
          }
          measuredElements.push(shape);
        }

        for (const face of result.fontFaces) {
          const normalized = { ...face, file: fileURLToPath(face.file) };
          const key = `${normalized.family}\u0000${normalized.file}\u0000${normalized.weight ?? ''}\u0000${normalized.italic ? '1' : '0'}`;
          if (!fontFaces.has(key)) {
            fontFaces.set(key, normalized);
          }
        }

        const slide: Slide = {
          index: document.index,
          id: result.meta.id,
          name: resolveSlideName(document, result),
          layout: result.meta.layout || 'Blank',
          elements: measuredElements,
          ...(result.meta.section ? { section: result.meta.section } : {}),
        };
        slides.push(slide);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return {
    deck: {
      title: loaded.title,
      lang: loaded.lang,
      canvas: loaded.canvas,
      slides,
      fontFaces: Array.from(fontFaces.values()),
    },
    entries,
  };
}

async function measureDocumentPage(page: Page, slideDoc: SlideDocument): Promise<BrowserMeasureResult> {
  const tempPath = join(dirname(slideDoc.sourceFile), `.deckflip-${slideDoc.index}-${randomUUID().slice(0, 8)}.html`);
  await writeFile(tempPath, slideDoc.html, 'utf8');
  try {
    await page.goto(pathToFileURL(tempPath).href, { waitUntil: 'load' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({ content: '*{animation-play-state:paused!important;transition:none!important}' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    // esbuild-transpiled builds (tsx, vitest) wrap nested function declarations in a `__name` helper that only
    // exists in the Node bundle; the serialised page script needs an identity shim for it.
    await page.evaluate('globalThis.__name = globalThis.__name || ((fn) => fn)');
    return await page.evaluate(measureSlideDocument);
  } finally {
    await unlink(tempPath).catch(() => {});
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
