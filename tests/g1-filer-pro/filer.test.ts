/** @vitest-environment happy-dom */
/**
 * G1 filer-pro end-to-end parity: projection → tree+list 描画、entry click →
 * hint(select/open)、D&D drop → write op move、relate フロー、selected push、
 * write-result。pkc-ext の実 wire(ExtChannel)を fake host で駆動する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFilerPro } from '../../tools/g1-filer-pro/src/main';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;

function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return {
    data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg },
    origin: window.location.origin,
    source: hostWin as unknown as MessageEventSource,
  };
}

const PROJECTION = {
  containerId: 'c', title: 'マイ PKC',
  entries: [
    { lid: 'work', title: '仕事', archetype: 'folder', created_at: '', updated_at: '' },
    { lid: 'home', title: '私生活', archetype: 'folder', created_at: '', updated_at: '' },
    { lid: 'a', title: 'メモA', archetype: 'text', created_at: '', updated_at: '2026-06-03T00:00:00Z', folder: 'work', tags: ['urgent'] },
    { lid: 'b', title: 'タスクB', archetype: 'todo', created_at: '', updated_at: '2026-06-05T00:00:00Z', folder: 'home' },
    { lid: 'loose', title: '未整理', archetype: 'text', created_at: '', updated_at: '2026-06-02T00:00:00Z' },
  ],
  relations: [],
  links: { internal: [], external: [] },
  stats: { totalEntries: 5, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
};

let root: HTMLElement;
let channel: ExtChannel;

beforeEach(() => {
  sentToHost.length = 0;
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountFilerPro(root).channel;
  channel.attach(hostWin); // fake host を結線(hello 送出)
  channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION })); // TOFU pin + onProjection
});

afterEach(() => {
  root.remove();
});

const region = (name: string): HTMLElement => root.querySelector(`[data-pkc-region="${name}"]`)!;
const writes = (): Array<Record<string, unknown>> => sentToHost.filter((m) => m['t'] === 'write');
const hints = (): Array<Record<string, unknown>> => sentToHost.filter((m) => m['t'] === 'hint');

describe('projection 描画', () => {
  it('ツリー(すべて/未整理 + フォルダ)と一覧が出る', () => {
    const tree = region('filer-tree');
    expect(tree.textContent).toContain('すべて');
    expect(tree.textContent).toContain('未整理');
    expect(tree.querySelectorAll('[data-pkc-folder]').length).toBe(2); // work, home
    // 既定 scope = すべて → 全 entry(フォルダ除く)
    expect(region('filer-list').querySelectorAll('[data-pkc-lid]').length).toBe(3);
  });

  it('フォルダをクリックすると一覧がそのフォルダに絞られる', () => {
    const workRow = root.querySelector<HTMLElement>('[data-pkc-folder="work"]')!;
    workRow.click();
    const rows = region('filer-list').querySelectorAll('[data-pkc-lid]');
    expect([...rows].map((r) => r.getAttribute('data-pkc-lid'))).toEqual(['a']);
  });
});

describe('選択同期(hint)', () => {
  it('名前ダブルクリック → hint open(即時)', () => {
    const nameA = root.querySelector('[data-pkc-lid="a"] .pkc-filer-entryname') as HTMLElement;
    nameA.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(hints().some((h) => h['kind'] === 'open' && h['lid'] === 'a')).toBe(true);
  });

  it('名前シングルクリック → hint select(debounce 後)', () => {
    vi.useFakeTimers();
    const nameB = root.querySelector('[data-pkc-lid="b"] .pkc-filer-entryname') as HTMLElement;
    nameB.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(250);
    vi.useRealTimers();
    expect(hints().some((h) => h['kind'] === 'select' && h['lid'] === 'b')).toBe(true);
  });
});

describe('D&D 移動 → write op move', () => {
  it('entry を dragstart → フォルダ row に drop で move を送る', () => {
    const rowA = root.querySelector('[data-pkc-lid="a"]') as HTMLElement;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const homeRow = root.querySelector('[data-pkc-folder="home"]') as HTMLElement;
    homeRow.dispatchEvent(new Event('drop', { bubbles: true }));
    const w = writes()[0]!;
    expect(w['ops']).toEqual([{ op: 'move', lid: 'a', folderLid: 'home' }]);
    expect(typeof w['correlation_id']).toBe('string');
  });
});

describe('関連付け → write op relate', () => {
  it('2 つの 🔗 を順にクリックすると relate を送る', () => {
    const relA = root.querySelector('[data-pkc-lid="a"] [data-pkc-action="relate"]') as HTMLElement;
    const relB = root.querySelector('[data-pkc-lid="b"] [data-pkc-action="relate"]') as HTMLElement;
    relA.click();
    relB.click();
    expect(writes()[0]!['ops']).toEqual([{ op: 'relate', from: 'a', to: 'b' }]);
  });
});

describe('selected push / write-result', () => {
  it('host の selected で行がハイライトされる', () => {
    channel.handleMessage(fromHost({ t: 'selected', lid: 'b' }));
    expect(root.querySelector('[data-pkc-lid="b"]')!.classList.contains('pkc-filer-selected')).toBe(true);
  });

  it('write-result ok=false で拒否ステータス', () => {
    const rowA = root.querySelector('[data-pkc-lid="a"]') as HTMLElement;
    rowA.dispatchEvent(new Event('dragstart', { bubbles: true }));
    (root.querySelector('[data-pkc-folder="home"]') as HTMLElement).dispatchEvent(new Event('drop', { bubbles: true }));
    const cid = writes()[0]!['correlation_id'] as string;
    channel.handleMessage(fromHost({ t: 'write-result', ok: false, correlation_id: cid }));
    expect(region('filer-status').textContent).toContain('拒否');
  });
});
