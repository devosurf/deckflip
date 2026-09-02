import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/index.js';
import { entry } from '../../src/report/codes.js';

describe('buildReport', () => {
  it('counts report kinds and validation errors', () => {
    const report = buildReport(
      {
        tool: { name: 'deckflip', version: '0.1.0' },
        command: 'convert',
        input: { path: 'deck.html', kind: 'html' },
        output: { path: 'deck.pptx', kind: 'pptx' },
        canvas: { width: 1280, height: 720, source: 'deck-meta' },
      },
      [
        entry('RASTER_CSS_FILTER', { slide: 1, reason: 'raster' }),
        entry('FLATTEN_ANIMATION', { slide: 1, reason: 'flatten' }),
        entry('SUBSTITUTE_OPACITY', { slide: 2, reason: 'substitute' }),
        entry('DROPPED_EXTENSION', { reason: 'drop' }),
        entry('PRESERVE_UNKNOWN_ID', { reason: 'preserve' }),
        entry('OVERRIDE_CANVAS_SIZE', { reason: 'override' }),
        entry('VALIDATE_ELEMENT', { slide: 3, reason: 'error' }),
      ],
      4,
      11,
    );

    expect(report.summary).toEqual({
      slides: 4,
      native: 11,
      rasterised: 1,
      flattened: 1,
      substituted: 1,
      dropped: 1,
      preserved: 1,
      overridden: 1,
      errors: 1,
    });
  });
});
