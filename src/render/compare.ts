import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export interface IgnoreRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ODiffResult {
  match: boolean;
  diffPercentage?: number;
}

type ODiffCompare = (base: string, compare: string, diffOutput?: string, options?: Record<string, unknown>) => Promise<ODiffResult>;

async function loadCompare(): Promise<ODiffCompare> {
  const imported: unknown = await import('odiff-bin'); // lazy import by design: dev-only binary binding is loaded only when comparing images
  const mod = imported as { compare?: unknown; default?: { compare?: unknown } };
  const compare = mod.compare ?? mod.default?.compare;
  if (typeof compare !== 'function') {
    throw new Error('odiff-bin compare export not found');
  }
  return compare as ODiffCompare;
}

export async function comparePng(
  expected: string,
  actual: string,
  opts: { diffOutput?: string; ignoreRegions?: IgnoreRegion[] },
): Promise<{ match: boolean; diffPercentage: number }> {
  const compare = await loadCompare();
  const tempDir = opts.diffOutput ? undefined : await mkdtemp(join(tmpdir(), 'deckflip-odiff-'));
  const diffOutput = opts.diffOutput ?? join(tempDir!, 'diff.png');
  if (opts.diffOutput) {
    await mkdir(dirname(diffOutput), { recursive: true });
  }

  try {
    const options: Record<string, unknown> = { threshold: 0.1, antialiasing: true };
    if (opts.ignoreRegions?.length) {
      options.ignoreRegions = opts.ignoreRegions;
    }
    const result = await compare(expected, actual, diffOutput, options);
    return { match: result.match, diffPercentage: result.match ? 0 : (result.diffPercentage ?? 0) };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
