import { SaxesParser } from 'saxes';

export type XmlChild = XmlNode | string;

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlChild[];
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '`': '&#96;',
};

export function el(
  name: string,
  attrs?: Record<string, string | number | undefined>,
  ...children: (XmlChild | XmlChild[] | undefined | false)[]
): XmlNode {
  const out: XmlChild[] = [];
  const push = (child: XmlChild | XmlChild[] | undefined | false): void => {
    if (child === undefined || child === false) {
      return;
    }
    if (Array.isArray(child)) {
      for (const nested of child) {
        push(nested);
      }
      return;
    }
    if (typeof child === 'string') {
      const last = out[out.length - 1];
      if (typeof last === 'string') {
        out[out.length - 1] = last + child;
      } else {
        out.push(child);
      }
      return;
    }
    out.push(child);
  };

  for (const child of children) {
    push(child);
  }

  const record: Record<string, string> = {};
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) {
        continue;
      }
      record[key] = String(value);
    }
  }

  return { name, attrs: record, children: out };
}

/** Already-serialised XML written verbatim by `serialize` (the round trip's untouched fragments); never produced by `parseXml`. */
export const RAW_NODE = '#raw';

export function raw(xml: string): XmlNode {
  return { name: RAW_NODE, attrs: {}, children: [xml] };
}

export function serialize(root: XmlNode, opts?: { declaration?: boolean }): string {
  const withDeclaration = opts?.declaration ?? true;
  const chunks: string[] = [];
  if (withDeclaration) {
    chunks.push(XML_DECLARATION);
  }
  chunks.push(serializeNode(root));
  return chunks.join('\n');
}

export function parseXml(text: string): XmlNode {
  let root: XmlNode | undefined;
  const stack: XmlNode[] = [];
  let error: Error | undefined;

  const parser = new SaxesParser({ xmlns: false });

  const appendText = (value: string): void => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      return;
    }
    const last = parent.children[parent.children.length - 1];
    if (typeof last === 'string') {
      parent.children[parent.children.length - 1] = last + value;
      return;
    }
    parent.children.push(value);
  };

  parser.on('opentag', (tag) => {
    const node: XmlNode = { name: tag.name, attrs: {}, children: [] };
    for (const [key, value] of Object.entries(tag.attributes)) {
      node.attrs[key] = value;
    }
    const parent = stack[stack.length - 1];
    if (!root) {
      root = node;
    } else if (parent) {
      parent.children.push(node);
    }
    stack.push(node);
  });

  parser.on('text', (value) => {
    appendText(value);
  });

  parser.on('cdata', (value) => {
    appendText(value);
  });

  parser.on('closetag', () => {
    stack.pop();
  });

  parser.on('error', (err) => {
    error = err;
  });

  parser.write(text).close();

  if (error) {
    throw error;
  }
  if (!root) {
    throw new Error('XML document has no root element');
  }
  return root;
}

function serializeNode(node: XmlNode): string {
  if (node.name === RAW_NODE) {
    return node.children.map((child) => (typeof child === 'string' ? child : serializeNode(child))).join('');
  }
  const attrs = serializeAttrs(node.attrs);
  if (!node.children.length) {
    return `<${node.name}${attrs}/>`;
  }
  const children = node.children.map((child) => (typeof child === 'string' ? escapeXml(child) : serializeNode(child))).join('');
  return `<${node.name}${attrs}>${children}</${node.name}>`;
}

function serializeAttrs(attrs: Record<string, string>): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    out += ` ${name}="${escapeXml(value)}"`;
  }
  return out;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"`]/g, (ch) => XML_ESCAPE[ch] ?? ch);
}
