/** @vitest-environment happy-dom */
/**
 * H1 end-to-end parity: 入力 → Enter で吹き出し追記 + localStorage 永続、
 * #タグのチップ表示、日付セパレータ + 📋 コピー(degrade)、削除、絵文字/タグの
 * カーソル挿入、projection 受信で接続表示。pkc-ext 実 wire を fake host で駆動。
 *
 * create は R5(propose)待ちで degrade — このツールは write を一切送らないこと、
 * 日次ログのコピー導線が機能することを担保する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountChatJournal } from '../../tools/h1-chat-journal/src/main';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;
function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return { data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg }, origin: window.location.origin, source: hostWin as unknown as MessageEventSource };
}
const PROJECTION = { containerId: 'c', title: 't', entries: [], relations: [], stats: { totalEntries: 0, byArchetype: {}, totalRelations: 0, totalAssets: 0 } };

let root: HTMLElement;
let channel: ExtChannel;

beforeEach(() => {
  sentToHost.length = 0;
  window.localStorage.clear();
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountChatJournal(root).channel;
  channel.attach(hostWin);
});
afterEach(() => {
  root.remove();
  window.localStorage.clear();
});

const region = (n: string): HTMLElement => root.querySelector(`[data-pkc-region="${n}"]`)!;
const input = (): HTMLTextAreaElement => root.querySelector('[data-pkc-field="chat-input"]') as HTMLTextAreaElement;
function typeAndSend(text: string): void {
  const i = input();
  i.value = text;
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('送信と描画', () => {
  it('Enter で吹き出しが追記され、入力欄が空になる', () => {
    typeAndSend('はじめてのメモ');
    const bubbles = region('chat-log').querySelectorAll('.pkc-chat-text');
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]!.textContent).toBe('はじめてのメモ');
    expect(input().value).toBe('');
  });

  it('#タグはチップとして表示される', () => {
    typeAndSend('進捗 #log #idea');
    const tags = [...region('chat-log').querySelectorAll('.pkc-chat-tag')].map((e) => e.textContent);
    expect(tags).toEqual(['#log', '#idea']);
  });

  it('Shift+Enter は送信しない(改行)', () => {
    const i = input();
    i.value = '途中';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(region('chat-log').querySelectorAll('.pkc-chat-text').length).toBe(0);
  });

  it('日付セパレータが出る', () => {
    typeAndSend('きょう');
    expect(region('chat-log').querySelector('.pkc-chat-daysep')).not.toBeNull();
  });

  it('✕ で削除できる', () => {
    typeAndSend('消す');
    (region('chat-log').querySelector('.pkc-chat-del') as HTMLElement).click();
    expect(region('chat-log').querySelectorAll('.pkc-chat-text').length).toBe(0);
  });
});

describe('localStorage 永続', () => {
  it('再マウントで復元される', () => {
    typeAndSend('永続するメモ');
    root.remove();
    root = document.createElement('div');
    document.body.appendChild(root);
    mountChatJournal(root);
    expect(region('chat-log').querySelector('.pkc-chat-text')!.textContent).toBe('永続するメモ');
  });
});

describe('絵文字 / タグのカーソル挿入', () => {
  it('絵文字ボタンで入力欄に挿入される', () => {
    const emoji = root.querySelector('.pkc-chat-emoji') as HTMLElement;
    emoji.click();
    expect(input().value.length).toBeGreaterThan(0);
  });
  it('#タグボタンで # 付きトークンが入る', () => {
    const tagBtn = root.querySelector('.pkc-chat-tagbtn') as HTMLElement;
    tagBtn.click();
    expect(input().value.startsWith('#')).toBe(true);
  });
});

describe('degrade: write を一切送らない / 日次コピー', () => {
  it('projection を受けても write は送らない(create は R5 待ち)', () => {
    channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
    typeAndSend('記録だけ');
    expect(sentToHost.filter((m) => m['t'] === 'write')).toHaveLength(0);
  });

  it('📋 で日次ログがクリップボードへ渡る', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    typeAndSend('コピー対象');
    (region('chat-log').querySelector('.pkc-chat-daycopy') as HTMLElement).click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0]![0] as string)).toContain('コピー対象');
  });

  it('projection 受信で接続表示になる', () => {
    channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
    expect(region('chat-status').textContent).toContain('接続');
  });
});
