// Conversion report schema (docs/spec/01-cli.md, 08-report-codes.md).

export type EntryKind = 'error' | 'rasterised' | 'flattened' | 'substituted' | 'dropped' | 'preserved' | 'overridden';
export type Severity = 'error' | 'warning' | 'info';

export type Locator = { selector: string } | { shapeId: string; name: string };

export interface Entry {
  code: string;
  kind: EntryKind;
  severity: Severity;
  /** 1-based; omitted for deck-level entries */
  slide?: number;
  locator?: Locator;
  reason: string;
  /** mandatory for every non-error entry */
  hint?: string;
}

export interface Report {
  schemaVersion: 1;
  tool: { name: 'deckflip'; version: string; browser?: string };
  command: 'convert' | 'validate' | 'render' | 'inspect';
  input: { path: string; kind: 'html' | 'pptx' };
  output?: { path: string; kind: 'pptx' | 'html' | 'png' };
  canvas: { width: number; height: number; source: 'default' | 'deck-meta' | 'flag' };
  summary: {
    slides: number;
    native: number;
    rasterised: number;
    flattened: number;
    substituted: number;
    dropped: number;
    preserved: number;
    overridden: number;
    errors: number;
  };
  entries: Entry[];
}

/** Thrown by any stage; the CLI maps it to the exit ladder. */
export class DeckflipError extends Error {
  constructor(
    message: string,
    /** 1 no output, 2 validation failed, 3 bad invocation */
    readonly exitCode: 1 | 2 | 3,
    readonly entries: Entry[] = [],
  ) {
    super(message);
    this.name = 'DeckflipError';
  }
}
