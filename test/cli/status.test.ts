import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Report } from '../../src/report/types.js';
import { buildPptx } from '../render/pptx-fixture.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-status-'));
  directories.push(dir);
  return dir;
}

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args, '--quiet'], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, DECKFLIP_OFFLINE: '1' },
  });
  if (result.error) throw result.error;
  expect(result.signal, result.stderr).toBeNull();
  return result;
}

async function reportAt(path: string): Promise<Report> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function missingFontPptx(dir: string): Promise<string> {
  const input = join(dir, 'missing-font.pptx');
  await writeFile(input, await buildPptx({ slides: [{ shapes: `<p:sp>
    <p:nvSpPr><p:cNvPr id="2" name="Missing font"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"><a:latin typeface="DeckflipMissingFontSynthetic987654"/></a:rPr><a:t>Sentinel</a:t></a:r></a:p></p:txBody>
    </p:sp>` }] }));
  return input;
}

describe('CLI severity and strict-mode status', () => {
  it('rejects missing-font PPTX conversion before creating a Deck or Asset directory, even in strict mode', async () => {
    const dir = await workspace();
    const input = await missingFontPptx(dir);
    for (const flags of [[], ['--strict']]) {
      const output = join(dir, flags.length ? 'strict.html' : 'ordinary.html');
      const result = cli('convert', input, '-o', output, '--json', ...flags);
      const report = await reportAt(`${output}.report.json`);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED', severity: 'error' }));
      expect(JSON.parse(result.stdout)).toEqual(report);
      expect(result.status).toBe(2);
      await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(output.replace(/\.html$/, '.assets'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('leaves an existing destination Deck and Asset directory byte-for-byte unchanged on validation failure', async () => {
    const dir = await workspace();
    const input = await missingFontPptx(dir);
    const output = join(dir, 'existing.html');
    const assets = join(dir, 'existing.assets');
    await writeFile(output, 'Existing Deck');
    await mkdir(join(assets, 'media'), { recursive: true });
    const originals = {
      'source.pptx': Buffer.from('Original source'),
      'deckflip.json': Buffer.from('Original Manifest'),
      'media/image.png': Buffer.from([1, 2, 3, 4]),
    };
    for (const [name, bytes] of Object.entries(originals)) await writeFile(join(assets, name), bytes);
    for (const flags of [[], ['--strict']]) {
      expect(cli('convert', input, '-o', output, ...flags).status).toBe(2);
      expect(await readFile(output, 'utf8')).toBe('Existing Deck');
      expect((await readdir(assets, { recursive: true })).sort()).toEqual(['deckflip.json', 'media', 'media/image.png', 'source.pptx']);
      for (const [name, bytes] of Object.entries(originals)) expect(await readFile(join(assets, name))).toEqual(bytes);
      expect((await reportAt(`${output}.report.json`)).entries).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED', severity: 'error' }));
    }
  });

  it('gives validation errors precedence over strict mode for both input kinds', async () => {
    const dir = await workspace();
    const pptx = await missingFontPptx(dir);
    const html = join(dir, 'invalid.html');
    await writeFile(html, '<!doctype html><html><body><section><iframe></iframe></section></body></html>');
    for (const [input, code] of [[pptx, 'FONT_UNRESOLVED'], [html, 'VALIDATE_ELEMENT']] as const) {
      for (const flags of [[], ['--strict']]) {
        const result = cli('validate', input, '--json', ...flags);
        expect(JSON.parse(result.stdout).entries).toContainEqual(expect.objectContaining({ code, severity: 'error' }));
        expect(result.status).toBe(2);
        expect(await reportAt(input.replace(/\.(pptx|html)$/, '.report.json'))).toEqual(JSON.parse(result.stdout));
      }
    }
  });

  it('retains the converted Deck, source assets and report when strict mode rejects nonfatal PPTX entries', async () => {
    const dir = await workspace();
    const input = join(dir, 'source.pptx');
    const source = await buildPptx();
    await writeFile(input, source);
    for (const [flags, expected] of [[[], 0], [['--strict'], 4]] as const) {
      const output = join(dir, expected === 4 ? 'strict.html' : 'ordinary.html');
      const result = cli('convert', input, '-o', output, '--json', ...flags);
      const report = await reportAt(`${output}.report.json`);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'PRESERVE_OPAQUE_MASTER', severity: 'info' }));
      expect(report.summary.errors).toBe(0);
      expect(result.status).toBe(expected);
      expect(JSON.parse(result.stdout)).toEqual(report);
      expect(await readFile(output, 'utf8')).toContain('<section');
      const assets = output.replace(/\.html$/, '.assets');
      expect(await readFile(join(assets, 'source.pptx'))).toEqual(source);
      expect(JSON.parse(await readFile(join(assets, 'deckflip.json'), 'utf8')).slides).toHaveLength(1);
    }
  });

  it('returns 4 only in strict validation for a nonfatal PPTX report', async () => {
    const dir = await workspace();
    const input = join(dir, 'source.pptx');
    await writeFile(input, await buildPptx());
    for (const [flags, expected] of [[[], 0], [['--strict'], 4]] as const) {
      const result = cli('validate', input, '--json', ...flags);
      expect(result.status).toBe(expected);
      const report = await reportAt(join(dir, 'source.report.json'));
      expect(JSON.parse(result.stdout)).toEqual(report);
      expect(report.summary.errors).toBe(0);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'PRESERVE_OPAQUE_MASTER', severity: 'info' }));
    }
  });

  it.skipIf(!browserAvailable)('keeps the converted Deck and Conversion report for warning and info entries while strict conversion and validation exit 4', async () => {
    const dir = await workspace();
    const input = join(dir, 'effects.html');
    await writeFile(input, `<!doctype html><html><head><style>body { font-family: Arial }</style></head><body>
      <section><p style="filter: blur(1px)">Editable</p><div data-raster style="width: 20px; height: 20px; background: red"></div></section>
      </body></html>`);
    for (const [flags, expected] of [[[], 0], [['--strict'], 4]] as const) {
      const mode = flags.length ? 'strict' : 'ordinary';
      const output = join(dir, `${mode}.pptx`);
      const destination = join(dir, mode, 'reports', 'conversion.json');
      const converted = cli('convert', input, '-o', output, '--report', destination, '--json', ...flags);
      const report = await reportAt(destination);
      await expect(stat(`${output}.report.json`)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(report.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'FLATTEN_CSS_FILTER', severity: 'warning' }),
        expect.objectContaining({ code: 'RASTER_EXPLICIT', severity: 'info' }),
      ]));
      expect(report.summary.errors).toBe(0);
      expect(converted.status, converted.stderr).toBe(expected);
      expect(JSON.parse(converted.stdout)).toEqual(report);
      expect((await readFile(output)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      const validated = cli('validate', input, '--json', ...flags);
      expect(validated.status, validated.stderr).toBe(expected);
      expect(JSON.parse(validated.stdout).entries).toEqual(report.entries);
    }
  });

  it.skipIf(!browserAvailable)('returns 0 for clean HTML conversion and validation even in strict mode', async () => {
    const dir = await workspace();
    const input = join(dir, 'clean.html');
    await writeFile(input, '<!doctype html><html><body><section></section></body></html>');
    for (const flags of [[], ['--strict']]) {
      const mode = flags.length ? 'strict' : 'ordinary';
      const output = join(dir, `${mode}.pptx`);
      const destination = join(dir, mode, 'reports', 'conversion.json');
      const converted = cli('convert', input, '-o', output, '--report', destination, '--json', ...flags);
      expect(converted.status, converted.stderr).toBe(0);
      expect(JSON.parse(converted.stdout).entries).toEqual([]);
      expect(await reportAt(destination)).toEqual(JSON.parse(converted.stdout));
      await expect(stat(`${output}.report.json`)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readFile(output)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      const validated = cli('validate', input, '--json', ...flags);
      expect(validated.status, validated.stderr).toBe(0);
      expect(JSON.parse(validated.stdout).entries).toEqual([]);
    }
  });

  it('rejects HTML conversion without creating or replacing the destination, including strict mode', async () => {
    const dir = await workspace();
    const input = join(dir, 'invalid.html');
    await writeFile(input, '<!doctype html><html><body><section><iframe></iframe></section></body></html>');
    for (const flags of [[], ['--strict']]) {
      const output = join(dir, flags.length ? 'strict.pptx' : 'ordinary.pptx');
      const destination = join(dir, flags.length ? 'strict' : 'ordinary', 'reports', 'conversion.json');
      const converted = cli('convert', input, '-o', output, '--report', destination, '--json', ...flags);
      expect(converted.status, converted.stderr).toBe(2);
      const report = await reportAt(destination);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'VALIDATE_ELEMENT', severity: 'error' }));
      expect(JSON.parse(converted.stdout)).toEqual(report);
      await expect(stat(`${output}.report.json`)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(output, 'Existing Deck');
      expect(cli('convert', input, '-o', output, ...flags).status).toBe(2);
      expect(await readFile(output, 'utf8')).toBe('Existing Deck');
      expect((await reportAt(`${output}.report.json`)).entries).toContainEqual(expect.objectContaining({ code: 'VALIDATE_ELEMENT', severity: 'error' }));
    }
  });

  it('keeps unreadable and malformed PPTX failures at exit 1 rather than validation or strict failures', async () => {
    const dir = await workspace();
    const missing = join(dir, 'absent.pptx');
    const malformed = join(dir, 'malformed.pptx');
    await writeFile(malformed, 'Not a ZIP package');
    for (const input of [missing, malformed]) {
      for (const command of ['convert', 'validate']) {
        for (const flags of [[], ['--strict']]) {
          const result = cli(command, input, ...flags);
          expect(result.status, result.stderr).toBe(1);
          expect(result.stdout).toBe('');
        }
      }
    }
    expect((await readdir(dir)).sort()).toEqual(['malformed.pptx']);
  });
});

