// `p:notes` -> `Slide.notes` (docs/spec/06-round-trip.md "Speaker notes"): the text of the notes page's body
// placeholder, which is what PowerPoint's notes pane edits. The slide thumbnail, header, footer, date and
// slide-number placeholders beside it carry nothing the IDM holds.

import type { TextBody } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readTextBody, type TextContext } from './text.js';
import { child, children } from './xml.js';

export function readNotes(notes: XmlNode, ctx: TextContext): TextBody | undefined {
  const spTree = child(child(notes, 'p:cSld'), 'p:spTree');
  for (const sp of children(spTree, 'p:sp')) {
    const ph = child(child(child(sp, 'p:nvSpPr'), 'p:nvPr'), 'p:ph');
    if (ph?.attrs.type !== 'body') {
      continue;
    }
    const text = readTextBody(child(sp, 'p:txBody'), ctx);
    // PowerPoint leaves an empty notes slide behind as soon as the notes pane is opened: that is no notes
    return text?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.kind === 'text' && run.text !== '')) ? text : undefined;
  }
  return undefined;
}
