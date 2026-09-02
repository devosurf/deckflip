import { describe, expect, it } from 'vitest';
import { parseEmbedFonts, parseRasterDpi, parseSize, parseSlidesList } from '../../src/cli/main.js';

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

  it('accepts raster DPI between 96 and 384 only', () => {
    expect(parseRasterDpi('192')).toBe(192);
    expect(parseRasterDpi('96')).toBe(96);
    expect(parseRasterDpi('384')).toBe(384);
    expect(() => parseRasterDpi('72')).toThrow(/96/);
    expect(() => parseRasterDpi('400')).toThrow(/384/);
    expect(() => parseRasterDpi('2x')).toThrow();
  });
});
