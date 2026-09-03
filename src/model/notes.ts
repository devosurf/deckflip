import type { Paragraph } from './index.js';

/** Speaker notes with no text are no notes (docs/spec/06-round-trip.md "Speaker notes"): parse/ and html/ share the IDM seam, so the predicate lives here. */
export function hasTextParagraphs(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.some((paragraph) => paragraph.runs.some((run) => run.kind === 'text' && run.text !== ''));
}
