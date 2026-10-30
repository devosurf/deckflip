import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Entry, EntryKind, Report, Severity } from './types.js';

const KIND_ORDER: EntryKind[] = [
  'error',
  'rasterised',
  'flattened',
  'substituted',
  'dropped',
  'preserved',
  'overridden',
  'flagged',
];

const SEVERITY_STYLE: Record<'error' | 'warning' | 'info', string> = {
  error: '\u001b[31m',
  warning: '\u001b[33m',
  info: '\u001b[36m',
};

const RESET = '\u001b[0m';

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];

/** Thresholds affect failure only: every occurrence remains in the Conversion report. */
export function exceedsStrictThreshold(entries: readonly Entry[], strict?: Severity): boolean {
  if (strict === undefined) return false;
  const threshold = SEVERITY_ORDER.indexOf(strict);
  return entries.some((entry) => SEVERITY_ORDER.indexOf(entry.severity) <= threshold);
}

function countEntries(entries: readonly Entry[]): Record<EntryKind, number> & { errors: number } {
  const counts: Record<EntryKind, number> & { errors: number } = {
    error: 0,
    rasterised: 0,
    flattened: 0,
    substituted: 0,
    dropped: 0,
    preserved: 0,
    overridden: 0,
    flagged: 0,
    errors: 0,
  };
  for (const entry of entries) {
    counts[entry.kind] += 1;
    if (entry.severity === 'error') {
      counts.errors += 1;
    }
  }
  return counts;
}

function locatorText(entry: Entry): string {
  if (entry.locator === undefined) {
    return '';
  }
  if ('selector' in entry.locator) {
    return `<${entry.locator.selector}> `;
  }
  return `<shapeId=${entry.locator.shapeId} name=${entry.locator.name}> `;
}

function colorize(text: string, severity: Entry['severity'], color: boolean): string {
  if (!color) {
    return text;
  }
  return `${SEVERITY_STYLE[severity as 'error' | 'warning' | 'info']}${text}${RESET}`;
}

export function buildReport(
  base: Omit<Report, 'summary' | 'schemaVersion' | 'entries'>,
  entries: Entry[],
  slides: number,
  native: number,
): Report {
  const counts = countEntries(entries);
  return {
    schemaVersion: 1,
    ...base,
    summary: {
      slides,
      native,
      rasterised: counts.rasterised,
      flattened: counts.flattened,
      substituted: counts.substituted,
      dropped: counts.dropped,
      preserved: counts.preserved,
      overridden: counts.overridden,
      flagged: counts.flagged,
      errors: counts.errors,
    },
    entries,
  };
}

/** The report with `extra` entries appended and its summary recounted. */
export function withEntries(report: Report, extra: Entry[]): Report {
  const { schemaVersion: _schemaVersion, summary, entries, ...base } = report;
  return buildReport(base, [...entries, ...extra], summary.slides, summary.native);
}

export function formatSummary(report: Report, opts: { color: boolean }): string {
  const bySlide = new Map<number | undefined, Entry[]>();
  for (const entry of report.entries) {
    const key = entry.slide;
    const list = bySlide.get(key);
    if (list === undefined) {
      bySlide.set(key, [entry]);
    } else {
      list.push(entry);
    }
  }

  const lines: string[] = [];
  for (let slide = 1; slide <= report.summary.slides; slide += 1) {
    const counts = countEntries(bySlide.get(slide) ?? []);
    const kinds = KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => `${kind} ${counts[kind]}`);
    lines.push(`Slide ${slide}: ${kinds.length > 0 ? kinds.join(', ') : 'clean'}`);
  }
  const deckEntries = bySlide.get(undefined);
  if (deckEntries !== undefined) {
    const counts = countEntries(deckEntries);
    lines.push(`Deck: ${KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => `${kind} ${counts[kind]}`).join(', ')}`);
  }
  const s = report.summary;
  lines.push(`${s.slides} slide(s), ${s.native} native element(s), ${report.entries.length} report entr${report.entries.length === 1 ? 'y' : 'ies'}`);

  const groups = new Map<Severity, Map<string, Entry[]>>();
  for (const entry of report.entries) {
    let byCode = groups.get(entry.severity);
    if (byCode === undefined) {
      byCode = new Map();
      groups.set(entry.severity, byCode);
    }
    const group = byCode.get(entry.code);
    if (group === undefined) byCode.set(entry.code, [entry]);
    else group.push(entry);
  }
  for (const severity of SEVERITY_ORDER) {
    const byCode = groups.get(severity);
    if (byCode === undefined) continue;
    for (const code of [...byCode.keys()].sort()) {
      const entries = byCode.get(code)!;
      const locations = entries.slice(0, 3).map((entry) =>
        `${entry.slide === undefined ? 'deck' : `slide ${entry.slide}`} ${locatorText(entry)}`.trimEnd());
      if (entries.length > locations.length) locations.push(`+${entries.length - locations.length} more`);
      const hints = [...new Set(entries.flatMap((entry) => entry.hint ? [entry.hint] : []))];
      const head = colorize(`[${severity}] ${code}`, severity, opts.color);
      lines.push(`${head} (${entries.length} occurrence${entries.length === 1 ? '' : 's'}): ${locations.join(', ')} -- ${entries[0]!.reason}${hints.length === 0 ? '' : ` -- ${hints.join(' | ')}`}`);
    }
  }

  return lines.join('\n');
}

export async function writeSidecar(report: Report, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
