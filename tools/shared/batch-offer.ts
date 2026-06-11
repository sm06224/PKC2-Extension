/**
 * Batch offer sender — shared by the importer tools (B6/B7/B8).
 *
 * v1 offers are fire-and-forget and the host flood guard drops >120
 * msg/min per origin, so a batch is sent **sequentially with an
 * interval**(既定 600ms ≒ 100/min)。Each row gets its own
 * correlation_id so the per-offer status is trackable (PKC2#804).
 * The host shows one PendingOffer banner per offer — user accepts there.
 */

import { makeCorrelationId } from './envelope';
import type { HostConnection } from './host-connect';
import type { OfferTracker } from './offer-track';

export interface BatchRow {
  title: string;
  body: string;
  archetype?: string;
  source_url?: string;
}

export interface BatchHandle {
  stop: () => void;
}

export const BATCH_INTERVAL_MS = 600;

export function sendBatch(
  conn: HostConnection,
  tracker: OfferTracker,
  rows: readonly BatchRow[],
  onProgress: (sent: number, total: number, done: boolean) => void,
  intervalMs: number = BATCH_INTERVAL_MS,
): BatchHandle {
  let cursor = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const step = (): void => {
    if (stopped) return;
    const row = rows[cursor];
    if (!row) {
      onProgress(cursor, rows.length, true);
      return;
    }
    const correlationId = makeCorrelationId();
    const payload: Record<string, unknown> = { title: row.title, body: row.body };
    if (row.archetype !== undefined) payload['archetype'] = row.archetype;
    if (row.source_url !== undefined) payload['source_url'] = row.source_url;
    const sent = conn.send('record:offer', payload, { correlationId });
    if (sent) tracker.begin(correlationId, row.title);
    cursor += 1;
    onProgress(cursor, rows.length, false);
    timer = setTimeout(step, intervalMs);
  };
  step();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      onProgress(cursor, rows.length, true);
    },
  };
}

/**
 * Minimal RFC4180-ish CSV parser (quotes, escaped quotes, CR/LF). Pure,
 * never throws; used by B6. Returns rows of cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Split a markdown document into front-matter (simple `key: value` lines
 * between `---` fences) and body. Pure; used by B7.
 */
export function splitFrontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim();
  }
  return { meta, body: md.slice(m[0].length) };
}
