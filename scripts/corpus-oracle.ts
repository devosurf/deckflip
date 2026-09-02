import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchChromium } from '../src/render/chromium.js';
import { renderPptxPowerPoint } from '../src/render/powerpoint.js';
import { convertHtmlToPptx } from '../src/convert.js';

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(join('fixtures', 'corpus', 'text'), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function writeSlides(targetDir: string, pages: Map<number, Buffer>): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const [index, png] of pages) {
    await writeFile(join(targetDir, `slide-${String(index).padStart(3, '0')}.png`), png);
  }
}

async function run(): Promise<void> {
  const browser = await launchChromium({ offline: true });
  try {
    for (const name of await listFixtures()) {
      const fixtureDir = join('fixtures', 'corpus', 'text', name);
      const deckPath = join(fixtureDir, 'deck.html');
      const workDir = await mkdtemp(join(tmpdir(), `deckflip-oracle-${name}-`));
      const pptxPath = join(workDir, `${name}.pptx`);
      await convertHtmlToPptx(deckPath, {
        output: pptxPath,
        embedFonts: false,
        rasterDpi: 192,
        strict: false,
        offline: true,
        browser,
      });
      const pages = await renderPptxPowerPoint(pptxPath, { dpi: 96 });
      await writeSlides(join(fixtureDir, 'expected', 'powerpoint'), pages);
      console.log(`${name}: wrote ${pages.size} PowerPoint oracle slide(s)`);
    }
  } finally {
    await browser.close();
  }
}

await run();
