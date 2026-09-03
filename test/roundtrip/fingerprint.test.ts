import { describe, expect, it } from 'vitest';
import { fingerprint, parseHtml, type HtmlNode } from '../../src/roundtrip/fingerprint.js';

function first(html: string): HtmlNode {
  const node = parseHtml(html).find((child): child is HtmlNode => typeof child !== 'string');
  if (!node) throw new Error(`no element in ${html}`);
  return node;
}

const fp = (html: string): string => fingerprint(first(html));

describe('fingerprint', () => {
  const base = '<div class="t1" style="left: 10px; top: 20px; color: red" data-shape-id="1-2"><p>Hello <span class="t2">world</span></p><p>Again</p></div>';

  it('is a SHA-256 hex digest', () => {
    expect(fp(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores attribute order, style declaration order and whitespace between blocks', () => {
    const reformatted = [
      '<div style="top:20px;color:red;left:10px" data-shape-id="1-2" class="t1">',
      '  <p>Hello <span class="t2">world</span></p>',
      '  <p>',
      '    Again',
      '  </p>',
      '</div>',
    ].join('\n');
    expect(fp(reformatted)).toBe(fp(base));
  });

  it('ignores data-shape-id, data-preserve and data-placeholder', () => {
    expect(fp(base.replace('data-shape-id="1-2"', 'data-shape-id="7-9" data-preserve data-placeholder="title"'))).toBe(fp(base));
    expect(fp(base.replace(' data-shape-id="1-2"', ''))).toBe(fp(base));
  });

  it('changes when text, a style value, a class or an attribute changes', () => {
    expect(fp(base.replace('Hello', 'Hallo'))).not.toBe(fp(base));
    expect(fp(base.replace('left: 10px', 'left: 11px'))).not.toBe(fp(base));
    expect(fp(base.replace('class="t2"', 'class="t3"'))).not.toBe(fp(base));
    expect(fp(base.replace('<div ', '<div hidden '))).not.toBe(fp(base));
    expect(fp(base.replace('<p>Again</p>', ''))).not.toBe(fp(base));
  });

  it('keeps whitespace that renders: between inline runs and inside pre', () => {
    expect(fp('<p><span>a</span> <span>b</span></p>')).not.toBe(fp('<p><span>a</span><span>b</span></p>'));
    expect(fp('<p><span>a</span>\n  <span>b</span></p>')).toBe(fp('<p><span>a</span> <span>b</span></p>'));
    expect(fp('<p>a<br>\n  b</p>')).toBe(fp('<p>a<br>b</p>'));
    expect(fp('<pre>a\n  b</pre>')).not.toBe(fp('<pre>a b</pre>'));
    expect(fp('<pre>a\n  b</pre>')).toBe(fp('<pre>a\n  b</pre>'));
  });

  it('distinguishes tag, nesting and a decoded entity from its literal', () => {
    expect(fp('<div><p>x</p></div>')).not.toBe(fp('<div><span>x</span></div>'));
    expect(fp('<p>&lt;b&gt;</p>')).toBe(fp('<p>&#60;b&#x3e;</p>'));
    expect(fp('<p>&lt;b&gt;</p>')).not.toBe(fp('<p><b></b></p>'));
  });
});

describe('parseHtml', () => {
  it('parses the emitted dialect as the browser does: void elements, entities, svg self-closing, pre newline', () => {
    const tree = parseHtml('<div title="a &amp; &quot;b&quot;">x<br>y<img src="m.png"><svg viewBox="0 0 1 1"><path d="M0 0"/><g></g></svg><pre>\nkeep</pre></div>');
    expect(tree).toEqual([
      {
        tag: 'div',
        attrs: { title: 'a & "b"' },
        children: [
          'x',
          { tag: 'br', attrs: {}, children: [] },
          'y',
          { tag: 'img', attrs: { src: 'm.png' }, children: [] },
          {
            tag: 'svg',
            attrs: { viewBox: '0 0 1 1' },
            children: [
              { tag: 'path', attrs: { d: 'M0 0' }, children: [] },
              { tag: 'g', attrs: {}, children: [] },
            ],
          },
          { tag: 'pre', attrs: {}, children: ['keep'] },
        ],
      },
    ]);
  });

  it('lowercases html tag and attribute names, keeps text between elements and drops comments', () => {
    expect(parseHtml('<P CLASS="x">a</P> <!-- c --> b')).toEqual([{ tag: 'p', attrs: { class: 'x' }, children: ['a'] }, ' ', ' b']);
  });

  it('parses a whole document down to the sections', () => {
    const html = first('<!doctype html>\n<html lang="en"><head><title>t</title></head><body>\n<section id="s1"><div>a</div></section>\n</body></html>\n');
    expect(html).toMatchObject({ tag: 'html', attrs: { lang: 'en' } });
    const body = html.children.find((child) => typeof child !== 'string' && child.tag === 'body') as HtmlNode;
    expect(body.children.filter((child) => typeof child !== 'string')).toEqual([{ tag: 'section', attrs: { id: 's1' }, children: [{ tag: 'div', attrs: {}, children: ['a'] }] }]);
  });
});
