import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { launchChromium } from '../src/render/chromium.js';
import { renderPptxPowerPoint } from '../src/render/powerpoint.js';
import { convertHtmlToPptx } from '../src/convert.js';
import { VERSION } from '../src/version.js';
import { ORACLE_RECORD, packageDigest, type OracleRecord } from '../test/corpus/oracle-record.js';

const CORPUS = join('fixtures', 'corpus');
const POWERPOINT_PLIST = '/Applications/Microsoft PowerPoint.app/Contents/Info.plist';

/** `corpus:oracle [category[/fixture] ...]`; no argument regenerates every HTML fixture. */
async function listFixtures(filters: string[]): Promise<Array<{ category: string; name: string }>> {
  const fixtures: Array<{ category: string; name: string }> = [];
  const categories = (await readdir(CORPUS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const category of categories) {
    const names = (await readdir(join(CORPUS, category), { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).map((entry) => entry.name).sort();
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
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const [index, png] of pages) {
    await writeFile(join(targetDir, `slide-${String(index).padStart(3, '0')}.png`), png);
  }
}

async function run(): Promise<void> {
  const powerpoint = (await promisify(execFile)('defaults', ['read', POWERPOINT_PLIST, 'CFBundleShortVersionString'])).stdout.trim();
  const browser = await launchChromium({ offline: true });
  try {
    for (const { category, name } of await listFixtures(process.argv.slice(2))) {
      const fixtureDir = join(CORPUS, category, name);
      const deckPath = join(fixtureDir, 'deck.html');
      const workDir = await mkdtemp(join(tmpdir(), `deckflip-oracle-${name}-`));
      const pptxPath = join(workDir, `${name}.pptx`);
      const { exitCode, report } = await convertHtmlToPptx(deckPath, {
        output: pptxPath,
        embedFonts: false,
        rasterDpi: 192,
        strict: false,
        offline: true,
        browser,
      });
      if (exitCode === 5) {
        throw new Error(`${category}/${name} fails Verification; fix that before recording an oracle: ${report.entries.filter((entry) => entry.code.startsWith('VERIFY_')).map((entry) => entry.reason).join('; ')}`);
      }
      const pages = await renderPptxPowerPoint(pptxPath, { dpi: 96 });
      await writeSlides(join(fixtureDir, 'expected', 'powerpoint'), pages);
      const record: OracleRecord = { digest: await packageDigest(await readFile(pptxPath)), powerpoint, deckflip: VERSION };
      await writeFile(join(fixtureDir, 'expected', ORACLE_RECORD), `${JSON.stringify(record, null, 2)}\n`);
      console.log(`${category}/${name}: wrote ${pages.size} PowerPoint oracle slide(s), PowerPoint ${powerpoint}`);
    }
  } finally {
    await browser.close();
  }
}

await run();
