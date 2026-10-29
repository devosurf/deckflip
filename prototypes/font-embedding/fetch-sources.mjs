// Downloads and verifies the pinned extra inputs listed in sources.json and
// creates the fontTools static instance (requires `fonttools` on PATH, see
// requirements.txt). Refuses any byte mismatch.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/sfnt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'sources');
mkdirSync(dir, { recursive: true });
const { downloads, derived } = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));

function verify(file, expected) {
  const actual = sha256(readFileSync(file));
  if (actual !== expected) throw new Error(`${file}: sha256 ${actual}, expected ${expected}`);
}

for (const { file, url, sha256: expected } of downloads) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  verify(path, expected);
  console.log(`ok ${file}`);
}

for (const { file, command, sha256: expected } of derived) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    const [bin, ...args] = command.split(' ');
    execFileSync(bin, args, { cwd: here, stdio: 'inherit' });
  }
  verify(path, expected);
  console.log(`ok ${file}`);
}
