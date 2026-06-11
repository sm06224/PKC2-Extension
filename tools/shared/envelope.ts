/**
 * PKC-Message v1 envelope — vendored from the canonical spec
 * (PKC2 `docs/spec/pkc-message-api-v1.md` §4) so this tool has zero import
 * dependency on the host repo, the same way the official graph extension
 * vendors its minimal data model.
 *
 * `validateEnvelope` mirrors the host-side validation order
 * (`src/adapter/transport/envelope.ts`, spec §4.2) so the probe's local
 * verdict matches what the host bridge would decide.
 */

export const PROTOCOL = 'pkc-message' as const;
export const VERSION = 1 as const;

/**
 * spec §4.1 / §7 — the known message types. `record:ack` is the v1.x
 * additive delivery confirmation (PKC2#804, host→sender); old hosts never
 * send it and reject it as INVALID_TYPE if sent to them.
 */
export const KNOWN_TYPES = [
  'ping',
  'pong',
  'record:offer',
  'record:ack',
  'record:accept',
  'record:reject',
  'export:request',
  'export:result',
  'navigate',
  'custom',
] as const;
export type MessageType = (typeof KNOWN_TYPES)[number];

export interface Envelope {
  protocol: typeof PROTOCOL;
  version: typeof VERSION;
  type: MessageType;
  source_id: string | null;
  target_id: string | null;
  payload: unknown;
  timestamp: string;
  /**
   * v1.x additive (PKC2#804): sender-chosen id echoed by the host in
   * record:ack / record:reject / record:accept, making offer round-trips
   * correlatable. Old hosts ignore it (spec §9.4 unknown-field rule).
   */
  correlation_id?: string;
}

/** spec §4.3 — envelope-level reject codes. */
export type RejectCode =
  | 'NOT_OBJECT'
  | 'WRONG_PROTOCOL'
  | 'WRONG_VERSION'
  | 'MISSING_TYPE'
  | 'INVALID_TYPE'
  | 'MISSING_TIMESTAMP';

export interface RejectReason {
  code: RejectCode;
  detail: string;
}

/**
 * Mirrors the host bridge exactly (spec §4.2, corrected by PKC2 PR #799):
 * `NOT_OBJECT` returns alone (nothing else can be checked), every other
 * failing check is **collected** and reported together — the host rejects
 * once with all reasons, not first-fail.
 */
export type ValidationResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; reasons: RejectReason[] };

export function validateEnvelope(data: unknown): ValidationResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reasons: [{ code: 'NOT_OBJECT', detail: 'envelope が plain object ではない' }] };
  }
  const d = data as Record<string, unknown>;
  const reasons: RejectReason[] = [];
  if (d['protocol'] !== PROTOCOL) {
    reasons.push({ code: 'WRONG_PROTOCOL', detail: `protocol が 'pkc-message' ではない (${shortValue(d['protocol'])})` });
  }
  if (d['version'] !== VERSION) {
    reasons.push({ code: 'WRONG_VERSION', detail: `version が 1 ではない (${shortValue(d['version'])})` });
  }
  if (typeof d['type'] !== 'string' || d['type'] === '') {
    reasons.push({ code: 'MISSING_TYPE', detail: 'type が空、または string でない' });
  } else if (!(KNOWN_TYPES as readonly string[]).includes(d['type'])) {
    reasons.push({ code: 'INVALID_TYPE', detail: `KNOWN_TYPES に未登録の type (${shortValue(d['type'])})` });
  }
  if (typeof d['timestamp'] !== 'string') {
    reasons.push({ code: 'MISSING_TIMESTAMP', detail: 'timestamp が string でない' });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, envelope: d as unknown as Envelope };
}

/** Join reasons for single-line display. */
export function formatReasons(reasons: RejectReason[]): string {
  return reasons.map((r) => `[${r.code}] ${r.detail}`).join('; ');
}

export function buildEnvelope(
  type: MessageType,
  payload: unknown,
  opts?: { sourceId?: string | null; targetId?: string | null; correlationId?: string },
): Envelope {
  const envelope: Envelope = {
    protocol: PROTOCOL,
    version: VERSION,
    type,
    source_id: opts?.sourceId ?? null,
    target_id: opts?.targetId ?? null,
    payload,
    timestamp: new Date().toISOString(),
  };
  if (opts?.correlationId !== undefined) envelope.correlation_id = opts.correlationId;
  return envelope;
}

/** Correlation id for offer round-trips (PKC2#804). Same fallback as the host launcher. */
export function makeCorrelationId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** spec §5.2 PongProfile — fields are additive-only within v1. */
export interface PongProfile {
  app_id: string;
  version: string;
  schema_version: number;
  embedded: boolean;
  capabilities: string[];
}

/**
 * Tolerant parse (spec §9.4: known fields only, unknown fields ignored).
 * Returns null when the payload is not recognizably a PongProfile.
 */
export function parsePongProfile(payload: unknown): PongProfile | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p['app_id'] !== 'string') return null;
  return {
    app_id: p['app_id'],
    version: typeof p['version'] === 'string' ? p['version'] : '?',
    schema_version: typeof p['schema_version'] === 'number' ? p['schema_version'] : -1,
    embedded: p['embedded'] === true,
    capabilities: Array.isArray(p['capabilities'])
      ? p['capabilities'].filter((c): c is string => typeof c === 'string')
      : [],
  };
}

/**
 * spec §7.2.2 — record:offer body size cap, measured in **UTF-16 code
 * units** (`String.prototype.length`), NOT bytes. Unit fixed by the host
 * in PKC2 PR #798 (#795 A-2): a non-ASCII body may exceed 262144 bytes
 * while passing this cap (Japanese ≈ 3 bytes/unit in UTF-8).
 */
export const BODY_SIZE_CAP_UTF16_UNITS = 262144;

function shortValue(v: unknown): string {
  try {
    const s = typeof v === 'string' ? `'${v}'` : String(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  } catch {
    return '(表示不能)';
  }
}