describe('CLI conversion report destinations', () => {
  it('writes the missing-font Conversion report to the requested nested destination in ordinary and strict mode', async () => {
    const dir = await workspace();
    const input = await missingFontPptx(dir);
    for (const flags of [[], ['--strict']]) {
      const mode = flags.length ? 'strict' : 'ordinary';
      const output = join(dir, `${mode}.html`);
      const destination = join(dir, mode, 'reports', 'conversion.json');
      const result = cli('convert', input, '-o', output, '--report', destination, '--json', ...flags);
      expect(result.status, result.stderr).toBe(2);
      const report = await reportAt(destination);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED', severity: 'error' }));
      expect(JSON.parse(result.stdout)).toEqual(report);
      await expect(stat(`${output}.report.json`)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('selects the requested report for successful PPTX conversion and strict nonfatal failure', async () => {
    const dir = await workspace();
    const input = join(dir, 'source.pptx');
    await writeFile(input, await buildPptx());
    for (const [flags, expected] of [[[], 0], [['--strict'], 4]] as const) {
      const mode = flags.length ? 'strict' : 'ordinary';
      const output = join(dir, `${mode}.html`);
      const destination = join(dir, mode, 'reports', 'conversion.json');
      const result = cli('convert', input, '-o', output, '--report', destination, '--json', ...flags);
      expect(result.status, result.stderr).toBe(expected);
      const report = await reportAt(destination);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'PRESERVE_OPAQUE_MASTER', severity: 'info' }));
      expect(report.summary.errors).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(report);
      await expect(stat(`${output}.report.json`)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
