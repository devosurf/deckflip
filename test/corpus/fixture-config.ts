import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface FixtureConfig {
  embedFonts: boolean;
}

/** Gate and oracle generation must use the same opt-in; existing fixtures keep their package digests. */
export async function readFixtureConfig(fixtureDir: string): Promise<FixtureConfig> {
  const json = await readFile(join(fixtureDir, 'fixture.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const config: Partial<FixtureConfig> = json === undefined ? {} : JSON.parse(json);
  return { embedFonts: config.embedFonts ?? false };
}
