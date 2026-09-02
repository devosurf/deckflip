import { describe, expect, it } from 'vitest';
import { el, parseXml, serialize } from '../../src/ooxml/xml.js';

function isXmlNode(value: unknown): value is { name: string; children: unknown[] } {
  return value !== null && typeof value === 'object' && 'name' in value && 'children' in value;
}

describe('xml', () => {
  it('preserves attribute insertion order and escapes XML text', () => {
    const attrs: Record<string, string | number> = {};
    attrs.b = '2';
    attrs.a = '1';

    const xml = serialize(el('root', attrs, 'x & < > " `', el('child', { c: 3, d: 4 })));

    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root b="2" a="1">x &amp; &lt; &gt; &quot; &#96;<child c="3" d="4"/></root>');
  });

  it('parses prefixes and namespace declarations as ordinary attrs', () => {
    const root = parseXml('<p:root xmlns:p="urn:p" xmlns="urn:default" p:a="1" b="2"><p:child>text &amp; more</p:child></p:root>');

    expect(root.name).toBe('p:root');
    expect(Object.keys(root.attrs)).toEqual(['xmlns:p', 'xmlns', 'p:a', 'b']);
    expect(root.attrs['xmlns:p']).toBe('urn:p');
    expect(root.attrs.xmlns).toBe('urn:default');
    expect(root.children).toHaveLength(1);

    const child = root.children[0];
    expect(isXmlNode(child)).toBe(true);
    if (!isXmlNode(child)) {
      throw new Error('expected child node');
    }
    expect(child.name).toBe('p:child');
    expect(child.children).toHaveLength(1);
    expect(typeof child.children[0]).toBe('string');
    expect(child.children[0]).toBe('text & more');
  });
});
