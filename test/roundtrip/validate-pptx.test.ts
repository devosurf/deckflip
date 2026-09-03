import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertPptxToHtml, validatePptx } from '../../src/convert.js';
import { buildPptx } from '../render/pptx-fixture.js';

const chart = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>';
const wordArt = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="WordArt 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="2743200"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp></a:bodyPr><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>Arch</a:t></a:r></a:p></p:txBody></p:sp>';
const connector = '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Connector 3"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>';
const timing = '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';

describe('validatePptx', () => {
  it('lists every opaque element and deck-level opaque part a round trip carries, with PPTX locators', async () => {
    const pptx = await buildPptx({
      slides: [
        { name: 'One', shapes: `${chart}${wordArt}`, rels: [['rId2', 'chart', '../charts/chart1.xml'], ['rId3', 'comments', '../comments/comment1.xml']], tail: timing },
        { name: 'Two', shapes: connector },
      ],
      parts: { 'ppt/charts/chart1.xml': '<c:chartSpace/>', 'ppt/comments/comment1.xml': '<p:cmLst/>' },
      contentTypes: { overrides: { '/ppt/charts/chart1.xml': 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml', '/ppt/comments/comment1.xml': 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml' } },
      vba: true,
    });
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-validate-pptx-'));
    const input = join(dir, 'deck.pptm');
    await writeFile(input, pptx);

    const { report, exitCode } = await validatePptx(input);
    expect(exitCode).toBe(0);
    expect(report.input).toEqual({ path: input, kind: 'pptx' });
    const expected = [
      ['PRESERVE_OPAQUE_CHART', 1, { shapeId: '1-2', name: 'Chart 1' }],
      ['PRESERVE_OPAQUE_TEXT_EFFECTS', 1, { shapeId: '1-3', name: 'WordArt 2' }],
      ['PRESERVE_OPAQUE_ANIMATION', 1, undefined],
      ['PRESERVE_OPAQUE_COMMENTS', 1, undefined],
      ['PRESERVE_OPAQUE_VECTOR', 2, { shapeId: '2-4', name: 'Connector 3' }],
      ['PRESERVE_OPAQUE_MASTER', undefined, undefined],
      ['PRESERVE_OPAQUE_VBA', undefined, undefined],
    ];
    const preserved = report.entries.filter((entry) => entry.code.startsWith('PRESERVE_'));
    expect(preserved.map((entry) => [entry.code, entry.slide, entry.locator])).toEqual(expected);
    expect(preserved.every((entry) => entry.severity === 'info' && entry.kind === 'preserved')).toBe(true);
    expect(report.summary.preserved).toBe(expected.length);

    const converted = await convertPptxToHtml(input, { output: join(dir, 'deck.html') });
    expect(converted.report.entries.filter((entry) => entry.code.startsWith('PRESERVE_')).map((entry) => [entry.code, entry.slide, entry.locator])).toEqual(expected);
  });
});
