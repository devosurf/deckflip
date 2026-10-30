import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import type { ResolvedFont } from '../../src/model/index.js';
import type { Report } from '../../src/report/types.js';
import { woff2FromSfnt } from '../fonts/fixture.js';

const run = promisify(execFile);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((done) => done())); });

/** The CLI, asynchronously: the font host below runs in this process. */
async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], { encoding: 'utf8', timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

it('reports where each hosted face came from in the Conversion report and inspect, never the URL credentials', async () => {
  const secret = 'k3y-do-not-log';
  const woff2 = await woff2FromSfnt(await readFile('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf'));
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (path === '/css') response.writeHead(200, { 'content-type': 'text/css' }).end("@font-face { font-family: Brand; font-weight: 500; src: url(/s/brand.woff2?sig=x) format('woff2'); }");
    else if (path === '/s/brand.woff2') response.writeHead(200, { 'content-type': 'font/woff2' }).end(woff2);
    else response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-cli-webfonts-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const deck = join(dir, 'deck.html');
  await writeFile(deck, `<!doctype html><html><head><link rel="stylesheet" href="${origin}/css?family=Brand&token=${secret}"></head>
    <body><section><p style="font-family: Brand, Arial; font-weight: 500">Hosted brand text</p></section></body></html>`);

  const converted = await cli(['convert', deck, '-o', join(dir, 'deck.pptx'), '--json', '--quiet', '--offline']);
  expect(converted.code, converted.stderr || converted.stdout).toBe(0);
  const report = JSON.parse(converted.stdout) as Report;
  const brand = report.fonts?.find((font) => font.cssFamily === 'Brand');
  expect(brand).toMatchObject({
    class: 'deck-provided', office: { family: 'Heebo Medium', style: 'regular' },
    asset: { source: { kind: 'remote', format: 'woff2', url: `${origin}/s/brand.woff2?…`, pinned: expect.stringMatching(/deck\.assets\/fonts\/[0-9a-f]{64}\.woff2$/) } },
  });

  const inspected = await cli(['inspect', deck]);
  expect(inspected.code, inspected.stderr).toBe(0);
  const { fonts } = JSON.parse(inspected.stdout) as { fonts: ResolvedFont[] };
  expect(fonts.find((font) => font.cssFamily === 'Brand')?.asset).toEqual(brand!.asset);

  const written = [converted.stdout, inspected.stdout, await readFile(`${join(dir, 'deck.pptx')}.report.json`, 'utf8'), await readFile(join(dir, 'deck.assets', 'fonts', 'sources.json'), 'utf8')];
  for (const text of written) expect(text).not.toContain(secret);
});
