import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchChromium } from '../src/render/chromium.js';
import { renderPptxPowerPoint } from '../src/render/powerpoint.js';
import { convertHtmlToPptx } from '../src/convert.js';

const CORPUS = join('fixtures', 'corpus');

/** `corpus:oracle [category[/fixture] ...]`; no argument regenerates every HTML fixture. */
async function listFixtures(filters: string[]): Promise<Array<{ category: string; name: string }>> {
  const fixtures: Array<{ category: string; name: string }> = [];
  const categories = (await readdir(CORPUS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const category of categories) {
    const names = (await readdir(join(CORPUS, category), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const name of names) {
      const key = `${category}/${name}`;
      if (filters.length === 0 || filters.some((filter) => filter === category || filter === key)) {
        fixtures.push({ category, name });
      }
    }
  }
  return fixtures;
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
    for (const { category, name } of await listFixtures(process.argv.slice(2))) {
      const fixtureDir = join(CORPUS, category, name);
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
      console.log(`${category}/${name}: wrote ${pages.size} PowerPoint oracle slide(s)`);
    }
  } finally {
    await browser.close();
  }
}

await run();
