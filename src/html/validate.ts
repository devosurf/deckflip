// Static checks on Deck source (docs/spec/03-authoring-subset.md "Rejected by validate"): they run before any
// document is opened in Chromium, so a rejected `script` never executes. Measured checks live in browser-script.ts.

import { entry } from '../report/codes.js';
import type { Entry } from '../report/types.js';

/** `VALIDATE_ELEMENT`: elements that are interactive, scripted, or otherwise not static HTML. */
const REJECTED_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'canvas',
  'input',
  'button',
  'select',
  'textarea',
  'details',
  'summary',
  'dialog',
  'marquee',
]);

/**
 * Static entries for one piece of Deck markup, in source order: `VALIDATE_ELEMENT` per rejected open tag,
 * `VALIDATE_RASTER_SLIDE` per `section[data-raster]`. `slide` is omitted for deck-level markup (a shared `<head>`).
 */
export function staticEntries(html: string, slide?: number): Entry[] {
  const entries: Entry[] = [];
  const at = slide === undefined ? {} : { slide };
  for (const tag of openTags(html)) {
    const name = elementName(tag);
    if (REJECTED_ELEMENTS.has(tag.name)) {
      entries.push(entry('VALIDATE_ELEMENT', { ...at, locator: { selector: name }, reason: `${name} is not static HTML`, params: { el: name } }));
    } else if (tag.name === 'section' && hasAttr(tag.attrs, 'data-raster')) {
      entries.push(entry('VALIDATE_RASTER_SLIDE', { ...at, locator: { selector: name }, reason: `data-raster on ${name} would rasterise the whole Slide` }));
    }
  }
  return entries;
}

interface OpenTag {
  name: string;
  attrs: string;
}

/** Open tags outside comments; `script`/`style` bodies are opaque text and are skipped. */
function* openTags(html: string): Generator<OpenTag> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      return;
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const match = html.slice(lt).match(/^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/);
    if (!match) {
      i = lt + 1;
      continue;
    }
    const name = match[1]!.toLowerCase();
    yield { name, attrs: match[2]! };
    i = lt + match[0].length;
    if (name === 'script' || name === 'style') {
      const close = html.slice(i).search(new RegExp(`</${name}\\s*>`, 'i'));
      i = close === -1 ? html.length : i + close;
    }
  }
}

/** `tag#id`, else `tag.first-class`, else `tag`: the same shape browser-script.ts uses for element names. */
function elementName(tag: OpenTag): string {
  const id = attr(tag.attrs, 'id');
  if (id) {
    return `${tag.name}#${id}`;
  }
  const className = attr(tag.attrs, 'class')?.trim().split(/\s+/)[0];
  return className ? `${tag.name}.${className}` : tag.name;
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] || match?.[2] || match?.[3] || undefined;
}

function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i').test(attrs);
}
