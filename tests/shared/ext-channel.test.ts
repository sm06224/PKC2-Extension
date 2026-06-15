/** @vitest-environment happy-dom */
/**
 * pkc-ext v1 child channel — ホスト実装(PKC2#816 extension-channel.ts)の
 * wire 契約に対する鏡像テスト。identity + nonce の防御も検証する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ExtChannel,
  parseDeliver,
  parseProjection,
  type ContainerProjection,
  type DeliverPayload,
} from '../../tools/shared/ext-channel';

const sentToHost: unknown[] = [];
const hostWin = {
  postMessage: (data: unknown): void => {
    sentToHost.push(data);
  },
} as unknown as Window;
const stranger = { postMessage: (): void => undefined } as unknown as Window;

function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return {
    data: { pkc: 'pkc-ext', v: 1, ...msg },
    origin: window.location.origin,
    source: hostWin as unknown as MessageEventSource,
  };
}

const PROJECTION = {
  containerId: 'c-1',
  title: 'テスト',
  entries: [{ lid: 'e1', title: 'メモ', archetype: 'text', created_at: '', updated_at: '' }],
  relations: [],
  stats: { totalEntries: 1, byArchetype: { text: 1 }, totalRelations: 0, totalAssets: 0 },
};

let received: {
  projections: ContainerProjection[];
  delivers: DeliverPayload[];
  writeResults: Array<{ ok: boolean; cid: string | null }>;
  proposeResults: Array<{ accepted: boolean; lid: string | null; cid: string | null }>;
};
let ch: ExtChannel;

beforeEach(() => {
  sentToHost.length = 0;
  received = { projections: [], delivers: [], writeResults: [], proposeResults: [] };
  ch = new ExtChannel({
    onProjection: (p) => received.projections.push(p),
    onDeliver: (d) => received.delivers.push(d),
    onWriteResult: (ok, cid) => received.writeResults.push({ ok, cid }),
    onProposeResult: (accepted, lid, cid) => received.proposeResults.push({ accepted, lid, cid }),
  });
  ch.attach(hostWin);
});

describe('handshake + TOFU pinning(PKC2#821/#823 追従)', () => {
  it('attach sends hello (no nonce yet)', () => {
    const hello = sentToHost[0] as Record<string, unknown>;
    expect(hello['pkc']).toBe('pkc-ext');
    expect(hello['t']).toBe('hello');
    expect('nonce' in hello).toBe(false);
    expect(ch.isEstablished()).toBe(false);
  });

  it('pins source + nonce from the first valid projection and rejects other nonces after', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    expect(ch.isEstablished()).toBe(true);
    expect(received.projections.length).toBe(1);
    // 異なる nonce は無視される
    ch.handleMessage(fromHost({ nonce: 'n-EVIL', t: 'deliver', payload: { kind: 'entry', lid: 'x', body: 'b' } }));
    expect(received.delivers.length).toBe(0);
  });

  it('pin 前の deliver / write-result は無視(pin は projection のみ)', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'deliver', payload: { kind: 'entry', lid: 'x', body: 'b' } }));
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'write-result', ok: true }));
    expect(ch.isEstablished()).toBe(false);
    expect(received.delivers.length).toBe(0);
    expect(received.writeResults.length).toBe(0);
  });

  it('Tier S: 送信先(parent/shell)と異なる source からの push を TOFU で受理する', () => {
    // attach 先 = hostWin(shell 相当)だが、push は別 window(host main)から届く
    const hostMain = { postMessage: (): void => undefined } as unknown as Window;
    ch.handleMessage({
      data: { pkc: 'pkc-ext', v: 1, nonce: 'n-S', t: 'projection', projection: PROJECTION },
      origin: window.location.origin,
      source: hostMain as unknown as MessageEventSource,
    });
    expect(ch.isEstablished()).toBe(true);
    expect(received.projections.length).toBe(1);
    // pin 後は正しい nonce でも別 window を拒否
    ch.handleMessage({
      data: { pkc: 'pkc-ext', v: 1, nonce: 'n-S', t: 'deliver', payload: { kind: 'entry', lid: 'x', body: 'b' } },
      origin: window.location.origin,
      source: stranger as unknown as MessageEventSource,
    });
    expect(received.delivers.length).toBe(0);
    // pin した window からは通る
    ch.handleMessage({
      data: { pkc: 'pkc-ext', v: 1, nonce: 'n-S', t: 'deliver', payload: { kind: 'entry', lid: 'x', body: 'b' } },
      origin: window.location.origin,
      source: hostMain as unknown as MessageEventSource,
    });
    expect(received.delivers.length).toBe(1);
  });

  it('pin 後は正しい nonce でも別 window からのメッセージを拒否する', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    ch.handleMessage({
      data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', t: 'projection', projection: PROJECTION },
      origin: window.location.origin,
      source: stranger as unknown as MessageEventSource,
    });
    expect(received.projections.length).toBe(1);
  });
});

describe('host-push receive', () => {
  beforeEach(() => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
  });

  it('deliver (asset) reaches the callback with parsed fields', () => {
    ch.handleMessage(fromHost({
      nonce: 'n-1',
      t: 'deliver',
      payload: { kind: 'asset', lid: 'e2', asset_key: 'a1', mime: 'application/pdf', filename: 'x.pdf', data_base64: 'QUJD' },
    }));
    expect(received.delivers[0]).toMatchObject({ kind: 'asset', asset_key: 'a1', mime: 'application/pdf', data_base64: 'QUJD' });
  });

  it('write-result reaches the callback with correlation id', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'write-result', ok: true, correlation_id: 'c-9' }));
    expect(received.writeResults[0]).toEqual({ ok: true, cid: 'c-9' });
  });

  it('propose-result (#830 R5): accept は assigned_lid 付きでコールバックに届く', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'propose-result', accepted: true, assigned_lid: 'L42', correlation_id: 'p-1' }));
    expect(received.proposeResults[0]).toEqual({ accepted: true, lid: 'L42', cid: 'p-1' });
  });

  it('propose-result: reject は accepted=false / lid=null', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'propose-result', accepted: false, correlation_id: 'p-2' }));
    expect(received.proposeResults[0]).toEqual({ accepted: false, lid: null, cid: 'p-2' });
  });

  it('garbage payloads are dropped, channel keeps working', () => {
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'deliver', payload: { kind: 'nope' } }));
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: 42 }));
    expect(received.delivers.length).toBe(0);
    expect(received.projections.length).toBe(1); // 最初の 1 件のみ
  });
});

describe('ext → host send (nonce 同梱)', () => {
  it('write / hint are blocked before establish, carry the nonce after', () => {
    expect(ch.sendWrite([{ op: 'x' }], 'e1', 'c-1')).toBe(false);
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    sentToHost.length = 0;
    expect(ch.sendWrite([{ op: 'x' }], 'e1', 'c-1')).toBe(true);
    expect(ch.sendHint('open', 'e1')).toBe(true);
    const w = sentToHost[0] as Record<string, unknown>;
    expect(w['t']).toBe('write');
    expect(w['nonce']).toBe('n-1');
    expect(w['correlation_id']).toBe('c-1');
    const h = sentToHost[1] as Record<string, unknown>;
    expect(h['t']).toBe('hint');
    expect(h['kind']).toBe('open');
  });

  it('propose は establish 前は false、後は offer + nonce + correlation_id 同梱', () => {
    expect(ch.sendPropose({ title: 't', body: 'b' }, 'p-1')).toBe(false);
    ch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    sentToHost.length = 0;
    expect(ch.sendPropose({ title: '日次', body: '{}', archetype: 'textlog' }, 'p-1')).toBe(true);
    const p = sentToHost[0] as Record<string, unknown>;
    expect(p['t']).toBe('propose');
    expect(p['nonce']).toBe('n-1');
    expect(p['correlation_id']).toBe('p-1');
    expect(p['offer']).toEqual({ title: '日次', body: '{}', archetype: 'textlog' });
  });
});

describe('defensive parsers', () => {
  it('parseProjection filters malformed entries', () => {
    const p = parseProjection({ containerId: 'c', entries: [{ lid: 'a', title: 't', archetype: 'text' }, { broken: true }, 7] });
    expect(p?.entries.length).toBe(1);
  });

  it('parseProjection は restoreCandidates / orphanAssets を防御的に取り込む(#830 R4/R8)', () => {
    const p = parseProjection({
      containerId: 'c',
      entries: [],
      restoreCandidates: [{ lid: 'd', title: 'x', archetype: 'text' }, { bad: 1 }],
      orphanAssets: [{ key: 'k', size: 12 }, { key: 'noSize' }, 'x'],
    });
    expect(p?.restoreCandidates).toEqual([{ lid: 'd', title: 'x', archetype: 'text' }]);
    expect(p?.orphanAssets).toEqual([{ key: 'k', size: 12 }]);
  });

  it('parseProjection は欠落時に空配列(古い host 互換)', () => {
    const p = parseProjection({ containerId: 'c', entries: [] });
    expect(p?.restoreCandidates).toEqual([]);
    expect(p?.orphanAssets).toEqual([]);
  });
  it('parseDeliver rejects unknown kinds and non-objects', () => {
    expect(parseDeliver({ kind: 'other' })).toBeNull();
    expect(parseDeliver('x')).toBeNull();
  });
});
