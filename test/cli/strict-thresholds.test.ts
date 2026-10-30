import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Report } from '../../src/report/types.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-threshold-'));
  directories.push(dir);
  return dir;
}
function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args, '--no-color'], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, DECKFLIP_OFFLINE: '1' },
  });
  if (result.error) throw result.error;
  expect(result.signal, result.stderr).toBeNull();
  return result;
}
function icon(index: number): string {
  return `<svg id="icon${index}" width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="red"/></svg>`;
}

describe('CLI Strict mode thresholds', () => {
  it.each(['convert', 'validate'])('rejects invalid %s thresholds as invocation errors before reading input', (command) => {
    for (const value of ['verbose', '', 'Warning', 'false']) {
      const result = cli(command, 'absent.html', `--strict=${value}`, '--json');
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).not.toBe('');
      expect(result.stdout).toBe('');
    }
  });

  it.each(['convert', 'validate'])('keeps bare --strict from consuming the %s input positional', async (command) => {
    const dir = await workspace();
    const input = join(dir, 'invalid.html');
    await writeFile(input, '<!doctype html><html><body><section><iframe></iframe></section></body></html>');
    const bareFirst = cli(command, '--strict', input, '--json', '--quiet');
    expect(bareFirst.status, bareFirst.stderr).toBe(2);
    expect(JSON.parse(bareFirst.stdout).entries).toContainEqual(expect.objectContaining({ code: 'VALIDATE_ELEMENT' }));
    const spaced = cli(command, input, '--strict', 'warning');
    expect(spaced.status, spaced.stderr).toBe(3);
  });

  it.skipIf(!browserAvailable)('keeps info entries and conversion output while applying the selected threshold in convert and validate', async () => {
    const dir = await workspace();
    const input = join(dir, 'info.html');
    await writeFile(input, `<!doctype html><html><body><section>${icon(1)}</section></body></html>`);
    const modes = [
      { flag: '--strict', exit: 4 }, { flag: '--strict=info', exit: 4 },
      { flag: '--strict=warning', exit: 0 }, { flag: '--strict=error', exit: 0 },
    ];
    for (const { flag, exit } of modes) {
      const output = join(dir, `${flag.slice(2)}.pptx`);
      const converted = cli('convert', input, '-o', output, flag, '--json', '--quiet');
      expect(converted.status, converted.stderr).toBe(exit);
      expect(converted.stderr).toBe('');
      expect((await stat(output)).size).toBeGreaterThan(0);
      const report: Report = JSON.parse(converted.stdout);
      expect(report.entries).toEqual([expect.objectContaining({ code: 'SUBSTITUTE_SVG_PICTURE', severity: 'info' })]);
      expect(JSON.parse(await readFile(`${output}.report.json`, 'utf8'))).toEqual(report);
      const validated = cli('validate', input, flag, '--json', '--quiet');
      expect(validated.status, validated.stderr).toBe(exit);
      expect(JSON.parse(validated.stdout).entries).toEqual(report.entries);
    }
  });

  it.skipIf(!browserAvailable)('groups repeated codes by severity with bounded locations and distinct hints while JSON keeps each occurrence', async () => {
    const dir = await workspace();
    const input = join(dir, 'repeated.html');
    await writeFile(input, `<!doctype html><html><head><style>body { font: 20px/28px Arial } p { margin: 0 }</style></head><body>
      <section>${Array.from({ length: 6 }, (_, index) => icon(index + 1)).join('')}
      <p id="effect1" style="filter: blur(1px)">First</p>
      <p id="effect2" style="filter: blur(1px)">Second</p>
      <p id="effect3" style="filter: blur(2px)">Third</p></section></body></html>`);
    const result = cli('validate', input, '--strict=warning', '--json');
    expect(result.status, result.stderr).toBe(4);
    const report: Report = JSON.parse(result.stdout);
    const infos = report.entries.filter((entry) => entry.code === 'SUBSTITUTE_SVG_PICTURE');
    const warnings = report.entries.filter((entry) => entry.code === 'FLATTEN_CSS_FILTER');
    expect(infos).toHaveLength(6);
    expect(warnings).toHaveLength(3);
    expect(JSON.parse(await readFile(join(dir, 'repeated.report.json'), 'utf8'))).toEqual(report);
    const lines = result.stderr.split('\n').filter((line) => line.startsWith('['));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[warning\] FLATTEN_CSS_FILTER \(3 occurrences\)/);
    expect(lines[1]).toContain('[info] SUBSTITUTE_SVG_PICTURE (6 occurrences): slide 1 <#icon1>, slide 1 <#icon2>, slide 1 <#icon3>, +3 more');
    expect(lines[1]).not.toContain('#icon4');
    for (const hint of new Set(report.entries.map((entry) => entry.hint))) {
      if (hint !== undefined) expect(result.stderr.split(hint)).toHaveLength(2);
    }
    const quiet = cli('validate', input, '--json', '--quiet');
    expect(quiet.stderr).toBe('');
    expect(JSON.parse(quiet.stdout).entries).toEqual(report.entries);
    const human = cli('validate', input);
    expect(human.stdout).toBe('');
    expect(human.stderr).toBe(result.stderr);
  });

  it.skipIf(!browserAvailable)('keeps Verification exit 5 above every strict threshold and preserves the written output', async () => {
    const dir = await workspace();
    const input = join(dir, 'lost.html');
    await writeFile(input, `<!doctype html><html><head><style>
      body { font: 20px/28px Arial } .ghost { visibility: hidden } #shown { visibility: visible }
      </style></head><body><section><p>Kept text</p><div class="ghost"><p id="shown">LOST_SENTINEL</p></div></section></body></html>`);
    const output = join(dir, 'lost.pptx');
    const result = cli('convert', input, '-o', output, '--strict=error', '--json', '--quiet');
    expect(result.status, result.stderr).toBe(5);
    const report: Report = JSON.parse(result.stdout);
    expect(report.entries).toContainEqual(expect.objectContaining({ code: 'VERIFY_TEXT_MISSING', severity: 'error' }));
    expect((await stat(output)).size).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(`${output}.report.json`, 'utf8'))).toEqual(report);
  });
});
