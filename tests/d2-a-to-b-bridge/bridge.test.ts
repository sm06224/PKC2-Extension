/** @vitest-environment happy-dom */
/**
 * D2 のエンドツーエンド parity: A へ offer → A の accept echo →
 * B へ自動転送 → 二重 accept は無視、reject は転送しない。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBridgePayload, ForwardStore, mountBridge, type BridgeMount } from '../../tools/d2-a-to-b-bridge/src/main';
import type { HostLink } from '../../tools/shared/host-link';

const sentToA: Array<Record<string, unknown>> = [];
const sentToB: Array<Record<string, unknown>> = [];
const winA = { postMessage: (d: unknown): void => { sentToA.push(d as Record<string, unknown>); } } as unknown as Window;
const winB = { postMessage: (d: unknown): void => { sentToB.push(d as Record<string, unknown>); } } as unknown as Window;
const linkA: HostLink = { mode: 'iframe', hostWindow: winA, expectedOrigin: 'http://host.test', label: 'A' };
const linkB: HostLink = { mode: 'iframe', hostWindow: winB, expectedOrigin: 'http://host.test', label: 'B' };

let mountResult: BridgeMount;
let root: HTMLElement;

function fromHost(win: Window, type: string, payload: unknown): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return {
    data: { protocol: 'pkc-message', version: 1, type, source_id: null, target_id: 'ext:test', payload, timestamp: new Date().toISOString() },
    origin: 'http://host.test',
    source: win as unknown as MessageEventSource,
  };
}

const pong = { app_id: 'pkc2', version: '1.0.0', schema_version: 1, embedded: true, capabilities: ['record:offer'] };

beforeAll(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  mountResult = mountBridge(root);
  mountResult.connA.attachLink(linkA);
  mountResult.connA.handleMessage(fromHost(winA, 'pong', pong));
  mountResult.connB.attachLink(linkB);
  mountResult.connB.handleMessage(fromHost(winB, 'pong', pong));
});

describe('ForwardStore / payload', () => {
  it('take は除去を伴う(二重転送防止)', () => {
    const s = new ForwardStore();
    s.add({ correlationId: 'c1', title: 't', payload: {} });
    expect(s.take('c1')?.title).toBe('t');
    expect(s.take('c1')).toBeNull();
    expect(s.take('unknown')).toBeNull();
  });

  it('todo payload は body JSON 化', () => {
    const p = buildBridgePayload('todo', 'T', 'D');
    expect(JSON.parse(p['body'] as string)).toEqual({ status: 'open', description: 'D' });
  });
});

describe('A accept → B 転送(end-to-end parity)', () => {
  it('A へ offer → accept echo → B に同一 payload の record:offer', () => {
    root.querySelector<HTMLInputElement>('[data-pkc-field="d2-title"]')!.value = '稟議メモ';
    root.querySelector<HTMLTextAreaElement>('[data-pkc-field="d2-body"]')!.value = '本文';
    sentToA.length = 0;
    sentToB.length = 0;

    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'A へ offer')!.click();
    const offer = sentToA.find((m) => m['type'] === 'record:offer')!;
    expect(offer).toBeDefined();
    const cid = offer['correlation_id'] as string;
    expect(typeof cid).toBe('string');

    // A が accept を echo
    mountResult.connA.handleMessage(fromHost(winA, 'record:accept', { offer_id: 'o-1', assigned_lid: 'lid-9', correlation_id: cid }));

    const forwarded = sentToB.find((m) => m['type'] === 'record:offer')!;
    expect(forwarded).toBeDefined();
    expect(forwarded['payload']).toEqual(offer['payload']);
    const logText = root.querySelector('[data-pkc-region="d2-log"]')!.textContent!;
    expect(logText).toContain('A が "稟議メモ" を受理');
    expect(logText).toContain('B へ転送');

    // 同じ accept がもう一度来ても二重転送しない
    const before = sentToB.length;
    mountResult.connA.handleMessage(fromHost(winA, 'record:accept', { offer_id: 'o-1', assigned_lid: 'lid-9', correlation_id: cid }));
    expect(sentToB.length).toBe(before);
  });

  it('A の reject は転送しない', () => {
    root.querySelector<HTMLInputElement>('[data-pkc-field="d2-title"]')!.value = '却下されるメモ';
    sentToA.length = 0;
    sentToB.length = 0;
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'A へ offer')!.click();
    const cid = (sentToA.find((m) => m['type'] === 'record:offer')!)['correlation_id'] as string;

    mountResult.connA.handleMessage(fromHost(winA, 'record:reject', { offer_id: 'o-2', reason: 'dismiss', correlation_id: cid }));
    expect(sentToB.find((m) => m['type'] === 'record:offer')).toBeUndefined();
    expect(root.querySelector('[data-pkc-region="d2-log"]')!.textContent).toContain('却下');
  });
});
