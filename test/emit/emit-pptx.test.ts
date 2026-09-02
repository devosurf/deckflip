import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Deck, Paragraph, ResolvedFont, RunStyle } from '../../src/model/index.js';
import { emitPptx } from '../../src/emit/index.js';

const sofficeAvailable = Boolean(spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status === 0);
const created = new Date('2024-01-02T03:04:05.000Z');

function resolvedFont(): ResolvedFont {
  return {
    family: 'Resolved',
    file: '/fonts/resolved.ttf',
    class: 'installed',
    metrics: { ascender: 1854 / 2048, descender: 434 / 2048 },
    fsType: 0,
  };
}

function runStyle(overrides: Partial<RunStyle> = {}, includeResolvedFont = true): RunStyle {
  const base: RunStyle = {
    fontStack: ['Resolved', 'Arial'],
    weight: 400,
    size: 24,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: { hex: '000000', alpha: 1 },
    letterSpacing: 0,
    caps: 'none',
    baseline: 0,
  };
  if (includeResolvedFont) {
    base.font = resolvedFont();
  }
  return { ...base, ...overrides };
}

function deck(): Deck {
  const firstParagraph: Paragraph = {
    align: 'l',
    lineHeight: 33.6,
    spaceBefore: 0,
    spaceAfter: 0,
    indent: 0,
    level: 0,
    runs: [{ kind: 'text', text: 'Alpha', style: runStyle() }],
  };
  const secondParagraph: Paragraph = {
    align: 'ctr',
    lineHeight: 20,
    spaceBefore: 0,
    spaceAfter: 0,
    indent: 0,
    level: 0,
    runs: [{ kind: 'text', text: 'Beta', style: runStyle({ fontStack: ['Arial'], size: 12, color: { hex: '333333', alpha: 1 } }, false) }],
  };

  return {
    title: 'Emit smoke test',
    lang: 'en-US',
    canvas: { width: 1280, height: 720, source: 'default' },
    fontFaces: [],
    slides: [
      {
        index: 1,
        id: 'slide-1',
        name: 'Slide 1',
        layout: 'Blank',
        elements: [
          {
            kind: 'shape',
            selector: '#rect',
            name: 'rect',
            box: { x: 80, y: 20, w: 100, h: 50 },
            rotation: 0,
            geometry: { preset: 'rect' },
            fill: { type: 'solid', color: { hex: 'FF0000', alpha: 1 } },
          },
          {
            kind: 'shape',
            selector: '#text',
            name: 'textbox',
            box: { x: 30, y: 40, w: 200, h: 80 },
            rotation: 0,
            geometry: { preset: 'rect' },
            text: {
              padding: { l: 4, t: 3, r: 4, b: 5 },
              firstParagraphGap: 2,
              lastParagraphGap: 1,
              wrap: true,
              rtl: false,
              trailingGuard: 0,
              paragraphs: [firstParagraph, secondParagraph],
            },
          },
        ],
      },
    ],
  };
}

async function zipEntries(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => !name.endsWith('/'));
}

describe('emitPptx', () => {
  it('emits reproducible PPTX bytes and the expected slide XML', async () => {
    const pptx = await emitPptx(deck(), { created, appVersion: '1.2.3' });
    const again = await emitPptx(deck(), { created, appVersion: '1.2.3' });

    expect(Buffer.compare(pptx, again)).toBe(0);
    expect(await zipEntries(pptx)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/theme/theme1.xml',
    ]);

    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain('p:cNvPr id="2" name="rect"');
    expect(slideXml).toContain('a:off x="762000" y="190500"');
    expect(slideXml).toContain('a:spcPts val="2520"');
    // Arial 24px in a 33.6px line: Chromium baseline 25.3, PowerPoint 26.611 -> correction 1.311; tIns = (3 + 2 - 1.311) px = 35138 EMU
    expect(slideXml).toContain('tIns="35138"');
    expect(slideXml).toContain('p:cNvSpPr txBox="1"');
  });

  it.skipIf(!sofficeAvailable)('opens in LibreOffice and converts to PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-emit-'));
    const pptxPath = join(dir, 'deck.pptx');
    await writeFile(pptxPath, await emitPptx(deck(), { created, appVersion: '1.2.3' }));

    const result = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, pptxPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const pdfPath = join(dir, 'deck.pdf');
    const info = await stat(pdfPath);
    expect(info.size).toBeGreaterThan(0);
    expect((await readFile(pdfPath)).length).toBeGreaterThan(0);
  });
});
