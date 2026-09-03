import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Browser } from 'playwright-core';
import { emitPptx } from './emit/index.js';
import { FontCatalog, resolveDeckFonts } from './fonts/index.js';
import { loadDeck } from './html/load.js';
import { measureDeck } from './html/measure.js';
import { emitHtml } from './htmlout/index.js';
import type { Canvas, Deck } from './model/index.js';
import { OpcReader } from './ooxml/opc.js';
import { parsePptx } from './parse/index.js';
import { chromiumVersion, launchChromium } from './render/chromium.js';
import { entry as reportEntry } from './report/codes.js';
import { buildReport, writeSidecar } from './report/index.js';
import type { Entry, Report } from './report/types.js';
import { hasVba, sourceEntries } from './roundtrip/entries.js';
import { buildManifest, MANIFEST_FILE, sha256, SOURCE_FILE } from './roundtrip/manifest.js';
import { resolveRoundTrip, type RoundTrip } from './roundtrip/index.js';
import { indexSource } from './roundtrip/source.js';
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
  /** the round trip's findings when the Deck came from a PPTX whose Asset directory is still there */
  roundTrip?: RoundTrip;
}

/** load -> measure -> fonts -> round trip; the report carries every entry, `deck` is present only when no error stopped the run. */
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
    const roundTrip = await resolveRoundTrip(measured.deck, measured.sections, loaded.deckFile);
    const entries = [...baseEntries, ...measured.entries, ...fontEntries, ...roundTrip.entries];
    const native = measured.deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
    const report = buildReport(reportBase(input, outputPath, loaded.canvas, chromiumVersion(browser), mode), entries, measured.deck.slides.length, native);
    return hasError(entries) ? { report } : { report, deck: measured.deck, roundTrip };
  } finally {
    if (opts.browser === undefined) await browser.close();
  }
}

export async function convertHtmlToPptx(
  input: string,
  opts: ConvertOptions,
): Promise<{ report: Report; outputPath: string; exitCode: 0 | 2 | 4 }> {
  let outputPath = opts.output ?? (await defaultPptxOutputPath(input));
  const run = await runHtmlPipeline(input, opts, 'convert', outputPath);

  if (run.deck === undefined) {
    const reportPath = opts.report ?? `${outputPath}.report.json`;
    await writeSidecar(run.report, reportPath);
    return { report: run.report, outputPath, exitCode: 2 };
  }

  // a macro-enabled source stays macro-enabled (spec 06 "VBA project"): the default output takes the .pptm extension
  if (opts.output === undefined && run.roundTrip?.preserved !== undefined && hasVba(run.roundTrip.preserved.source)) {
    outputPath = replaceExtension(outputPath, '.pptm');
    if (run.report.output) run.report.output = { ...run.report.output, path: outputPath };
  }
  const reportPath = opts.report ?? `${outputPath}.report.json`;

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const pptx =
    run.roundTrip?.identical ??
    (await emitPptx(run.deck, {
      ...(epoch === undefined ? {} : { created: new Date(Number(epoch) * 1000) }),
      appVersion: VERSION,
      ...(run.roundTrip?.preserved === undefined ? {} : { preserved: run.roundTrip.preserved }),
    }));

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

export interface ConvertToHtmlOptions {
  output?: string;
}

/**
 * PPTX -> HTML Deck + Asset directory (spec 02 "Absolute-positioned form", spec 06 "Attachment"). Fonts are
 * resolved on the parsed Deck first, as they are on the HTML side, so the emitted text carries the same
 * baseline correction the emitter applied. Report entries from font resolution are the report. The Asset
 * directory keeps the input verbatim as `source.pptx` and the manifest the way back splices from.
 */
export async function convertPptxToHtml(input: string, opts: ConvertToHtmlOptions = {}): Promise<{ report: Report; outputPath: string; assetsDir: string; exitCode: 0 }> {
  const outputPath = opts.output ?? replaceExtension(input, '.html');
  const assetsDir = replaceExtension(outputPath, '.assets');
  const bytes = new Uint8Array(await readFile(input));
  const deck = await parsePptx(bytes);
  const source = await indexSource(await OpcReader.load(bytes));
  const catalog = await FontCatalog.scan({ extraFiles: [] });
  const entries = [...resolveDeckFonts(deck, catalog, { embedFonts: false }), ...sourceEntries(deck, source)];
  const { html, assets, slides } = emitHtml(deck, { assetsDir: basename(assetsDir) });
  const manifest = buildManifest(html, slides, source, sha256(bytes));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, SOURCE_FILE), bytes);
  await writeFile(join(assetsDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, data] of assets) {
    const path = join(assetsDir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  const native = deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
  const base = { ...reportBase(input, outputPath, deck.canvas, undefined, 'convert'), input: { path: input, kind: 'pptx' as const }, output: { path: outputPath, kind: 'html' as const } };
  const report = buildReport(base, entries, deck.slides.length, native);
  await writeSidecar(report, `${outputPath}.report.json`);
  return { report, outputPath, assetsDir, exitCode: 0 };
}

/** `validate deck.pptx` (spec 01): the package parses, and the report lists what a round trip would carry opaquely. */
export async function validatePptx(input: string, opts: { report?: string } = {}): Promise<{ report: Report; exitCode: 0 }> {
  const bytes = new Uint8Array(await readFile(input));
  const deck = await parsePptx(bytes);
  const source = await indexSource(await OpcReader.load(bytes));
  const catalog = await FontCatalog.scan({ extraFiles: [] });
  const entries = [...resolveDeckFonts(deck, catalog, { embedFonts: false }), ...sourceEntries(deck, source)];
  const native = deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
  const base = { ...reportBase(input, undefined, deck.canvas, undefined, 'validate'), input: { path: input, kind: 'pptx' as const } };
  const report = buildReport(base, entries, deck.slides.length, native);
  if (opts.report !== undefined) await writeSidecar(report, opts.report);
  return { report, exitCode: 0 };
}
