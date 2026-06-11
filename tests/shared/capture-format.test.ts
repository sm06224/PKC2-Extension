/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { buildCaptureFile, CAPTURE_EVENT_CAP, parseCaptureText } from '../../tools/shared/capture-format';
import { selectReplayable } from '../../tools/a5-replay-player/src/main';
import { capabilityUnion } from '../../tools/a3-capability-matrix/src/main';

const ev = (over: Record<string, unknown>): Record<string, unknown> => ({
  at: '2026-06-11T00:00:00.000Z',
  direction: 'out',
  origin: '-',
  viaHost: true,
  kind: 'pkc',
  type: 'record:offer',
  data: { protocol: 'pkc-message' },
  ...over,
});

describe('capture-format', () => {
  it('A4 ファイルを roundtrip できる', () => {
    const file = buildCaptureFile('ext:test', [ev({}) as never]);
    const r = parseCaptureText(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events.length).toBe(1);
      expect(r.events[0]?.type).toBe('record:offer');
    }
  });

  it('A1 Copy All(配列)も受理し、info 行や junk は読み飛ばす', () => {
    const r = parseCaptureText(JSON.stringify([ev({}), { direction: 'info', data: 'note' }, 42, null, ev({ direction: 'in', kind: 'pkc-invalid' })]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events.length).toBe(2);
      expect(r.events[1]?.kind).toBe('pkc'); // pkc-invalid は pkc に正規化
    }
  });

  it('壊れた入力・未知 format・上限超過を安全に弾く', () => {
    expect(parseCaptureText('{oops').ok).toBe(false);
    expect(parseCaptureText(JSON.stringify({ format: 'other', version: 1, events: [] })).ok).toBe(false);
    const big = JSON.stringify(Array.from({ length: CAPTURE_EVENT_CAP + 1 }, () => ev({})));
    expect(parseCaptureText(big).ok).toBe(false);
  });
});

describe('A5 selectReplayable', () => {
  const events = [
    ev({}),
    ev({ direction: 'in', type: 'pong' }),
    ev({ kind: 'foreign', type: 'graph:hello' }),
  ] as never[];

  it('既定は送信方向の PKC のみ', () => {
    expect(selectReplayable(events, { includeInbound: false, includeForeign: false }).length).toBe(1);
  });
  it('toggle で in / foreign を含められる', () => {
    expect(selectReplayable(events, { includeInbound: true, includeForeign: false }).length).toBe(2);
    expect(selectReplayable(events, { includeInbound: true, includeForeign: true }).length).toBe(3);
  });
});

describe('A3 capabilityUnion', () => {
  it('接続済み profile の capabilities を合算・整列する', () => {
    expect(
      capabilityUnion([
        { app_id: 'a', version: '1', schema_version: 1, embedded: false, capabilities: ['record:offer'] },
        null,
        { app_id: 'b', version: '2', schema_version: 1, embedded: true, capabilities: ['export:request', 'record:offer'] },
      ]),
    ).toEqual(['export:request', 'record:offer']);
  });
});
