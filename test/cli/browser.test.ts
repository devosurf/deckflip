import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPptx } from '../render/pptx-fixture.js';

const managedBrowser = chromium.executablePath();
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-browser-'));
  directories.push(dir);
  const cache = join(dir, 'empty browser cache');
  await mkdir(cache);
  const input = join(dir, 'deck.html');
  await writeFile(input, '<!doctype html><html><body><section><p id="sentinel">Browser selection sentinel</p></section></body></html>');
  return { dir, cache, input };
}

function cli(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, CI: '', DECKFLIP_BROWSER: '', DECKFLIP_OFFLINE: '', ...env },
  });
  if (result.error) throw result.error;
  expect(result.signal, result.stderr).toBeNull();
  return result;
}

function expectHtmlSnapshot(result: { status: number | null; stdout: string; stderr: string }) {
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).slides[0].elements).toContainEqual(expect.objectContaining({
    kind: 'text', source: 'native', text: 'Browser selection sentinel',
  }));
  expect(result.stderr).not.toContain('installing with:');
}

describe('inspect browser selection at the CLI seam', () => {
  it.skipIf(!existsSync(managedBrowser))('uses --browser ahead of DECKFLIP_BROWSER with no managed browser available', async () => {
    const { dir, cache, input } = await workspace();
    expectHtmlSnapshot(cli(['inspect', input, '--browser', managedBrowser, '--offline'], {
      PLAYWRIGHT_BROWSERS_PATH: cache, DECKFLIP_BROWSER: join(dir, 'missing-env-browser'),
    }));
    expect(await readdir(cache)).toEqual([]);
  });

  it.skipIf(!existsSync(managedBrowser))('uses DECKFLIP_BROWSER ahead of a missing managed browser', async () => {
    const { cache, input } = await workspace();
    expectHtmlSnapshot(cli(['inspect', input, '--offline'], {
      PLAYWRIGHT_BROWSERS_PATH: cache, DECKFLIP_BROWSER: managedBrowser,
    }));
    expect(await readdir(cache)).toEqual([]);
  });

  it.skipIf(!existsSync(managedBrowser))('uses the managed browser when neither override is set', async () => {
    const { input } = await workspace();
    expectHtmlSnapshot(cli(['inspect', input, '--offline'], {}));
  });

  it.skipIf(!existsSync(managedBrowser))('does not fall back from an invalid explicit browser to the environment or managed browser', async () => {
    const { dir, input } = await workspace();
    const missing = join(dir, 'missing-explicit-browser');
    const result = cli(['inspect', input, '--browser', missing, '--offline'], { DECKFLIP_BROWSER: managedBrowser });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(missing);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('installing with:');
  });

  it.skipIf(!existsSync(managedBrowser))('does not fall back from an invalid environment browser to the managed browser', async () => {
    const { dir, input } = await workspace();
    const missing = join(dir, 'missing-env-browser');
    const result = cli(['inspect', input, '--offline'], { DECKFLIP_BROWSER: missing });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(missing);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('installing with:');
  });

  it.each([
    { name: '--offline', flags: ['--offline'], env: {} },
    { name: 'DECKFLIP_OFFLINE=1', flags: [], env: { DECKFLIP_OFFLINE: '1' } },
    { name: 'CI=true', flags: [], env: { CI: 'true' } },
  ])('fails without downloading under $name when the managed browser is missing', async ({ flags, env }) => {
    const { cache, input } = await workspace();
    const result = cli(['inspect', input, ...flags], { PLAYWRIGHT_BROWSERS_PATH: cache, ...env });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/^Chromium is not installed\. Run .+ install chromium\.\n$/);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('installing with:');
    expect(await readdir(cache)).toEqual([]);
  });

  it('inspects PPTX without requiring any browser, even with invalid explicit and environment overrides', async () => {
    const { dir, cache } = await workspace();
    const input = join(dir, 'deck.pptx');
    await writeFile(input, await buildPptx({ slides: [{ name: 'Browser-independent Slide' }] }));
    const result = cli(['inspect', input, '--browser', join(dir, 'missing-explicit-browser'), '--offline'], {
      PLAYWRIGHT_BROWSERS_PATH: cache, DECKFLIP_BROWSER: join(dir, 'missing-env-browser'), CI: 'true',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).slides).toEqual([
      expect.objectContaining({ index: 1, name: 'Browser-independent Slide', elements: [] }),
    ]);
    expect(result.stderr).toBe('');
    expect(await readdir(cache)).toEqual([]);
  });
});
