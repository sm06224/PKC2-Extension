/** @vitest-environment happy-dom */
/**
 * G3 end-to-end parity: projection → カレンダー描画(期日配置 / past due /
 * archived 既定除外)、チェックで set-todo-status、月移動、showArchived、
 * selected push、write-result。pkc-ext 実 wire を fake host で駆動。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountCalendarPro } from '../../tools/g3-calendar-pro/src/main';
import { monthOf } from '../../tools/g3-calendar-pro/src/calendar';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;
function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return { data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg }, origin: window.location.origin, source: hostWin as unknown as MessageEventSource };
}

// このテストの「今月」に必ず入る日付を使う(月跨ぎで落ちないように動的生成)
const THIS_MONTH = monthOf(new Date()); // YYYY-MM
const D10 = `${THIS_MONTH}-10`;
const D20 = `${THIS_MONTH}-20`;
const PAST = '2000-01-05';

const PROJECTION = {
  containerId: 'c', title: '予定',
  entries: [
    { lid: 'open10', title: '今月の予定', archetype: 'todo', created_at: '', updated_at: '', todo: { status: 'open', date: D10 } },
    { lid: 'done20', title: '済んだ予定', archetype: 'todo', created_at: '', updated_at: '', todo: { status: 'done', date: D20 } },
    { lid: 'past', title: '遅れてる', archetype: 'todo', created_at: '', updated_at: '', todo: { status: 'open', date: PAST } },
    { lid: 'arch', title: 'アーカイブ', archetype: 'todo', created_at: '', updated_at: '', todo: { status: 'open', date: D10, archived: true } },
    { lid: 'note', title: 'メモ', archetype: 'text', created_at: '', updated_at: '' },
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
  channel = mountCalendarPro(root).channel;
  channel.attach(hostWin);
  channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
});
afterEach(() => root.remove());

const region = (n: string): HTMLElement => root.querySelector(`[data-pkc-region="${n}"]`)!;
const writes = (): Array<Record<string, unknown>> => sentToHost.filter((m) => m['t'] === 'write');
// 同 lid はカレンダーとアジェンダの両方に出るので first を取る
const chip = (lid: string): HTMLElement => root.querySelector(`[data-pkc-lid="${lid}"]`) as HTMLElement;

describe('カレンダー描画', () => {
  it('当月の期日に todo が配置され、archived と非 todo は既定で出ない', () => {
    expect(region('cal-grid').querySelector(`[data-pkc-date="${D10}"] [data-pkc-lid="open10"]`)).not.toBeNull();
    expect(chip('arch')).toBeNull(); // showArchived OFF
    expect(chip('note')).toBeNull(); // 非 todo
  });
  it('past due の open は強調クラス', () => {
    // 過去日はカレンダーには当月外だが、アジェンダには出る(期日付き全件)
    const pastChip = region('cal-agenda').querySelector('[data-pkc-lid="past"]')!;
    expect(pastChip.classList.contains('pkc-cal-pastdue')).toBe(true);
  });
  it('done はアジェンダで取り消し線クラス', () => {
    expect(region('cal-agenda').querySelector('[data-pkc-lid="done20"]')!.classList.contains('pkc-cal-done')).toBe(true);
  });
});

describe('チェックで set-todo-status', () => {
  it('open の todo のチェック → done を送る', () => {
    (chip('open10').querySelector('[data-pkc-action="toggle-done"]') as HTMLElement).click();
    expect(writes()[0]!['ops']).toEqual([{ op: 'set-todo-status', lid: 'open10', status: 'done' }]);
  });
  it('done の todo のチェック解除 → open を送る', () => {
    (chip('done20').querySelector('[data-pkc-action="toggle-done"]') as HTMLElement).click();
    expect(writes()[0]!['ops']).toEqual([{ op: 'set-todo-status', lid: 'done20', status: 'open' }]);
  });
});

describe('showArchived / selected / write-result', () => {
  it('アーカイブ表示 ON で archived も出る', () => {
    const toggle = root.querySelector('[data-pkc-field="cal-archived"]') as HTMLElement;
    toggle.click();
    expect(chip('arch')).not.toBeNull();
  });
  it('selected でハイライト', () => {
    channel.handleMessage(fromHost({ t: 'selected', lid: 'open10' }));
    expect(chip('open10').classList.contains('pkc-cal-selected')).toBe(true);
  });
  it('write-result ok=false で拒否ステータス', () => {
    (chip('open10').querySelector('[data-pkc-action="toggle-done"]') as HTMLElement).click();
    const cid = writes()[0]!['correlation_id'] as string;
    channel.handleMessage(fromHost({ t: 'write-result', ok: false, correlation_id: cid }));
    expect(region('cal-status').textContent).toContain('拒否');
  });
});
