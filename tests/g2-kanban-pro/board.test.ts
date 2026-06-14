/** @vitest-environment happy-dom */
/**
 * G2 end-to-end parity: projection → 2 列描画(archived 除外 / past due)、
 * カード D&D → set-todo-status write op、同列ドロップは no-op、selected push、
 * write-result。pkc-ext の実 wire を fake host で駆動。
 *
 * 注: D&D は視覚機能のため実ブラウザ smoke が別途必要(壁 #71)。本テストは
 * drop ハンドラ → write op 構築の配線正当性を担保する(happy-dom)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountKanbanPro } from '../../tools/g2-kanban-pro/src/main';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;

function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return { data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg }, origin: window.location.origin, source: hostWin as unknown as MessageEventSource };
}

const todayPast = '2000-01-01'; // 既に過ぎている期日(past due を必ず発火)
const PROJECTION = {
  containerId: 'c', title: 'やること',
  entries: [
    { lid: 'o1', title: '締切タスク', archetype: 'todo', created_at: '', updated_at: '2026-06-03T00:00:00Z', todo: { status: 'open', date: todayPast } },
    { lid: 'o2', title: '通常タスク', archetype: 'todo', created_at: '', updated_at: '2026-06-05T00:00:00Z', todo: { status: 'open' } },
    { lid: 'd1', title: '済タスク', archetype: 'todo', created_at: '', updated_at: '2026-06-04T00:00:00Z', todo: { status: 'done' } },
    { lid: 'arch', title: '隠しタスク', archetype: 'todo', created_at: '', updated_at: '', todo: { status: 'open', archived: true } },
    { lid: 'note', title: 'ただのメモ', archetype: 'text', created_at: '', updated_at: '' },
  ],
  relations: [], links: { internal: [], external: [] },
  stats: { totalEntries: 5, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
};

let root: HTMLElement;
let channel: ExtChannel;

beforeEach(() => {
  sentToHost.length = 0;
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountKanbanPro(root).channel;
  channel.attach(hostWin);
  channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
});
afterEach(() => root.remove());

const region = (n: string): HTMLElement => root.querySelector(`[data-pkc-region="${n}"]`)!;
const writes = (): Array<Record<string, unknown>> => sentToHost.filter((m) => m['t'] === 'write');
const colCards = (status: string): string[] =>
  [...region(`kanban-col-${status}`).querySelectorAll('[data-pkc-lid]')].map((c) => c.getAttribute('data-pkc-lid')!);

function drop(lid: string, toStatus: string): void {
  const card = root.querySelector(`[data-pkc-lid="${lid}"]`) as HTMLElement;
  card.dispatchEvent(new Event('dragstart', { bubbles: true }));
  region(`kanban-col-${toStatus}`).dispatchEvent(new Event('drop', { bubbles: true }));
}

describe('列描画', () => {
  it('open/done に分かれ、archived todo と非 todo は出ない', () => {
    expect(colCards('open')).toEqual(['o1', 'o2']);
    expect(colCards('done')).toEqual(['d1']);
    expect(root.querySelector('[data-pkc-lid="arch"]')).toBeNull();
    expect(root.querySelector('[data-pkc-lid="note"]')).toBeNull();
  });
  it('期日超過の open は past due 強調', () => {
    const o1date = root.querySelector('[data-pkc-lid="o1"] .pkc-kanban-date')!;
    expect(o1date.classList.contains('pkc-kanban-pastdue')).toBe(true);
  });
});

describe('D&D → set-todo-status', () => {
  it('open カードを done 列にドロップで done を送る', () => {
    drop('o2', 'done');
    expect(writes()[0]!['ops']).toEqual([{ op: 'set-todo-status', lid: 'o2', status: 'done' }]);
    expect(typeof writes()[0]!['correlation_id']).toBe('string');
  });
  it('done カードを open 列にドロップで open を送る', () => {
    drop('d1', 'open');
    expect(writes()[0]!['ops']).toEqual([{ op: 'set-todo-status', lid: 'd1', status: 'open' }]);
  });
  it('同じ列へのドロップは no-op(write を送らない)', () => {
    drop('o2', 'open');
    expect(writes().length).toBe(0);
  });
});

describe('選択同期 / write-result', () => {
  it('host の selected でカードがハイライト', () => {
    channel.handleMessage(fromHost({ t: 'selected', lid: 'o1' }));
    expect(root.querySelector('[data-pkc-lid="o1"]')!.classList.contains('pkc-kanban-selected')).toBe(true);
  });
  it('write-result ok=false で拒否ステータス', () => {
    drop('o2', 'done');
    const cid = writes()[0]!['correlation_id'] as string;
    channel.handleMessage(fromHost({ t: 'write-result', ok: false, correlation_id: cid }));
    expect(region('kanban-status').textContent).toContain('拒否');
  });
});
