/**
 * In-memory message log. Pure model (no DOM) so it is unit-testable.
 *
 * Capped: a hostile or chatty page could flood `window.postMessage`; the log
 * keeps the newest `capacity` entries and counts what it dropped, so the
 * probe can never grow unbounded memory / DOM from a message flood.
 */

import type { RejectCode } from './envelope';

export type Direction = 'in' | 'out' | 'info';

/** What a captured message turned out to be. */
export type EntryKind =
  | 'pkc' // valid PKC-Message envelope
  | 'pkc-invalid' // claims protocol 'pkc-message' but fails validation
  | 'foreign' // any other window message (visible via toggle)
  | 'note'; // probe's own informational row

export interface LogEntry {
  seq: number;
  at: string; // ISO 8601
  direction: Direction;
  kind: EntryKind;
  /** envelope type, or a short label for foreign/note rows. */
  type: string;
  sourceId: string | null;
  targetId: string | null;
  /** MessageEvent.origin, or '-' for outgoing/notes. */
  origin: string;
  /** Came from (or went to) the linked host window. */
  viaHost: boolean;
  rejectCode?: RejectCode;
  detail?: string;
  /** Full structured-clone data, for the tree view / copy. */
  data: unknown;
}

export interface LogFilter {
  /** null = no type filtering; otherwise only these `type` values. */
  types: Set<string> | null;
  /** Case-insensitive substring match over the serialized data. */
  search: string;
  /** Include 'foreign' rows. */
  showForeign: boolean;
}

export class MessageLog {
  private entries: LogEntry[] = [];
  private seq = 0;
  private droppedCount = 0;

  constructor(private readonly capacity = 500) {}

  push(e: Omit<LogEntry, 'seq'>): LogEntry {
    const entry: LogEntry = { ...e, seq: ++this.seq };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
      this.droppedCount++;
    }
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.droppedCount = 0;
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  /** Distinct `type` values seen, for building the filter checkboxes. */
  seenTypes(): string[] {
    const s = new Set<string>();
    for (const e of this.entries) s.add(e.type);
    return [...s].sort();
  }

  filtered(f: LogFilter): LogEntry[] {
    const q = f.search.trim().toLowerCase();
    return this.entries.filter((e) => {
      if (!f.showForeign && e.kind === 'foreign') return false;
      if (f.types !== null && !f.types.has(e.type)) return false;
      if (q !== '') {
        const hay = `${e.type} ${e.sourceId ?? ''} ${e.targetId ?? ''} ${safeStringify(e.data)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
}

/**
 * JSON.stringify that never throws: structured-clone data may legally
 * contain cycles (postMessage supports them), which JSON.stringify cannot.
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        if (typeof v === 'bigint') return `${v.toString()}n`;
        return v;
      },
      space,
    ) ?? 'undefined';
  } catch {
    return '(serialize 不能)';
  }
}
