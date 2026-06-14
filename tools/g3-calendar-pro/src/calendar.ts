/**
 * G3 calendar-pro の純関数モデル (issue #107)。
 *
 * R1(PKC2#831)の projection todo メタ `{status,date?,archived?}` を使い、
 * 月カレンダーに todo を期日(`todo.date`)で配置する。past due = status open
 * かつ期日 < 今日。本体パリティ: archived の表示は `showArchived` フラグ依存。
 *
 * 純関数のみ(描画は main、書き戻しは R2 set-todo-status を流用)。
 */

import type { ContainerProjection, ProjectionEntry } from '../../shared/ext-channel';
import { todoMeta } from '../../shared/todo-meta';

export { todoMeta, todayISO, isPastDue, setStatusOp } from '../../shared/todo-meta';

export interface CalDay {
  date: string; // YYYY-MM-DD
  day: number; // 1..31
  inMonth: boolean;
  isToday: boolean;
  weekday: number; // 0=Sun .. 6=Sat
  todos: ProjectionEntry[];
}

/** YYYY-MM の妥当性。Pure. */
export function isYearMonth(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

/** 月を ±n する(YYYY-MM)。Pure. */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map((s) => Number.parseInt(s, 10));
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Date → YYYY-MM。Pure. */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** その月の todo を date 別に集約(YYYY-MM-DD → entries)。Pure. */
export function todosByDate(
  p: ContainerProjection,
  opts: { showArchived: boolean } = { showArchived: false },
): Map<string, ProjectionEntry[]> {
  const map = new Map<string, ProjectionEntry[]>();
  for (const e of p.entries) {
    const m = todoMeta(e);
    if (!m || m.date === undefined) continue;
    if (m.archived && !opts.showArchived) continue;
    const arr = map.get(m.date) ?? [];
    arr.push(e);
    map.set(m.date, arr);
  }
  return map;
}

/**
 * 月グリッド(週開始 = 日曜)。前後の月の日も埋めて 6 週 × 7 = 42 マス。
 * `today` は強調用(YYYY-MM-DD)。Pure(weekStart で月/日開始切替)。
 */
export function monthGrid(
  ym: string,
  byDate: Map<string, ProjectionEntry[]>,
  today: string,
  weekStart: 0 | 1 = 0,
): CalDay[] {
  const [y, mo] = ym.split('-').map((s) => Number.parseInt(s, 10));
  const first = new Date(y!, mo! - 1, 1);
  const startOffset = (first.getDay() - weekStart + 7) % 7;
  const gridStart = new Date(y!, mo! - 1, 1 - startOffset);
  const days: CalDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    days.push({
      date,
      day: d.getDate(),
      inMonth: d.getMonth() === mo! - 1 && d.getFullYear() === y!,
      isToday: date === today,
      weekday: d.getDay(),
      todos: byDate.get(date) ?? [],
    });
  }
  return days;
}

/** 期日付き todo を期日昇順に(アジェンダ用)。past due / 今日以降を分けず一覧。Pure. */
export function agenda(
  p: ContainerProjection,
  opts: { showArchived: boolean } = { showArchived: false },
): ProjectionEntry[] {
  return p.entries
    .filter((e) => {
      const m = todoMeta(e);
      return m !== null && m.date !== undefined && (opts.showArchived || !m.archived);
    })
    .sort((a, b) => (todoMeta(a)!.date ?? '').localeCompare(todoMeta(b)!.date ?? ''));
}

/** 曜日ラベル(週開始依存)。Pure. */
export function weekdayLabels(weekStart: 0 | 1 = 0): string[] {
  const base = ['日', '月', '火', '水', '木', '金', '土'];
  return weekStart === 1 ? [...base.slice(1), base[0]!] : base;
}
