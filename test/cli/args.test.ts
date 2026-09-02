import { describe, expect, it } from 'vitest';
import { parseEmbedFonts, parseSize, parseSlidesList } from '../../src/cli/main.js';

describe('CLI argument helpers', () => {
  it('parses embed-fonts forms', () => {
    expect(parseEmbedFonts(undefined)).toBe(false);
    expect(parseEmbedFonts(true)).toBe(true);
    expect(parseEmbedFonts('')).toBe(true);
    expect(parseEmbedFonts('Inter, Aptos')).toEqual(['Inter', 'Aptos']);
  });

  it('parses slide ranges', () => {
    expect(parseSlidesList('1,3-5')).toEqual([1, 3, 4, 5]);
  });

  it('parses size grammar', () => {
    expect(parseSize('16:9')).toEqual({ width: 1280, height: 720, source: 'flag' });
    expect(parseSize('4:3')).toEqual({ width: 960, height: 720, source: 'flag' });
    expect(parseSize('1024x768')).toEqual({ width: 1024, height: 768, source: 'flag' });
  });
});
