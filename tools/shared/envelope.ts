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

/** spec §4.1 / §7 — the 9 known message types of v1. */
export const KNOWN_TYPES = [
  'ping',
  'pong',
  'record:offer',
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
}

/** spec §4.3 — envelope-level reject codes, in validation order. */
export type RejectCode =
  | 'NOT_OBJECT'
  | 'WRONG_PROTOCOL'
  | 'WRONG_VERSION'
  | 'MISSING_TYPE'
  | 'INVALID_TYPE'
  | 'MISSING_TIMESTAMP';

export type ValidationResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; code: RejectCode; detail: string };

export function validateEnvelope(data: unknown): ValidationResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'NOT_OBJECT', detail: 'envelope が plain object ではない' };
  }
  const d = data as Record<string, unknown>;
  if (d['protocol'] !== PROTOCOL) {
    return { ok: false, code: 'WRONG_PROTOCOL', detail: `protocol が 'pkc-message' ではない (${shortValue(d['protocol'])})` };
  }
  if (d['version'] !== VERSION) {
    return { ok: false, code: 'WRONG_VERSION', detail: `version が 1 ではない (${shortValue(d['version'])})` };
  }
  if (typeof d['type'] !== 'string' || d['type'] === '') {
    return { ok: false, code: 'MISSING_TYPE', detail: 'type が空、または string でない' };
  }
  if (!(KNOWN_TYPES as readonly string[]).includes(d['type'])) {
    return { ok: false, code: 'INVALID_TYPE', detail: `KNOWN_TYPES に未登録の type (${shortValue(d['type'])})` };
  }
  if (typeof d['timestamp'] !== 'string') {
    return { ok: false, code: 'MISSING_TIMESTAMP', detail: 'timestamp が string でない' };
  }
  return { ok: true, envelope: d as unknown as Envelope };
}

export function buildEnvelope(
  type: MessageType,
  payload: unknown,
  opts?: { sourceId?: string | null; targetId?: string | null },
): Envelope {
  return {
    protocol: PROTOCOL,
    version: VERSION,
    type,
    source_id: opts?.sourceId ?? null,
    target_id: opts?.targetId ?? null,
    payload,
    timestamp: new Date().toISOString(),
  };
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

/** spec §7.2.2 — record:offer body size cap (bytes). */
export const BODY_SIZE_CAP_BYTES = 262144;

/** UTF-8 byte length of a string (the cap is specified in bytes). */
export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function shortValue(v: unknown): string {
  try {
    const s = typeof v === 'string' ? `'${v}'` : String(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  } catch {
    return '(表示不能)';
  }
}
