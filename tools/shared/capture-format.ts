/**
 * Traffic capture file format — shared by A4 traffic-recorder (writer) and
 * A5 replay-player (reader). The reader also accepts A1 message-probe's
 * "Copy All" output (an array of log entries) so any probe session can be
 * replayed without conversion.
 */

export interface CapturedEvent {
  at: string; // ISO 8601
  direction: 'in' | 'out';
  /** inbound: event.origin / outbound: '-'. */
  origin: string;
  viaHost: boolean;
  kind: 'pkc' | 'foreign';
  /** Best-effort label (envelope type etc.) for list display. */
  type: string;
  data: unknown;
}

export interface CaptureFile {
  format: 'pkc2-traffic-capture';
  version: 1;
  recordedAt: string;
  source: string;
  events: CapturedEvent[];
}

export const CAPTURE_EVENT_CAP = 5000;

export function buildCaptureFile(source: string, events: readonly CapturedEvent[]): CaptureFile {
  return {
    format: 'pkc2-traffic-capture',
    version: 1,
    recordedAt: new Date().toISOString(),
    source,
    events: [...events],
  };
}

export type ParseResult =
  | { ok: true; events: CapturedEvent[]; sourceLabel: string }
  | { ok: false; error: string };

/**
 * Parse a capture JSON: either an A4 CaptureFile or an A1 "Copy All" array.
 * Hostile input tolerant: strict shape checks, event cap, never throws.
 */
export function parseCaptureText(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (ex) {
    return { ok: false, error: `JSON parse 失敗: ${ex instanceof Error ? ex.message : String(ex)}` };
  }

  // A4 native format
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const f = parsed as Record<string, unknown>;
    if (f['format'] !== 'pkc2-traffic-capture') return { ok: false, error: 'format が pkc2-traffic-capture ではありません' };
    if (f['version'] !== 1) return { ok: false, error: `未知の capture version: ${String(f['version'])}` };
    if (!Array.isArray(f['events'])) return { ok: false, error: 'events が配列ではありません' };
    const events = normalizeEvents(f['events']);
    if (!events.ok) return events;
    return { ok: true, events: events.events, sourceLabel: typeof f['source'] === 'string' ? f['source'] : '(capture)' };
  }

  // A1 "Copy All" — an array of log entries
  if (Array.isArray(parsed)) {
    const events = normalizeEvents(parsed);
    if (!events.ok) return events;
    return { ok: true, events: events.events, sourceLabel: '(A1 Copy All)' };
  }

  return { ok: false, error: 'capture file でも A1 Copy All 配列でもありません' };
}

function normalizeEvents(raw: unknown[]): { ok: true; events: CapturedEvent[] } | { ok: false; error: string } {
  if (raw.length > CAPTURE_EVENT_CAP) {
    return { ok: false, error: `イベント数が上限超過(${raw.length} > ${CAPTURE_EVENT_CAP})` };
  }
  const events: CapturedEvent[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== 'object') continue; // skip junk rows
    const o = e as Record<string, unknown>;
    const direction = o['direction'] === 'out' ? 'out' : o['direction'] === 'in' ? 'in' : null;
    if (direction === null) continue; // A1 'info' notes etc. are not replayable traffic
    if (!('data' in o)) continue;
    const kindRaw = o['kind'];
    events.push({
      at: typeof o['at'] === 'string' ? o['at'] : '',
      direction,
      origin: typeof o['origin'] === 'string' ? o['origin'] : '-',
      viaHost: o['viaHost'] === true,
      kind: kindRaw === 'pkc' || kindRaw === 'pkc-invalid' ? 'pkc' : 'foreign',
      type: typeof o['type'] === 'string' ? o['type'] : '(?)',
      data: o['data'],
    });
  }
  return { ok: true, events };
}
