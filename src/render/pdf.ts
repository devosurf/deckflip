import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const globals = globalThis as unknown as {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};

if (!globals.DOMMatrix) globals.DOMMatrix = DOMMatrix;
if (!globals.ImageData) globals.ImageData = ImageData;
if (!globals.Path2D) globals.Path2D = Path2D;

interface CanvasEntry {
  canvas: {
    width: number;
    height: number;
    toBuffer(format: 'image/png'): Buffer;
  };
  context: unknown;
}

class CanvasFactory {
  create(width: number, height: number): CanvasEntry {
    const canvas = createCanvas(width, height) as unknown as CanvasEntry['canvas'] & {
      getContext(kind: '2d'): unknown;
    };
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(entry: CanvasEntry, width: number, height: number): void {
    entry.canvas.width = width;
    entry.canvas.height = height;
    entry.context = (entry.canvas as unknown as { getContext(kind: '2d'): unknown }).getContext('2d');
  }

  destroy(entry: CanvasEntry): void {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
}

export async function rasterisePdf(
  pdf: Uint8Array,
  opts: { dpi: number; pages?: number[] },
): Promise<Map<number, Buffer>> {
  const loadingTask = getDocument({ data: pdf, useWorkerFetch: false });
  const document = await loadingTask.promise;
  const selected = opts.pages ? new Set(opts.pages) : undefined;
  const scale = opts.dpi / 72;
  const factory = new CanvasFactory();
  const out = new Map<number, Buffer>();

  try {
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      if (selected && !selected.has(pageIndex)) continue;
      const page = await document.getPage(pageIndex);
      try {
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const entry = factory.create(width, height);
        try {
          await page.render({
            canvasContext: entry.context as CanvasRenderingContext2D,
            canvas: entry.canvas as unknown as HTMLCanvasElement,
            viewport,
          }).promise;
          out.set(pageIndex, Buffer.from(entry.canvas.toBuffer('image/png')));
        } finally {
          factory.destroy(entry);
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await document.destroy();
    await loadingTask.destroy();
  }

  return out;
}
