import { describe, expect, it } from 'vitest';
import {
  BODY_SIZE_CAP_UTF16_UNITS,
  buildEnvelope,
  formatReasons,
  KNOWN_TYPES,
  parsePongProfile,
  validateEnvelope,
} from '../../tools/shared/envelope';

function valid(): Record<string, unknown> {
  return {
    protocol: 'pkc-message',
    version: 1,
    type: 'ping',
    source_id: 'ext:test',
    target_id: null,
    payload: {},
    timestamp: '2026-06-10T00:00:00.000Z',
  };
}

describe('validateEnvelope (spec §4.2 — 全 reason 収集、PKC2 PR #799 準拠)', () => {
  it('accepts a valid v1 envelope', () => {
    const r = validateEnvelope(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.type).toBe('ping');
  });

  it('rejects non-objects as NOT_OBJECT (alone — nothing else checkable)', () => {
    for (const bad of [null, undefined, 42, 'str', [1, 2]]) {
      const r = validateEnvelope(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reasons).toHaveLength(1);
        expect(r.reasons[0]?.code).toBe('NOT_OBJECT');
      }
    }
  });

  it('rejects wrong protocol / version / type / timestamp in spec order', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid(), protocol: 'other' }, 'WRONG_PROTOCOL'],
      [{ ...valid(), version: 2 }, 'WRONG_VERSION'],
      [{ ...valid(), type: '' }, 'MISSING_TYPE'],
      [{ ...valid(), type: 42 }, 'MISSING_TYPE'],
      [{ ...valid(), type: 'unknown:type' }, 'INVALID_TYPE'],
      [{ ...valid(), timestamp: 123 }, 'MISSING_TIMESTAMP'],
    ];
    for (const [data, code] of cases) {
      const r = validateEnvelope(data);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.map((x) => x.code)).toContain(code);
    }
  });

  it('collects ALL failing reasons together (host behavior, not first-fail)', () => {
    const r = validateEnvelope({ protocol: 'x', version: 9, type: '', timestamp: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons.map((x) => x.code).sort()).toEqual(
        ['MISSING_TIMESTAMP', 'MISSING_TYPE', 'WRONG_PROTOCOL', 'WRONG_VERSION'],
      );
      expect(formatReasons(r.reasons)).toContain('[WRONG_PROTOCOL]');
    }
  });

  it('MISSING_TYPE and INVALID_TYPE are mutually exclusive', () => {
    const r = validateEnvelope({ ...valid(), type: 'nope:nope' });
    expect(!r.ok && r.reasons.map((x) => x.code)).toEqual(['INVALID_TYPE']);
  });

  it('accepts every KNOWN_TYPE', () => {
    for (const t of KNOWN_TYPES) {
      const r = validateEnvelope({ ...valid(), type: t });
      expect(r.ok).toBe(true);
    }
  });
});

describe('buildEnvelope', () => {
  it('produces a self-validating envelope', () => {
    const e = buildEnvelope('record:offer', { title: 't', body: 'b' }, { sourceId: 'ext:probe' });
    const r = validateEnvelope(e);
    expect(r.ok).toBe(true);
    expect(e.source_id).toBe('ext:probe');
    expect(e.target_id).toBeNull();
    expect(new Date(e.timestamp).getTime()).not.toBeNaN();
  });
});

describe('parsePongProfile (tolerant, spec §9.4)', () => {
  it('parses a canonical profile', () => {
    const p = parsePongProfile({
      app_id: 'pkc2',
      version: '2.1.1',
      schema_version: 1,
      embedded: false,
      capabilities: ['record:offer', 'export:request'],
    });
    expect(p).not.toBeNull();
    expect(p?.capabilities).toEqual(['record:offer', 'export:request']);
  });

  it('ignores unknown fields and tolerates missing optionals', () => {
    const p = parsePongProfile({ app_id: 'pkc2', future_field: 'x' });
    expect(p?.app_id).toBe('pkc2');
    expect(p?.capabilities).toEqual([]);
  });

  it('rejects garbage payloads without throwing', () => {
    for (const bad of [null, 'x', 42, [], { version: '1' }, { app_id: 9 }]) {
      expect(parsePongProfile(bad)).toBeNull();
    }
  });

  it('filters non-string capabilities', () => {
    const p = parsePongProfile({ app_id: 'pkc2', capabilities: ['a', 1, null, 'b'] });
    expect(p?.capabilities).toEqual(['a', 'b']);
  });
});

describe('size cap unit (spec §7.2.2 — UTF-16 code units、PKC2 PR #798 で確定)', () => {
  it('cap value is 262144 code units, and length is the contract measure', () => {
    expect(BODY_SIZE_CAP_UTF16_UNITS).toBe(262144);
    // 'あ' is 3 bytes in UTF-8 but ONE code unit — the host counts units.
    expect('あ'.length).toBe(1);
  });
});
