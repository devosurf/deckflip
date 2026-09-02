import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Browser } from 'playwright-core';
import { emitPptx } from './emit/index.js';
import { FontCatalog, resolveDeckFonts } from './fonts/index.js';
import { loadDeck } from './html/load.js';
import { measureDeck } from './html/measure.js';
import type { Canvas, Deck } from './model/index.js';
import { chromiumVersion, launchChromium } from './render/chromium.js';
import { entry as reportEntry } from './report/codes.js';
import { buildReport, writeSidecar } from './report/index.js';
import type { Entry, Report } from './report/types.js';
import { VERSION } from './version.js';

export interface ConvertOptions {
  output?: string;
  size?: string;
  embedFonts: false | true | string[];
  rasterDpi: number;
  report?: string;
  strict: boolean;
  browserPath?: string;
  offline: boolean;
  /** reuse an already-launched browser (tests, render) */
  browser?: Browser;
}

export type ValidateOptions = Omit<ConvertOptions, 'output' | 'strict'>;

async function defaultPptxOutputPath(input: string): Promise<string> {
  const info = await stat(input).catch(() => undefined);
  if (info?.isDirectory()) return join(input, `${basename(input)}.pptx`);
  return replaceExtension(input, '.pptx');
}

function replaceExtension(path: string, ext: string): string {
  const current = extname(path);
  return current.length > 0 ? `${path.slice(0, -current.length)}${ext}` : `${path}${ext}`;
}

function hasError(entries: Entry[]): boolean {
  return entries.some((e) => e.severity === 'error');
}

function reportBase(
  input: string,
  output: string | undefined,
  canvas: Canvas,
  browserVersion: string | undefined,
  command: 'convert' | 'validate',
): Omit<Report, 'summary' | 'schemaVersion' | 'entries'> {
  return {
    tool: { name: 'deckflip', version: VERSION, ...(browserVersion === undefined ? {} : { browser: browserVersion }) },
    command,
    input: { path: input, kind: 'html' },
    ...(output === undefined ? {} : { output: { path: output, kind: 'pptx' } }),
    canvas: { width: canvas.width, height: canvas.height, source: canvas.source },
  };
}

interface PipelineRun {
  report: Report;
  deck?: Deck;
}

/** load -> measure -> fonts; the report carries every entry, `deck` is present only when no error stopped the run. */
async function runHtmlPipeline(
  input: string,
  opts: ValidateOptions,
  mode: 'convert' | 'validate',
  outputPath?: string,
): Promise<PipelineRun> {
  const loaded = await loadDeck(input, opts.size === undefined ? {} : { size: opts.size });
  const baseEntries = [...loaded.entries];
  if (loaded.canvasOverridden) {
    baseEntries.push(reportEntry('OVERRIDE_CANVAS_SIZE', { reason: '--size differs from deck meta' }));
  }
  if (hasError(baseEntries)) {
    return { report: buildReport(reportBase(input, outputPath, loaded.canvas, undefined, mode), baseEntries, loaded.documents.length, 0) };
  }

  const browser =
    opts.browser ?? (await launchChromium({ ...(opts.browserPath === undefined ? {} : { browserPath: opts.browserPath }), offline: opts.offline }));
  try {
    const measured = await measureDeck(loaded, { browser, rasterDpi: opts.rasterDpi });
    const catalog = await FontCatalog.scan({ extraFiles: measured.deck.fontFaces.map((face) => face.file) });
    const fontEntries = resolveDeckFonts(measured.deck, catalog, { embedFonts: opts.embedFonts });
    const entries = [...baseEntries, ...measured.entries, ...fontEntries];
    const native = measured.deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
    const report = buildReport(reportBase(input, outputPath, loaded.canvas, chromiumVersion(browser), mode), entries, measured.deck.slides.length, native);
    return hasError(entries) ? { report } : { report, deck: measured.deck };
  } finally {
    if (opts.browser === undefined) await browser.close();
  }
}

export async function convertHtmlToPptx(
  input: string,
  opts: ConvertOptions,
): Promise<{ report: Report; outputPath: string; exitCode: 0 | 2 | 4 }> {
  const outputPath = opts.output ?? (await defaultPptxOutputPath(input));
  const reportPath = opts.report ?? `${outputPath}.report.json`;
  const run = await runHtmlPipeline(input, opts, 'convert', outputPath);

  if (run.deck === undefined) {
    await writeSidecar(run.report, reportPath);
    return { report: run.report, outputPath, exitCode: 2 };
  }

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const pptx = await emitPptx(run.deck, { ...(epoch === undefined ? {} : { created: new Date(Number(epoch) * 1000) }), appVersion: VERSION });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, pptx);
  await writeSidecar(run.report, reportPath);

  return { report: run.report, outputPath, exitCode: opts.strict && run.report.entries.length > 0 ? 4 : 0 };
}

export async function validateHtml(input: string, opts: ValidateOptions): Promise<{ report: Report; exitCode: 0 | 2 }> {
  const run = await runHtmlPipeline(input, opts, 'validate');
  if (opts.report !== undefined) await writeSidecar(run.report, opts.report);
  return { report: run.report, exitCode: run.deck === undefined ? 2 : 0 };
}
