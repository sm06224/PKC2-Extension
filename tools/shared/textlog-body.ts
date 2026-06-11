/**
 * PKC2 textlog body (JSON stored as string): `{ entries: [{ id, text,
 * createdAt, flags }] }` — mirrors `src/features/textlog/textlog-body.ts`.
 * The host's `parseTextlogBody` regenerates missing/odd ids, so a simple
 * unique string id is sufficient on the sender side.
 */

export interface TextlogEntryDraft {
  id: string;
  text: string;
  createdAt: string; // ISO 8601
  flags: string[];
}

export function makeLogEntry(text: string, at: Date = new Date()): TextlogEntryDraft {
  return {
    id: `log-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: at.toISOString(),
    flags: [],
  };
}

export function serializeTextlogEntries(entries: readonly TextlogEntryDraft[]): string {
  return JSON.stringify({ entries });
}

/** `YYYY-MM-DD(曜)` — daily log titles. */
export function dailyTitle(d: Date = new Date()): string {
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}(${w})`;
}
