import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { DeckflipError } from '../report/types.js';
import { rasterisePdf } from './pdf.js';

const execFileAsync = promisify(execFile);
const STANDARD_SOFFICE = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/lib/libreoffice/program/soffice',
] as const;

function which(command: string): string | undefined {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(bin, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return undefined;
  const line = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  return line ? line : undefined;
}

export function findSoffice(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.DECKFLIP_SOFFICE) return process.env.DECKFLIP_SOFFICE;
  const onPath = which('soffice');
  if (onPath) return onPath;
  for (const candidate of STANDARD_SOFFICE) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function convertToPdf(soffice: string, pptxPath: string, tempDir: string): Promise<string> {
  const profileDir = join(tempDir, 'profile');
  const outDir = join(tempDir, 'out');
  await mkdir(profileDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await execFileAsync(
    soffice,
    [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--headless',
      '--convert-to',
      'pdf:impress_pdf_Export',
      '--outdir',
      outDir,
      pptxPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const pdfPath = join(outDir, `${basename(pptxPath, extname(pptxPath))}.pdf`);
  await access(pdfPath);
  return pdfPath;
}

export async function renderPptxLibreOffice(
  pptxPath: string,
  opts: { dpi: number; soffice?: string; slides?: number[] },
): Promise<Map<number, Buffer>> {
  const soffice = findSoffice(opts.soffice);
  if (!soffice) {
    throw new DeckflipError('LibreOffice renderer requires soffice. Set DECKFLIP_SOFFICE or install LibreOffice.', 1);
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'deckflip-lo-'));
  try {
    const pdfPath = await convertToPdf(soffice, pptxPath, tempDir);
    const pdf = await readFile(pdfPath);
    const rasterOptions = opts.slides ? { dpi: opts.dpi, pages: opts.slides } : { dpi: opts.dpi };
    return rasterisePdf(new Uint8Array(pdf), rasterOptions);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
