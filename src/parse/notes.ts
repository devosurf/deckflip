// `p:notes` -> `Slide.notes` (docs/spec/06-round-trip.md "Speaker notes"): the text of the notes page's body
// placeholder, which is what PowerPoint's notes pane edits. The slide thumbnail, header, footer, date and
// slide-number placeholders beside it carry nothing the IDM holds.

import type { TextBody } from '../model/index.js';
import { hasTextParagraphs } from '../model/notes.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readPlaceholder } from './drawing.js';
import { readTextBody, type TextContext } from './text.js';
import { child, children } from './xml.js';

export function readNotes(notes: XmlNode, ctx: TextContext): TextBody | undefined {
  const spTree = child(child(notes, 'p:cSld'), 'p:spTree');
  for (const sp of children(spTree, 'p:sp')) {
    const placeholder = readPlaceholder(child(sp, 'p:nvSpPr'));
    if (placeholder === undefined) {
      continue;
    }
    const type = placeholder.split(':', 2)[0];
    if (type !== 'body') {
      continue;
    }
    const text = readTextBody(child(sp, 'p:txBody'), ctx);
    // PowerPoint leaves an empty notes slide behind as soon as the notes pane is opened: that is no notes
    return text !== undefined && hasTextParagraphs(text.paragraphs) ? text : undefined;
  }
  return undefined;
}
