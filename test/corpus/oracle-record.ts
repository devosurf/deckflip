import { createHash } from 'node:crypto';
import JSZip from 'jszip';

/**
 * `expected/oracle.json` (spec 10 "PowerPoint oracle"): which emitted package the committed PowerPoint renders
 * were made from. Output is deterministic, so a corpus fixture whose package still has this digest is still
 * the deck PowerPoint was seen to render; any other digest needs `npm run corpus:oracle` again.
 */
export interface OracleRecord {
  /** `packageDigest` of the PPTX the renders came from */
  digest: string;
  /** PowerPoint's `CFBundleShortVersionString` on the oracle machine */
  powerpoint: string;
  /** the deckflip version that emitted the package */
  deckflip: string;
}

export const ORACLE_RECORD = 'oracle.json';

/**
 * SHA-256 over the parts PowerPoint interprets, by name. `docProps/` (timestamps, app version) is left out, and
 * so are media bytes: rasters are Chromium's own paint, already the other side of the image gate, and their
 * content-hash names are reduced to the extension where relationships point at them.
 */
export async function packageDigest(pptx: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(pptx);
  const hash = createHash('sha256');
  const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir && !name.startsWith('docProps/') && !name.startsWith('ppt/media/')).sort();
  for (const name of names) {
    let content = await zip.file(name)!.async('string');
    if (name.endsWith('.rels')) content = content.replace(/Target="\.\.\/media\/[^"]*?(\.[a-z0-9]+)"/g, 'Target="../media/*$1"');
    hash.update(name).update('\u0000').update(content).update('\u0000');
  }
  return hash.digest('hex');
}
