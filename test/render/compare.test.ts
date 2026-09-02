import { createCanvas } from '@napi-rs/canvas';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { comparePng } from '../../src/render/compare.js';

async function writeSolidPng(path: string, color: string): Promise<void> {
  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 32, 32);
  await writeFile(path, canvas.toBuffer('image/png'));
}

it('reports a perfect match for identical images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-compare-'));
  const left = join(dir, 'left.png');
  const right = join(dir, 'right.png');
  await writeSolidPng(left, '#f00');
  await writeSolidPng(right, '#f00');
  await expect(comparePng(left, right, {})).resolves.toEqual({ match: true, diffPercentage: 0 });
});

it('reports a non-zero diff for different images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-compare-'));
  const left = join(dir, 'left.png');
  const right = join(dir, 'right.png');
  await writeSolidPng(left, '#f00');
  await writeSolidPng(right, '#00f');
  const result = await comparePng(left, right, {});
  expect(result.match).toBe(false);
  expect(result.diffPercentage).toBeGreaterThan(0);
});
