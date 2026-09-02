import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODES } from '../../src/report/codes.js';

const SKILL_DIR = join('skills', 'deckflip');

describe('skills/deckflip', () => {
  it('SKILL.md has the agent-skills frontmatter and stays within the size budget', async () => {
    const skill = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    expect(skill.startsWith('---\nname: deckflip\ndescription: ')).toBe(true);
    expect(skill.split('\n').length).toBeLessThanOrEqual(250);
    for (const step of ['validate', 'convert', '--strict', 'render', 'inspect']) {
      expect(skill).toContain(step);
    }
  });

  it('reference/report-codes.md names every code the CLI can raise', async () => {
    const reference = await readFile(join(SKILL_DIR, 'reference', 'report-codes.md'), 'utf8');
    const missing = Object.keys(CODES).filter((code) => !reference.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });

  it('ships the reference and template files the spec names', async () => {
    expect((await readdir(join(SKILL_DIR, 'reference'))).sort()).toEqual(['authoring-subset.md', 'fonts.md', 'report-codes.md', 'round-trip.md']);
    expect((await readdir(join(SKILL_DIR, 'templates', 'layouts'))).sort()).toEqual([
      'big-number.html',
      'bullets.html',
      'closing.html',
      'image-with-caption.html',
      'section-divider.html',
      'title.html',
      'two-column.html',
    ]);
    const deck = await readFile(join(SKILL_DIR, 'templates', 'deck.html'), 'utf8');
    for (const layout of await readdir(join(SKILL_DIR, 'templates', 'layouts'))) {
      // every layout is one of the deck's slides, verbatim
      expect(deck).toContain((await readFile(join(SKILL_DIR, 'templates', 'layouts', layout), 'utf8')).trim());
    }
  });
});
