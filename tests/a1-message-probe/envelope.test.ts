import { describe, expect, it } from 'vitest';
import {
  BODY_SIZE_CAP_BYTES,
  buildEnvelope,
  KNOWN_TYPES,
  parsePongProfile,
  utf8ByteLength,
  validateEnvelope,
} from '../../tools/a1-message-probe/src/envelope';

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

describe('validateEnvelope (spec §4.2 order)', () => {
  it('accepts a valid v1 envelope', () => {
    const r = validateEnvelope(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.type).toBe('ping');
  });

  it('rejects non-objects as NOT_OBJECT', () => {
    for (const bad of [null, undefined, 42, 'str', [1, 2]]) {
      const r = validateEnvelope(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NOT_OBJECT');
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
      if (!r.ok) expect(r.code).toBe(code);
    }
  });

  it('validation order: protocol wins over later failures', () => {
    const r = validateEnvelope({ protocol: 'x', version: 9, type: '', timestamp: 1 });
    expect(!r.ok && r.code).toBe('WRONG_PROTOCOL');
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

describe('utf8ByteLength (size cap is in bytes, spec §7.2.2)', () => {
  it('counts multibyte characters as bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('あ')).toBe(3);
    expect(BODY_SIZE_CAP_BYTES).toBe(262144);
  });
});
