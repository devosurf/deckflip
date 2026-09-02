import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError, Option } from 'commander';
import type { Browser } from 'playwright-core';
import type { Canvas, Deck, ResolvedFont, ShapeElement, TextBody } from '../model/index.js';
import { convertHtmlToPptx, validateHtml } from '../convert.js';
import { FontCatalog, resolveDeckFonts } from '../fonts/index.js';
import { loadDeck } from '../html/load.js';
import { measureDeck } from '../html/measure.js';
import { launchChromium, renderHtml } from '../render/chromium.js';
import { renderPptxLibreOffice } from '../render/libreoffice.js';
import { renderPptxPowerPoint } from '../render/powerpoint.js';
import { formatSummary, writeSidecar } from '../report/index.js';
import { DeckflipError, type Report } from '../report/types.js';
import { VERSION } from '../version.js';

export interface SizeOverride {
  width: number;
  height: number;
  source: 'flag';
}

export function parseEmbedFonts(value: boolean | string | undefined): false | true | string[] {
  if (value === undefined || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length === 0 ? true : names;
}

export function parseSlidesList(value: string): number[] {
  const slides = new Set<number>();
  const tokens = value.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new InvalidArgumentError('expected at least one slide number');
  }
  for (const token of tokens) {
    const dash = token.indexOf('-');
    if (dash === -1) {
      slides.add(parsePositiveInt(token, 'slides'));
      continue;
    }
    const start = parsePositiveInt(token.slice(0, dash), 'slides');
    const end = parsePositiveInt(token.slice(dash + 1), 'slides');
    if (end < start) {
      throw new InvalidArgumentError(`invalid slide range: ${token}`);
    }
    for (let slide = start; slide <= end; slide += 1) {
      slides.add(slide);
    }
  }
  return [...slides];
}

export function parseSize(value: string): SizeOverride {
  const trimmed = value.trim();
  if (trimmed === '16:9') {
    return { width: 1280, height: 720, source: 'flag' };
  }
  if (trimmed === '4:3') {
    return { width: 960, height: 720, source: 'flag' };
  }
  const match = /^(\d+)x(\d+)$/.exec(trimmed);
  if (match === null) {
    throw new InvalidArgumentError('expected 16:9, 4:3, or <w>x<h>');
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new InvalidArgumentError('expected 16:9, 4:3, or <w>x<h>');
  }
  return { width, height, source: 'flag' };
}

export const parseEmbedFontsValue = parseEmbedFonts;
export const parseSizeOverride = parseSize;

function parsePositiveInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`expected a positive integer for --${flag}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`expected a positive integer for --${flag}`);
  }
  return parsed;
}

function inferInputKind(input: string): 'html' | 'pptx' {
  return extname(input).toLowerCase() === '.pptx' ? 'pptx' : 'html';
}

function notImplemented(): never {
  throw new DeckflipError('not implemented in 0.1.0', 3);
}

function defaultValidateReportPath(input: string): string {
  const extension = extname(input);
  if (extension.length > 0) {
    return `${input.slice(0, -extension.length)}.report.json`;
  }
  return `${input}.report.json`;
}

function previewText(body: TextBody): string {
  let text = '';
  for (const paragraph of body.paragraphs) {
    for (const run of paragraph.runs) {
      text += run.kind === 'text' ? run.text : '\n';
    }
    text += '\n';
  }
  return text.trimEnd().slice(0, 120);
}

function uniqueFonts(deck: Deck): ResolvedFont[] {
  const fonts = new Map<string, ResolvedFont>();
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      if (element.text === undefined) {
        continue;
      }
      for (const paragraph of element.text.paragraphs) {
        for (const run of paragraph.runs) {
          if (run.kind !== 'text' || run.style.font === undefined) {
            continue;
          }
          fonts.set(run.style.font.file, run.style.font);
        }
      }
    }
  }
  return [...fonts.values()];
}

function inspectElement(element: ShapeElement) {
  return {
    kind: element.text === undefined ? 'shape' : 'text',
    selector: element.selector,
    box: element.box,
    ...(element.text === undefined ? {} : { text: previewText(element.text) }),
  };
}

function inspectJson(deck: Deck) {
  return {
    schemaVersion: 1 as const,
    canvas: deck.canvas,
    slides: deck.slides.map((slide) => ({
      index: slide.index,
      id: slide.id,
      name: slide.name,
      elements: slide.elements.map((element) => inspectElement(element)),
    })),
    fonts: uniqueFonts(deck),
  };
}

async function printSummary(report: Report, color: boolean): Promise<void> {
  process.stderr.write(`${formatSummary(report, { color })}\n`);
}

async function handleConvert(input: string, options: ConvertCliOptions): Promise<number> {
  const inputKind = inferInputKind(input);
  const targetKind = options.to ?? (inputKind === 'html' ? 'pptx' : 'html');
  if (targetKind !== 'pptx' || inputKind !== 'html') {
    notImplemented();
  }
  const result = await convertHtmlToPptx(input, {
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.size === undefined ? {} : { size: options.size }),
    embedFonts: options.embedFonts ?? false,
    rasterDpi: options.rasterDpi,
    ...(options.report === undefined ? {} : { report: options.report }),
    strict: options.strict,
    ...(options.browser === undefined ? {} : { browserPath: options.browser }),
    offline: options.offline,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  }
  if (!options.quiet) {
    await printSummary(result.report, options.color !== false);
  }
  return result.exitCode;
}

async function handleValidate(input: string, options: ValidateCliOptions): Promise<number> {
  if (inferInputKind(input) !== 'html') {
    notImplemented();
  }
  const result = await validateHtml(input, {
    ...(options.size === undefined ? {} : { size: options.size }),
    embedFonts: options.embedFonts ?? false,
    rasterDpi: options.rasterDpi,
    ...(options.report === undefined ? {} : { report: options.report }),
    ...(options.browser === undefined ? {} : { browserPath: options.browser }),
    offline: options.offline,
  });
  await writeSidecar(result.report, options.report ?? defaultValidateReportPath(input));
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  }
  if (!options.quiet) {
    await printSummary(result.report, options.color !== false);
  }
  return options.strict && result.report.entries.length > 0 ? 4 : result.exitCode;
}

async function handleRender(input: string, options: RenderCliOptions): Promise<number> {
  const kind = inferInputKind(input);
  const slideFilter = options.slides;
  const outputDir = options.output;
  await mkdir(outputDir, { recursive: true });

  if (kind === 'html') {
    const loaded = await loadDeck(input, {});
    const browser = await launchChromium({
      ...(options.browser === undefined ? {} : { browserPath: options.browser }),
      offline: options.offline,
    });
    try {
      const images = await renderHtml(loaded, {
        browser,
        dpi: options.dpi,
        ...(slideFilter === undefined ? {} : { slides: slideFilter }),
      });
      for (const [index, png] of images) {
        await writeFile(join(outputDir, `slide-${String(index).padStart(3, '0')}.png`), png);
      }
      return 0;
    } finally {
      await browser.close();
    }
  }

  const images = options.renderer === 'powerpoint'
    ? await renderPptxPowerPoint(input, {
        dpi: options.dpi,
        ...(slideFilter === undefined ? {} : { slides: slideFilter }),
      })
    : await renderPptxLibreOffice(input, {
        dpi: options.dpi,
        ...(options.soffice === undefined ? {} : { soffice: options.soffice }),
        ...(slideFilter === undefined ? {} : { slides: slideFilter }),
      });
  for (const [index, png] of images) {
    await writeFile(join(outputDir, `slide-${String(index).padStart(3, '0')}.png`), png);
  }
  return 0;
}

async function handleInspect(input: string): Promise<number> {
  if (inferInputKind(input) !== 'html') {
    notImplemented();
  }
  const loaded = await loadDeck(input, {});
  const browser = await launchChromium({ offline: false });
  try {
    const measured = await measureDeck(loaded, { browser });
    const catalog = await FontCatalog.scan({ extraFiles: measured.deck.fontFaces.map((face) => face.file) });
    resolveDeckFonts(measured.deck, catalog, { embedFonts: false });
    process.stdout.write(`${JSON.stringify(inspectJson(measured.deck), null, 2)}\n`);
    return 0;
  } finally {
    await browser.close();
  }
}

type ConvertCliOptions = {
  output?: string;
  to?: 'pptx' | 'html';
  size?: string;
  embedFonts?: false | true | string[];
  rasterDpi: number;
  report?: string;
  strict: boolean;
  json: boolean;
  quiet: boolean;
  color?: boolean;
  browser?: string;
  offline: boolean;
};

type ValidateCliOptions = {
  size?: string;
  embedFonts?: false | true | string[];
  rasterDpi: number;
  report?: string;
  strict: boolean;
  json: boolean;
  quiet: boolean;
  color?: boolean;
  browser?: string;
  offline: boolean;
};

type RenderCliOptions = {
  output: string;
  dpi: number;
  slides?: number[];
  renderer: 'libreoffice' | 'powerpoint';
  soffice?: string;
  browser?: string;
  offline: boolean;
};

function buildProgram(): Command {
  const program = new Command();
  program.name('deckflip').version(VERSION);
  program.exitOverride();
  program.showHelpAfterError();

  program
    .command('convert <input>')
    .description(
      'Convert HTML or a Deck directory to PPTX. The direction is inferred from the input unless --to overrides it. Validation runs first; a validation error exits 2 and nothing is written. --to html is not implemented in 0.1.0.',
    )
    .addOption(new Option('--to <kind>').choices(['pptx', 'html']))
    .option('-o, --output <output>', 'output PPTX path')
    .option('--size <size>', 'override the canvas size')
    .option('--embed-fonts [names]', 'embed all safe fonts or a comma-separated list', parseEmbedFonts, false)
    .option('--raster-dpi <n>', 'rasterisation DPI', (value) => parsePositiveInt(value, 'raster-dpi'), 192)
    .option('--report <path>', 'report sidecar path')
    .option('--strict', 'treat any report entry as a failure')
    .option('--json', 'print the report JSON to stdout')
    .option('--quiet', 'suppress the human summary on stderr')
    .option('--no-color', 'disable ANSI colors')
    .option('--browser <path>', 'use an existing Chromium or Chrome binary')
    .option('--offline', 'do not download Chromium')
    .action(async (input: string, options: ConvertCliOptions) => {
      process.exitCode = await handleConvert(input, options);
    });

  program
    .command('validate <input>')
    .description(
      'Check an HTML Deck and report what would be flattened or rasterised. The same report format as convert is written and/or printed; this command does not emit a PPTX.',
    )
    .option('--size <size>', 'override the canvas size')
    .option('--embed-fonts [names]', 'embed all safe fonts or a comma-separated list', parseEmbedFonts, false)
    .option('--raster-dpi <n>', 'rasterisation DPI', (value) => parsePositiveInt(value, 'raster-dpi'), 192)
    .option('--report <path>', 'report sidecar path')
    .option('--strict', 'treat any report entry as a failure')
    .option('--json', 'print the report JSON to stdout')
    .option('--quiet', 'suppress the human summary on stderr')
    .option('--no-color', 'disable ANSI colors')
    .option('--browser <path>', 'use an existing Chromium or Chrome binary')
    .option('--offline', 'do not download Chromium')
    .action(async (input: string, options: ValidateCliOptions) => {
      process.exitCode = await handleValidate(input, options);
    });

  program
    .command('render <input>')
    .description(
      'Render each Slide to slide-001.png. HTML input renders in Chromium; PPTX input renders with LibreOffice by default, or real PowerPoint when requested and available.',
    )
    .requiredOption('-o, --output <dir>', 'output directory')
    .option('--dpi <n>', 'output DPI', (value) => parsePositiveInt(value, 'dpi'), 192)
    .option('--slides <list>', 'render only the selected slides', parseSlidesList)
    .addOption(new Option('--renderer <kind>').choices(['libreoffice', 'powerpoint']).default('libreoffice'))
    .option('--soffice <path>', 'explicit LibreOffice executable')
    .option('--browser <path>', 'use an existing Chromium or Chrome binary')
    .option('--offline', 'do not download Chromium')
    .action(async (input: string, options: RenderCliOptions) => {
      process.exitCode = await handleRender(input, options);
    });

  program
    .command('inspect <input>')
    .description(
      'Print a JSON snapshot of the measured HTML Deck. PPTX input is not implemented in 0.1.0.',
    )
    .action(async (input: string) => {
      process.exitCode = await handleInspect(input);
    });

  return program;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const program = buildProgram();
  if (argv.length === 0) {
    program.outputHelp();
    return 0;
  }
  try {
    await program.parseAsync(argv, { from: 'user' });
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof DeckflipError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    const errorWithCode = error as { code?: unknown };
    if (error instanceof Error && typeof errorWithCode.code === 'string') {
      const code = errorWithCode.code;
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        return 0;
      }
      if (code.startsWith('commander.')) {
        return 3;
      }
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
