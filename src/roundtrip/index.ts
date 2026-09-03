// The way back's entry point (docs/spec/06-round-trip.md): find the Deck file's Asset directory, check the
// manifest against `source.pptx`, and plan what is spliced. A Deck that never came from a PPTX has no
// `data-shape-id` and gets nothing; one that did but lost its Asset directory is re-emitted from scratch
// with one `PRESERVE_SOURCE_MISSING` warning.

import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { PreservedSource } from '../emit/preserved.js';
import type { Deck, Element } from '../model/index.js';
import { OpcReader } from '../ooxml/opc.js';
import { entry as reportEntry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import type { HtmlNode } from './fingerprint.js';
import { MANIFEST_FILE, parseManifest, sha256, SOURCE_FILE } from './manifest.js';
import { planSplice } from './plan.js';
import { indexSource } from './source.js';

export interface RoundTrip {
  preserved?: PreservedSource;
  /** the source package, when the Deck is identical to it: the output as it stands */
  identical?: Uint8Array;
  entries: Entry[];
}

/** `<name>.assets/` next to the Deck file (spec 02). */
export function assetsDirFor(deckFile: string): string {
  return join(dirname(deckFile), `${basename(deckFile, extname(deckFile))}.assets`);
}

export async function resolveRoundTrip(deck: Deck, sections: HtmlNode[], deckFile: string | undefined): Promise<RoundTrip> {
  if (deckFile === undefined || !deck.slides.some((slide) => slide.elements.some(carriesShapeId))) {
    return { entries: [] };
  }
  const dir = assetsDirFor(deckFile);
  const missing = (reason: string): RoundTrip => ({ entries: [reportEntry('PRESERVE_SOURCE_MISSING', { reason, params: { dir: basename(dir) } })] });

  const manifestText = await readFile(join(dir, MANIFEST_FILE), 'utf8').catch(() => undefined);
  const manifest = manifestText === undefined ? undefined : parseManifest(manifestText);
  if (manifest === undefined) {
    return missing(`${basename(dir)}/${MANIFEST_FILE} is missing or unreadable`);
  }
  const bytes = await readFile(join(dir, SOURCE_FILE)).then((buffer) => new Uint8Array(buffer)).catch(() => undefined);
  if (bytes === undefined) {
    return missing(`${basename(dir)}/${SOURCE_FILE} is missing`);
  }
  if (sha256(bytes) !== manifest.source.sha256) {
    return missing(`${basename(dir)}/${SOURCE_FILE} is not the package the manifest was written for`);
  }

  const source = await indexSource(await OpcReader.load(bytes));
  const plan = planSplice(deck, sections, manifest, source);
  return { preserved: { source, plan }, ...(plan.identical ? { identical: bytes } : {}), entries: plan.entries };
}

function carriesShapeId(element: Element): boolean {
  return element.shapeId !== undefined || (element.kind === 'group' && element.children.some(carriesShapeId));
}
