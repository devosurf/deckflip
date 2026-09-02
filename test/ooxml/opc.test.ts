import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { CT, OpcPackage, REL } from '../../src/ooxml/opc.js';

async function zipEntries(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => !name.endsWith('/'));
}
describe('opc package', () => {
  it('writes content types, relationships and files in deterministic order', async () => {
    const pkg = new OpcPackage();
    pkg.addPart('/ppt/slides/slide1.xml', CT.slide, '<slide/>');
    pkg.addRelationship('/', REL.officeDocument, 'ppt/presentation.xml');
    pkg.addRelationship('/', REL.coreProperties, 'docProps/core.xml');
    pkg.addPart('/ppt/presentation.xml', CT.presentation, '<presentation/>');
    pkg.addRelationship('/ppt/presentation.xml', REL.slide, 'slides/slide1.xml');
    pkg.addRelationship('/ppt/slides/slide1.xml', REL.hyperlink, 'https://example.com', { external: true });

    const first = await pkg.toBuffer({ date: new Date('1980-01-01T00:00:00.000Z') });
    const second = await pkg.toBuffer({ date: new Date('1980-01-01T00:00:00.000Z') });

    expect(Buffer.compare(first, second)).toBe(0);
    expect(await zipEntries(first)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
    ]);

    const zip = await JSZip.loadAsync(first);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>');
    expect(await zip.file('_rels/.rels')!.async('string')).toContain('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>');
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('TargetMode="External"');
  });
});
