import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { DeckflipError } from '../report/types.js';

interface SlideDocument {
  index: number;
  html: string;
  baseUrl: string;
  sourceFile: string;
  inlineSection?: true;
}

interface LoadedDeck {
  canvas: { width: number; height: number };
  documents: SlideDocument[];
}

const PLAYWRIGHT_CLI = resolve('node_modules', 'playwright-core', 'cli.js');
const INSTALL_COMMAND = 'node node_modules/playwright-core/cli.js install chromium';

function installManagedChromium(): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    console.error(`Chromium not found; installing with: ${INSTALL_COMMAND}`);
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'install', 'chromium'], { stdio: 'inherit' });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new DeckflipError(`Failed to install Chromium with ${INSTALL_COMMAND}${signal ? ` (signal ${signal})` : ''}`, 1));
    });
  });
}

export async function launchChromium(opts: { browserPath?: string; offline: boolean }): Promise<Browser> {
  const browserPath = opts.browserPath ?? process.env.DECKFLIP_BROWSER;
  if (browserPath) {
    return chromium.launch({ executablePath: browserPath, headless: true });
  }

  const managedPath = chromium.executablePath();
  if (existsSync(managedPath)) {
    return chromium.launch({ executablePath: managedPath, headless: true });
  }

  if (opts.offline || process.env.DECKFLIP_OFFLINE === '1' || process.env.CI === 'true') {
    throw new DeckflipError(`Chromium is not installed. Run ${INSTALL_COMMAND}.`, 1);
  }

  await installManagedChromium();
  return chromium.launch({ executablePath: chromium.executablePath(), headless: true });
}

export function chromiumVersion(browser: Browser): string {
  return browser.version();
}

async function writeTemporaryHtml(sourceFile: string, html: string): Promise<string> {
  const tempDir = dirname(resolve(sourceFile));
  const tempPath = join(tempDir, `.deckflip-render-${randomUUID()}.html`);
  await writeFile(tempPath, html, 'utf8');
  return tempPath;
}

async function renderSlide(browser: Browser, loaded: LoadedDeck, slide: SlideDocument, dpi: number): Promise<Buffer> {
  const htmlPath = await writeTemporaryHtml(slide.sourceFile, slide.html);
  const context = await browser.newContext({
    viewport: { width: loaded.canvas.width, height: loaded.canvas.height },
    deviceScaleFactor: dpi / 96,
  });

  try {
    const page = await context.newPage();
    try {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await page.addStyleTag({
        content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}',
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const box = await page.locator('body > section').boundingBox();
      if (!box) {
        throw new Error(`Slide ${slide.index} has no measurable <section>`);
      }
      return Buffer.from(await page.screenshot({ clip: box, type: 'png' }));
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
    await rm(htmlPath, { force: true });
  }
}

export async function renderHtml(
  loaded: LoadedDeck,
  opts: { browser: Browser; dpi: number; slides?: number[] },
): Promise<Map<number, Buffer>> {
  const selected = opts.slides ? new Set(opts.slides) : undefined;
  const out = new Map<number, Buffer>();
  for (const slide of loaded.documents) {
    if (selected && !selected.has(slide.index)) continue;
    out.set(slide.index, await renderSlide(opts.browser, loaded, slide, opts.dpi));
  }
  return out;
}
