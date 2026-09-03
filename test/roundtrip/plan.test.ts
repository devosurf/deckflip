import { describe, expect, it } from 'vitest';
import { emitHtml } from '../../src/htmlout/index.js';
import type { Deck, Element, ShapeElement } from '../../src/model/index.js';
import { OpcReader } from '../../src/ooxml/opc.js';
import { parsePptx } from '../../src/parse/index.js';
import { buildManifest, sectionsOf, sha256, type Manifest } from '../../src/roundtrip/manifest.js';
import { planSplice } from '../../src/roundtrip/plan.js';
import { indexSource, type SourceIndex } from '../../src/roundtrip/source.js';
import { buildPptx } from '../render/pptx-fixture.js';

const text = (id: number, name: string, x: number, body: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="914400"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`;
const box = (id: number, name: string, x: number): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>`;
const group = (id: number, inner: string): string =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="5486400" y="2743200"/><a:ext cx="914400" cy="914400"/><a:chOff x="5486400" y="2743200"/><a:chExt cx="914400" cy="914400"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
const timing = (spid: number): string =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

interface Fixture {
  deck: Deck;
  html: string;
  manifest: Manifest;
  source: SourceIndex;
}

async function fixture(): Promise<Fixture> {
  const pptx = await buildPptx({
    slides: [
      { name: 'One', shapes: `${text(2, 'Title', 914400, 'Hello')}${box(3, 'Box', 914400)}${group(4, box(5, 'Inner', 5486400))}${text(6, 'Note', 3657600, 'Note')}`, tail: timing(3) },
      { name: 'Two', shapes: box(7, 'Lone', 914400), tail: timing(7) },
      { name: 'Three', shapes: box(8, 'Gone', 914400) },
    ],
  });
  const deck = await parsePptx(pptx);
  const source = await indexSource(await OpcReader.load(pptx));
  const { html, slides } = emitHtml(deck);
  return { deck, html, manifest: buildManifest(html, slides, source, sha256(pptx)), source };
}

function elementsOf(deck: Deck, slide: number): Element[] {
  return deck.slides[slide - 1]!.elements;
}

function byId(elements: Element[], shapeId: string): Element {
  const found = elements.find((element) => element.shapeId === shapeId);
  if (!found) throw new Error(`no ${shapeId}`);
  return found;
}

describe('planSplice', () => {
  it('finds the deck identical when nothing changed', async () => {
    const { deck, html, manifest, source } = await fixture();
    const plan = planSplice(deck, sectionsOf(html), manifest, source);
    expect(plan.identical).toBe(true);
    expect(plan.entries.map((entry) => [entry.code, entry.slide])).toEqual([['PRESERVE_OPAQUE_ANIMATION', 1], ['PRESERVE_OPAQUE_ANIMATION', 2], ['PRESERVE_OPAQUE_MASTER', undefined]]);
    expect(plan.slides.map((slide) => [slide.untouched, slide.shellUntouched, slide.source?.partName])).toEqual([
      [true, true, '/ppt/slides/slide1.xml'],
      [true, true, '/ppt/slides/slide2.xml'],
      [true, true, '/ppt/slides/slide3.xml'],
    ]);
  });

  it('splices untouched shapes into an edited slide, keeps ids of edited ones and the timing they carry, copies untouched slides, drops deleted ones', async () => {
    const { deck, html, manifest, source } = await fixture();
    // edit: the title text, delete "Note", delete slide 3, append a new slide with an unknown id and a duplicated id
    const edited = html
      .replace('Hello', 'Hallo')
      .replace(/<div data-shape-id="1-6"[\s\S]*?<\/div>\n/, '')
      .replace(/<section id="slide-3"[\s\S]*?<\/section>\n/, '')
      .replace('</body>', '<section id="slide-4" data-title="New" data-layout="Blank"><div data-shape-id="9-9" style="position: absolute; left: 0; top: 0; width: 10px; height: 10px; background: #000"></div><div data-shape-id="2-7" style="position: absolute; left: 0; top: 0; width: 10px; height: 10px; background: #000"></div><div data-shape-id="2-7" style="position: absolute; left: 20px; top: 0; width: 10px; height: 10px; background: #000"></div></section>\n</body>');
    expect(edited).not.toBe(html);
    const sections = sectionsOf(edited);
    expect(sections.map((section) => section.attrs.id)).toEqual(['slide-1', 'slide-2', 'slide-4']);

    const one = elementsOf(deck, 1);
    const title = byId(one, '1-2');
    const boxElement = byId(one, '1-3');
    const groupElement = byId(one, '1-4');
    const fresh = (shapeId: string | undefined, x: number): ShapeElement => ({ kind: 'shape', ...(shapeId === undefined ? {} : { shapeId }), selector: 'div', name: 'div', box: { x, y: 0, w: 10, h: 10 }, rotation: 0, geometry: { preset: 'rect' } });
    const newElements = [fresh('9-9', 0), fresh('2-7', 0), fresh('2-7', 20)];
    const measured: Deck = {
      ...deck,
      slides: [
        { ...deck.slides[0]!, elements: [title, boxElement, groupElement] },
        { ...deck.slides[1]! },
        { index: 3, id: 'slide-4', name: 'New', layout: 'Blank', elements: newElements },
      ],
    };

    const plan = planSplice(measured, sections, manifest, source);
    expect(plan.identical).toBe(false);

    const [first, second, third] = plan.slides;
    expect(first).toMatchObject({ id: 'slide-1', untouched: false, shellUntouched: true, keepTiming: true });
    expect(first!.source?.partName).toBe('/ppt/slides/slide1.xml');
    expect(first!.splices.get(title)).toBeUndefined();
    expect(first!.keepIds.get(title)).toEqual([2]);
    expect(first!.splices.get(boxElement)).toMatchObject({ fragments: [{ id: 3 }] });
    expect(first!.splices.get(boxElement)!.source.partName).toBe('/ppt/slides/slide1.xml');
    expect(first!.splices.get(groupElement)).toMatchObject({ fragments: [{ id: 4 }] });
    expect(first!.leading).toBeUndefined();

    expect(second).toMatchObject({ id: 'slide-2', untouched: true, shellUntouched: true, keepTiming: true });
    expect([...second!.splices.values()].map((splice) => splice.fragments.map((fragment) => fragment.id))).toEqual([[7]]);

    expect(third).toMatchObject({ id: 'slide-4', untouched: false, shellUntouched: false, keepTiming: false });
    expect(third!.source).toBeUndefined();
    expect(third!.splices.size).toBe(0);
    expect(third!.keepIds.size).toBe(0);

    expect(plan.entries.map((entry) => [entry.code, entry.slide, entry.reason])).toEqual([
      ['PRESERVE_OPAQUE_ANIMATION', 1, 'Slide 1 keeps its animations and transition from the source'],
      ['PRESERVE_OPAQUE_ANIMATION', 2, 'Slide 2 keeps its animations and transition from the source'],
      ['PRESERVE_UNKNOWN_ID', 3, 'data-shape-id="9-9" is not in the manifest'],
      ['PRESERVE_UNKNOWN_ID', 3, 'data-shape-id="2-7" appears more than once'],
      ['PRESERVE_OPAQUE_MASTER', undefined, 'masters, layouts and themes come from the source; new Slides instantiate the layout they name'],
    ]);
  });

  it('moves an untouched shape between slides as its fragment and drops the timing whose target is gone', async () => {
    const { deck, html, manifest, source } = await fixture();
    // move the Box (1-3) from slide 1 into slide 2, and change slide 2's title
    const boxHtml = /<div data-shape-id="1-3"[^>]*><\/div>\n/.exec(html)?.[0];
    expect(boxHtml).toBeDefined();
    const edited = html.replace(boxHtml!, '').replace('data-title="Two"', 'data-title="Deux"').replace(/(<section id="slide-2"[^>]*>\n)/, `$1${boxHtml}`);
    const sections = sectionsOf(edited);

    const one = elementsOf(deck, 1);
    const boxElement = byId(one, '1-3');
    const measured: Deck = {
      ...deck,
      slides: [
        { ...deck.slides[0]!, elements: one.filter((element) => element !== boxElement) },
        { ...deck.slides[1]!, name: 'Deux', elements: [boxElement, ...elementsOf(deck, 2)] },
        deck.slides[2]!,
      ],
    };
    const plan = planSplice(measured, sections, manifest, source);
    const [first, second, third] = plan.slides;
    expect(first).toMatchObject({ untouched: false, shellUntouched: true, keepTiming: false });
    expect(second).toMatchObject({ untouched: false, shellUntouched: false, keepTiming: true });
    expect(second!.splices.get(boxElement)).toMatchObject({ fragments: [{ id: 3 }] });
    expect(second!.splices.get(boxElement)!.source.partName).toBe('/ppt/slides/slide1.xml');
    expect(third).toMatchObject({ untouched: true });
    expect(plan.entries.map((entry) => [entry.code, entry.slide])).toEqual([['DROPPED_ANIMATION', 1], ['PRESERVE_OPAQUE_ANIMATION', 2], ['PRESERVE_OPAQUE_MASTER', undefined]]);
  });

  it('reordering slides leaves every slide untouched but the deck not identical', async () => {
    const { deck, html, manifest, source } = await fixture();
    const sections = sectionsOf(html);
    const measured: Deck = { ...deck, slides: [deck.slides[1]!, deck.slides[0]!, deck.slides[2]!] };
    const plan = planSplice(measured, [sections[1]!, sections[0]!, sections[2]!], manifest, source);
    expect(plan.identical).toBe(false);
    expect(plan.slides.map((slide) => [slide.id, slide.untouched])).toEqual([['slide-2', true], ['slide-1', true], ['slide-3', true]]);
  });
});
