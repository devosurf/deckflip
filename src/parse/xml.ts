import type { XmlNode } from '../ooxml/xml.js';

/** First element child named `name`; undefined when the parent or the child is absent. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) {
    return undefined;
  }
  for (const candidate of node.children) {
    if (typeof candidate !== 'string' && candidate.name === name) {
      return candidate;
    }
  }
  return undefined;
}

/** Element children named `name`, in document order; every element child when `name` is omitted. */
export function children(node: XmlNode | undefined, name?: string): XmlNode[] {
  if (!node) {
    return [];
  }
  const out: XmlNode[] = [];
  for (const candidate of node.children) {
    if (typeof candidate !== 'string' && (name === undefined || candidate.name === name)) {
      out.push(candidate);
    }
  }
  return out;
}

/** The nodes of an optional chain that are actually there, in order: the shape every inheritance walk wants. */
export function defined(nodes: Array<XmlNode | undefined>): XmlNode[] {
  return nodes.filter((node): node is XmlNode => node !== undefined);
}

/** Concatenated text content of the node's direct text children. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) {
    return '';
  }
  let text = '';
  for (const candidate of node.children) {
    if (typeof candidate === 'string') {
      text += candidate;
    }
  }
  return text;
}
