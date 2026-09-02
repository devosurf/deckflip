import { describe, expect, it } from 'vitest';
import { CODE_FAMILIES, CODES, entry } from '../../src/report/codes.js';

describe('report codes', () => {
  it('defines every published code with metadata', () => {
    expect(CODE_FAMILIES).toEqual([
      'VALIDATE',
      'FONT',
      'RASTER',
      'FLATTEN',
      'SUBSTITUTE',
      'PRESERVE',
      'DROPPED',
      'OVERRIDE',
      'RENDER',
    ]);

    for (const code of Object.keys(CODES) as Array<keyof typeof CODES>) {
      const meta = CODES[code];
      expect(code).toMatch(/^[A-Z_]+$/);
      expect(meta.kind).toBeTruthy();
      expect(meta.severity).toBeTruthy();
      if (meta.severity !== 'error') {
        expect(meta.hint).toBeTruthy();
      }
    }
  });

  it('substitutes template tokens in reasons and hints', () => {
    const flattened = entry('FLATTEN_OFFCANVAS', {
      slide: 2,
      reason: 'element outside {W}x{H}',
      params: { W: '1280', H: '720', el: 'section.hero' },
    });
    expect(flattened.reason).toBe('element outside 1280x720');
    expect(flattened.hint).toContain('1280x720');
    expect(flattened.slide).toBe(2);

    const font = entry('FONT_GENERIC_ONLY', {
      reason: 'generic {generic} after {family}',
      params: { family: 'Arial', generic: 'sans-serif' },
    });
    expect(font.reason).toBe('generic sans-serif after Arial');
    expect(font.hint).toContain('sans-serif');
  });

  it('keeps every raster code paired with a flatten twin', () => {
    const rasterCodes = Object.keys(CODES).filter((code) => code.startsWith('RASTER_') && code !== 'RASTER_EXPLICIT');
    for (const code of rasterCodes) {
      const flattenCode = `FLATTEN_${code.slice('RASTER_'.length)}` as keyof typeof CODES;
      expect(CODES[flattenCode]).toBeDefined();
    }
  });
});
