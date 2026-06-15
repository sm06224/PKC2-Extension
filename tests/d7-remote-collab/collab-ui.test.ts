/** @vitest-environment happy-dom */
/**
 * D7 end-to-end parity(fake transport で WebRTC を代替): deliver → 共有候補 /
 * 共有トグル → transport へ share 送出 / 受信 share → 受信欄 → 取り込みで propose /
 * onOpen で hello・接続表示 / unshare 受信で除去。実 WebRTC 疎通はユーザー実機(#71)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountRemoteCollab } from '../../tools/d7-remote-collab/src/main';
import { encodeMsg, parseMsg, type CollabTransport, type SharedItem } from '../../tools/d7-remote-collab/src/collab';
import type { ExtChannel } from '../../tools/shared/ext-channel';

class FakeTransport implements CollabTransport {
  sent: string[] = [];
  private msgCb: ((d: string) => void) | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: (() => void) | null = null;
  send(d: string): void { this.sent.push(d); }
  onMessage(cb: (d: string) => void): void { this.msgCb = cb; }
  onOpen(cb: () => void): void { this.openCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }
  close(): void { this.closeCb?.(); }
  // test drivers
  open(): void { this.openCb?.(); }
  receive(d: string): void { this.msgCb?.(d); }
}

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;
function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return { data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg }, origin: window.location.origin, source: hostWin as unknown as MessageEventSource };
}
const PROJECTION = {
  containerId: 'c', title: 't',
  entries: [{ lid: 'memo1', title: '共有するメモ', archetype: 'text', created_at: '', updated_at: '' }],
  relations: [], stats: { totalEntries: 1, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
};

let root: HTMLElement;
let channel: ExtChannel;
let fake: FakeTransport;

beforeEach(() => {
  sentToHost.length = 0;
  fake = new FakeTransport();
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountRemoteCollab(root, { transport: fake }).channel;
  channel.attach(hostWin);
  channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
});
afterEach(() => root.remove());

const region = (n: string): HTMLElement => root.querySelector(`[data-pkc-region="${n}"]`)!;
const shares = (): Array<Record<string, unknown>> => fake.sent.map((d) => parseMsg(d)).filter((m): m is { t: 'share'; item: SharedItem } => m?.t === 'share');
function deliver(lid: string, body: string): void {
  channel.handleMessage(fromHost({ t: 'deliver', payload: { kind: 'entry', lid, body } }));
}

describe('共有プール(out)', () => {
  it('deliver で共有候補に並ぶ(タイトルは projection 解決)', () => {
    deliver('memo1', '本文です');
    const row = region('collab-pool').querySelector('[data-pkc-share="memo1"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('共有するメモ');
  });

  it('チェックで transport に share を送る', () => {
    fake.open(); // 接続(hello が出る)
    deliver('memo1', '本文です');
    (region('collab-pool').querySelector('[data-pkc-action="share-toggle"]') as HTMLElement).click();
    const s = shares();
    expect(s.length).toBe(1);
    expect(s[0]!.item).toMatchObject({ id: 'memo1', title: '共有するメモ', body: '本文です' });
  });
});

describe('受信(in)→ 取り込み propose', () => {
  it('受信 share が受信欄に出て、取り込みで propose', () => {
    fake.open();
    fake.receive(encodeMsg({ t: 'share', item: { id: 'r1', title: 'もらったメモ', archetype: 'text', body: 'remote 本文' } }));
    const row = region('collab-inbox').querySelector('[data-pkc-inbox="r1"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('もらったメモ');
    (row!.querySelector('[data-pkc-action="import"]') as HTMLElement).click();
    const proposes = sentToHost.filter((m) => m['t'] === 'propose');
    expect(proposes).toHaveLength(1);
    expect((proposes[0]!['offer'] as Record<string, unknown>)['title']).toBe('もらったメモ');
  });

  it('unshare 受信で受信欄から消える', () => {
    fake.open();
    fake.receive(encodeMsg({ t: 'share', item: { id: 'r1', title: 'x', archetype: 'text', body: 'b' } }));
    expect(region('collab-inbox').querySelector('[data-pkc-inbox="r1"]')).not.toBeNull();
    fake.receive(encodeMsg({ t: 'unshare', id: 'r1' }));
    expect(region('collab-inbox').querySelector('[data-pkc-inbox="r1"]')).toBeNull();
  });
});

describe('接続 / 表示', () => {
  it('onOpen で hello を送り、接続表示になる', () => {
    fake.open();
    const hello = fake.sent.map((d) => parseMsg(d)).find((m) => m?.t === 'hello');
    expect(hello).toBeTruthy();
    expect(region('collab-peer').textContent).toContain('接続中');
  });
  it('hello 受信で peer 名を表示', () => {
    fake.open();
    fake.receive(encodeMsg({ t: 'hello', name: 'ボブ' }));
    expect(region('collab-peer').textContent).toContain('ボブ');
  });
  it('外部通信の警告が出ている', () => {
    expect(region('collab-warn').textContent).toContain('外部');
  });
});
