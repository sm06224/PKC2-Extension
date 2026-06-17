/** @vitest-environment happy-dom */
/**
 * pkc-ext v1 child channel — ホスト実装(PKC2#816 extension-channel.ts)の
 * wire 契約に対する鏡像テスト。identity + nonce の防御も検証する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ExtChannel,
  CAP_CORE_RENDER,
  parseDeliver,
  parseProjection,
  parseRenderResult,
  parseStylesheet,
  type ContainerProjection,
  type DeliverPayload,
  type RenderResult,
  type StylesheetPayload,
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

  it('parseRenderResult: ok + html + headings + correlation を取り込む(SR-18)', () => {
    const r = parseRenderResult({
      ok: true,
      html: '<h1>x</h1>',
      engine_version: '1.2.0',
      headings: [{ level: 1, text: 'x' }, { bad: 1 }],
      correlation_id: 'r-1',
    });
    expect(r).toMatchObject({ ok: true, html: '<h1>x</h1>', engineVersion: '1.2.0', correlationId: 'r-1' });
    expect(r?.headings?.length).toBe(1);
  });

  it('parseRenderResult: ok 欠落 / 非 object は null', () => {
    expect(parseRenderResult({ html: 'x' })).toBeNull();
    expect(parseRenderResult('x')).toBeNull();
  });

  it('parseStylesheet: css 必須、engine_version は任意', () => {
    expect(parseStylesheet({ css: 'body{}', engine_version: '1.2.0' })).toEqual({ css: 'body{}', engineVersion: '1.2.0' });
    expect(parseStylesheet({ css: 'body{}' })).toEqual({ css: 'body{}', engineVersion: '' });
    expect(parseStylesheet({ engine_version: '1' })).toBeNull();
  });
});

describe('SR-18 ホスト・レンダーサービス(借用 render の wire)', () => {
  let renderResults: RenderResult[];
  let stylesheets: StylesheetPayload[];
  let rch: ExtChannel;

  beforeEach(() => {
    sentToHost.length = 0;
    renderResults = [];
    stylesheets = [];
    rch = new ExtChannel(
      {
        onRenderResult: (r) => renderResults.push(r),
        onStylesheet: (s) => stylesheets.push(s),
      },
      { capabilities: [CAP_CORE_RENDER] },
    );
    rch.attach(hostWin);
  });

  it('hello は申告した capability を載せる', () => {
    const hello = sentToHost[0] as Record<string, unknown>;
    expect(hello['t']).toBe('hello');
    expect(hello['capabilities']).toEqual(['core-render']);
  });

  it('sendRenderRequest は establish 前 false、後は source + opts + correlation + nonce を載せる', () => {
    expect(rch.sendRenderRequest('# x', 'r-1')).toBe(false);
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    sentToHost.length = 0;
    expect(rch.sendRenderRequest('# x', 'r-1', { surface: 'reader', toc: true }, false)).toBe(true);
    const req = sentToHost[0] as Record<string, unknown>;
    expect(req['t']).toBe('render-request');
    expect(req['source']).toBe('# x');
    expect(req['correlation_id']).toBe('r-1');
    expect(req['opts']).toEqual({ surface: 'reader', toc: true });
    expect(req['want_css']).toBe(false);
    expect(req['nonce']).toBe('n-1');
  });

  it('render-result(nest 形)が correlation 付きでコールバックに届く', () => {
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    rch.handleMessage(fromHost({
      nonce: 'n-1',
      t: 'render-result',
      result: { ok: true, html: '<p>hi</p>', engine_version: '1.2.0', correlation_id: 'r-1' },
    }));
    expect(renderResults[0]).toMatchObject({ ok: true, html: '<p>hi</p>', correlationId: 'r-1' });
  });

  it('render-result(top-level 形)も受ける(host 実装未確定への寛容)', () => {
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'render-result', ok: false, reason: 'boom', correlation_id: 'r-2' }));
    expect(renderResults[0]).toMatchObject({ ok: false, reason: 'boom', correlationId: 'r-2' });
  });

  it('stylesheet(top-level css)が借用 CSS としてコールバックに届く', () => {
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
    rch.handleMessage(fromHost({ nonce: 'n-1', t: 'stylesheet', css: 'body{color:red}', engine_version: '1.2.0' }));
    expect(stylesheets[0]).toEqual({ css: 'body{color:red}', engineVersion: '1.2.0' });
  });

  it('capability 未申告だと hello に capabilities を載せない(後方互換)', () => {
    sentToHost.length = 0;
    const plain = new ExtChannel({});
    plain.attach(hostWin);
    const hello = sentToHost[0] as Record<string, unknown>;
    expect('capabilities' in hello).toBe(false);
  });
});
