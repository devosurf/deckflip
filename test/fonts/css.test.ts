import { expect, it } from 'vitest';
import { cssUrl, parseSrc, parseStretchRange, parseUnicodeRange, parseWeightRange, replaceRanges, scanStylesheet } from '../../src/fonts/css.js';
import { decodeDataUrl } from '../../src/fonts/sources.js';

it('finds @font-face rules at any depth, but not inside comments, strings or URLs', () => {
  const css = `@import url("a.css") screen; @import 'b.css';
    /* @font-face { font-family: Commented; src: url(c.ttf) } */
    .x::after { content: "@font-face { font-family: Quoted; src: url(q.ttf) }"; background: url(data:image/svg+xml;utf8,<svg>@font-face</svg>); }
    @media screen { @supports (display: grid) { @layer brand {
      @font-face { font-family: "Brand Text"; src: url("fonts/b.woff2") format("woff2"), local(Brand); font-weight: 100 900; }
    } } }
    @FONT-FACE{font-family:Plain;src:url(p.ttf)}`;
  const items = scanStylesheet(css);
  expect(items.map((item) => (item.kind === 'import' ? item.url : item.rule.descriptors.get('font-family')))).toEqual(['a.css', 'b.css', '"Brand Text"', 'Plain']);
  const edits = items.flatMap((item) => (item.kind === 'font-face' && item.rule.src ? [{ ...item.rule.src, value: 'url(x)' }] : []));
  expect(replaceRanges(css, edits)).toContain('@font-face { font-family: "Brand Text"; src: url(x); font-weight: 100 900; }');
  expect(replaceRanges(css, edits)).toContain('@FONT-FACE{font-family:Plain;src:url(x)}');
  const imports = items.flatMap((item) => item.kind === 'import' ? [{ ...item.target, value: cssUrl(`https://cdn.example/v3/${item.url}`) }] : []);
  expect(replaceRanges(css, imports)).toContain('@import url("https://cdn.example/v3/a.css") screen; @import url("https://cdn.example/v3/b.css");');
});

it('reads src entries in order with their format hints, quoted, unquoted or escaped', () => {
  expect(parseSrc(`local("Brand Bold"), url(fonts/b\\(1\\).woff2) format("woff2"), url('b.ttf') format(truetype, "opentype"), url( "c.otf" ), "ignored"`)).toEqual([
    { kind: 'local', name: 'Brand Bold' },
    { kind: 'url', url: 'fonts/b(1).woff2', formats: ['woff2'] },
    { kind: 'url', url: 'b.ttf', formats: ['truetype', 'opentype'] },
    { kind: 'url', url: 'c.otf', formats: [] },
  ]);
});

it('reads weight ranges and unicode ranges as CSS defines them', () => {
  expect(parseWeightRange('bold')).toEqual([700, 700]);
  expect(parseWeightRange('900 100')).toEqual([100, 900]);
  expect(parseWeightRange(undefined)).toEqual([400, 400]);
  expect(parseStretchRange(undefined)).toEqual([100, 100]);
  expect(parseStretchRange('condensed')).toEqual([75, 75]);
  expect(parseStretchRange('62.5% 87.5%')).toEqual([62.5, 87.5]);
  expect(parseStretchRange('expanded')).toEqual([125, 125]);
  expect(parseUnicodeRange('U+0000-00FF, u+0131, U+4??')).toEqual([[0, 0xff], [0x131, 0x131], [0x400, 0x4ff]]);
  expect(parseUnicodeRange(undefined)).toBeUndefined();
});

it('decodes data payload bytes without treating percent escapes as UTF-8 text', () => {
  expect(decodeDataUrl('data:font/ttf,%00%80%ffAé😀')).toEqual(Buffer.from([0, 128, 255, 65, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80]));
  expect(decodeDataUrl('data:font/ttf;base64,AA%2F%2F%20')).toEqual(Buffer.from([0, 15, 255]));
  expect(decodeDataUrl('data:font/ttf,%not-an-escape')).toEqual(Buffer.from('%not-an-escape'));
});
