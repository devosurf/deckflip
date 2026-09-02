import { execFile } from 'node:child_process';
import { access, readFile, rm, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { userInfo, tmpdir } from 'node:os';
import { DeckflipError } from '../report/types.js';
import { rasterisePdf } from './pdf.js';

const execFileAsync = promisify(execFile);

function quoteAppleScript(value: string): string {
  return JSON.stringify(value);
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runOsascript(script: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile('osascript', ['-'], (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
    child.stdin?.end(script);
  });
}

async function renderOnMac(pptxPath: string): Promise<string> {
  const pdfName = `deckflip-render-${process.pid}.pdf`;
  const desktopPath = join(process.env.HOME ?? tmpdir(), 'Desktop', pdfName);
  const desktopHfsPath = `Macintosh HD:Users:${userInfo().username}:Desktop:${pdfName}`;
  const script = [
    `set inputFile to POSIX file ${quoteAppleScript(resolve(pptxPath))}`,
    `set outputFile to ${quoteAppleScript(desktopHfsPath)}`,
    'tell application "Microsoft PowerPoint"',
    '  activate',
    '  open inputFile',
    '  delay 1',
    '  set p to active presentation',
    '  save p in outputFile as save as PDF',
    '  close p saving no',
    'end tell',
    '',
  ].join('\n');
  await runOsascript(script);
  await access(desktopPath);
  return desktopPath;
}

async function renderOnWindows(pptxPath: string, tempDir: string): Promise<string> {
  const pdfPath = join(tempDir, 'powerpoint.pdf');
  const script = [
    `$pptx = ${quotePowerShell(pptxPath)}`,
    `$pdf = ${quotePowerShell(pdfPath)}`,
    '$powerPoint = New-Object -ComObject PowerPoint.Application',
    'try {',
    '  $presentation = $powerPoint.Presentations.Open($pptx, $false, $false, $false)',
    '  try {',
    '    $presentation.ExportAsFixedFormat($pdf, 2)',
    '  } finally {',
    '    $presentation.Close()',
    '  }',
    '} finally {',
    '  $powerPoint.Quit()',
    '}',
    '',
  ].join('\n');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  await access(pdfPath);
  return pdfPath;
}

export async function renderPptxPowerPoint(
  pptxPath: string,
  opts: { dpi: number; slides?: number[] },
): Promise<Map<number, Buffer>> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new DeckflipError('PowerPoint renderer requires macOS or Windows', 1);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'deckflip-pp-'));
  const pdfPath = process.platform === 'darwin' ? await renderOnMac(pptxPath) : await renderOnWindows(pptxPath, tempDir);
  try {
    const pdf = await readFile(pdfPath);
    const rasterOptions = opts.slides ? { dpi: opts.dpi, pages: opts.slides } : { dpi: opts.dpi };
    return rasterisePdf(new Uint8Array(pdf), rasterOptions);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (process.platform === 'darwin') {
      await rm(join(process.env.HOME ?? tmpdir(), 'Desktop', `deckflip-render-${process.pid}.pdf`), { force: true }).catch(() => {});
    }
  }
}
