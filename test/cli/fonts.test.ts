import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { afterEach, expect, it } from 'vitest';
import { parseXml, type XmlNode } from '../../src/ooxml/xml.js';
import { mutateFont } from '../fonts/fixture.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => typeof child === 'string' ? [] : [
    ...(child.name === name ? [child] : []), ...descendants(child, name),
  ]);
}

it('serializes unmodified faces by Office family and RIBBI, not CSS aliases or weight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-font-identity-'));
  directories.push(dir);
  const output = join(dir, 'fonts.pptx');
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', 'convert',
    'fixtures/corpus/fonts/office-identity/deck.html', '-o', output, '--json', '--quiet', '--offline'],
  { encoding: 'utf8', timeout: 60_000 });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const zip = await JSZip.loadAsync(await readFile(output));
  const slide = parseXml(await zip.file('ppt/slides/slide1.xml')!.async('string'));
  const runs = descendants(slide, 'a:r').map((run) => {
    const props = descendants(run, 'a:rPr')[0]!;
    return {
      text: descendants(run, 'a:t')[0]!.children.join(''),
      families: ['a:latin', 'a:ea', 'a:cs'].map((name) => descendants(props, name)[0]?.attrs.typeface),
      bold: props.attrs.b === '1',
      italic: props.attrs.i === '1',
    };
  });
  expect(runs).toEqual([
    { text: 'Heebo Medium editable', families: ['Heebo Medium', 'Heebo Medium', 'Heebo Medium'], bold: false, italic: false },
    { text: 'Heebo Bold editable', families: ['Heebo', 'Heebo', 'Heebo'], bold: true, italic: false },
    { text: 'Heebo ExtraBold editable', families: ['Heebo ExtraBold', 'Heebo ExtraBold', 'Heebo ExtraBold'], bold: false, italic: false },
    { text: 'Source Sans Regular editable', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: false, italic: false },
    { text: 'Source Sans Bold editable', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: true, italic: false },
    { text: 'Source Sans Italic editable', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: false, italic: true },
    { text: 'Source Sans Bold Italic editable', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: true, italic: true },
  ]);
  const { fonts }: { fonts: Array<{ file: string; sha256: string }> } =
    JSON.parse(await readFile('fixtures/corpus/fonts/_assets/manifest.json', 'utf8'));
  for (const font of fonts) {
    const bytes = await readFile(join('fixtures/corpus/fonts/_assets', font.file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256);
  }
});

it.each([
  { label: 'normal/bold weight keywords', regularWeight: 'normal', boldWeight: 'bold', slantedStyle: 'italic' },
  { label: 'oblique style', regularWeight: '400', boldWeight: '700', slantedStyle: 'oblique' },
  { label: 'oblique style with an angle', regularWeight: '400', boldWeight: '700', slantedStyle: 'oblique 12deg' },
])('matches @font-face $label without changing the selected Office style', async ({ regularWeight, boldWeight, slantedStyle }) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-font-descriptors-'));
  directories.push(dir);
  const fontUrl = (file: string) => pathToFileURL(resolve('fixtures/corpus/fonts/_assets/source-sans-3', file)).href;
  const input = join(dir, 'deck.html');
  await writeFile(input, `<!doctype html><html><head><style>
    @font-face { font-family: Descriptor; font-weight: ${regularWeight}; font-style: normal; src: url('${fontUrl('SourceSans3-Regular.ttf')}'); }
    @font-face { font-family: Descriptor; font-weight: ${boldWeight}; font-style: normal; src: url('${fontUrl('SourceSans3-Bold.ttf')}'); }
    @font-face { font-family: Descriptor; font-weight: ${regularWeight}; font-style: ${slantedStyle}; src: url('${fontUrl('SourceSans3-It.ttf')}'); }
    @font-face { font-family: Descriptor; font-weight: ${boldWeight}; font-style: ${slantedStyle}; src: url('${fontUrl('SourceSans3-BoldIt.ttf')}'); }
    p { font-family: Descriptor; font-size: 24px; line-height: 32px; }
    </style></head><body><section>
    <p style="font-weight: normal; font-style: normal">Regular</p>
    <p style="font-weight: bold; font-style: normal">Bold</p>
    <p style="font-weight: normal; font-style: ${slantedStyle}">Slanted</p>
    <p style="font-weight: bold; font-style: ${slantedStyle}">Bold slanted</p>
    </section></body></html>`);
  const output = join(dir, 'fonts.pptx');
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', 'convert',
    input, '-o', output, '--json', '--quiet', '--offline'],
  { encoding: 'utf8', timeout: 60_000 });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const zip = await JSZip.loadAsync(await readFile(output));
  const slide = parseXml(await zip.file('ppt/slides/slide1.xml')!.async('string'));
  expect(descendants(slide, 'a:r').map((run) => {
    const props = descendants(run, 'a:rPr')[0]!;
    return {
      text: descendants(run, 'a:t')[0]!.children.join(''),
      families: ['a:latin', 'a:ea', 'a:cs'].map((name) => descendants(props, name)[0]?.attrs.typeface),
      bold: props.attrs.b === '1',
      italic: props.attrs.i === '1',
    };
  })).toEqual([
    { text: 'Regular', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: false, italic: false },
    { text: 'Bold', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: true, italic: false },
    { text: 'Slanted', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: false, italic: true },
    { text: 'Bold slanted', families: ['Source Sans 3', 'Source Sans 3', 'Source Sans 3'], bold: true, italic: true },
  ]);
});

it('rejects inconsistent selected metadata without falling back or replacing the destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-invalid-font-cli-'));
  directories.push(dir);
  const file = join(dir, 'broken.ttf');
  const source = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf');
  await mutateFont(source, file, { macStyle: 1 });
  const input = join(dir, 'deck.html');
  await writeFile(input, `<!doctype html><html><head><style>
    @font-face { font-family: Broken; font-weight: 500; src: url('${pathToFileURL(file).href}'); }
    @font-face { font-family: Fallback; font-weight: 500; src: url('${pathToFileURL(source).href}'); }
    body { font: 500 24px/32px Broken, Fallback; }
    </style></head><body><section><p>Invalid identity</p></section></body></html>`);
  const output = join(dir, 'kept.pptx');
  await writeFile(output, 'Existing Deck');
  for (const command of ['validate', 'convert']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', command, input,
      ...(command === 'convert' ? ['-o', output] : []), '--json', '--quiet', '--offline'],
    { encoding: 'utf8', timeout: 60_000 });
    expect(result.status, result.stderr || result.stdout).toBe(2);
    expect(JSON.parse(result.stdout).entries).toContainEqual(expect.objectContaining({
      code: 'FONT_IDENTITY_INVALID', severity: 'error', kind: 'error',
    }));
    expect(await readFile(output, 'utf8')).toBe('Existing Deck');
  }
});
