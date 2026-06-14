/**
 * todo 派生メタ(PKC2#831 / RFC #830 R1)の読み取り + 共通ヘルパー。
 * G2 kanban-pro / G3 calendar-pro が共用する単一ソース。
 *
 * projection の `ProjectionEntry.todo` は host が body から派生した
 * `{ status, date?, archived? }`(**description は含まない**)。受信値は
 * 防御的に検証してから使う。
 */

import type { ProjectionEntry } from './ext-channel';

export type TodoStatus = 'open' | 'done';
export interface TodoMeta {
  status: TodoStatus;
  date?: string; // YYYY-MM-DD
  archived?: boolean;
}

/** 防御的に todo メタを読む。todo でない / 壊れていれば null。Pure. */
export function todoMeta(e: ProjectionEntry): TodoMeta | null {
  if (e.archetype !== 'todo' || !e.todo) return null;
  const raw = e.todo;
  const status: TodoStatus | null = raw.status === 'done' ? 'done' : raw.status === 'open' ? 'open' : null;
  if (status === null) return null;
  const m: TodoMeta = { status };
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) m.date = raw.date;
  if (raw.archived === true) m.archived = true;
  return m;
}

/** ローカル日付の YYYY-MM-DD。Pure(引数で固定可能)。 */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** open かつ期日が今日より前。Pure. */
export function isPastDue(e: ProjectionEntry, today: string): boolean {
  const m = todoMeta(e);
  return m !== null && m.status === 'open' && m.date !== undefined && m.date < today;
}

/** PKC2 host の WriteOp 形に厳密一致(write.ts、R2 / PKC2#832)。 */
export function setStatusOp(lid: string, status: TodoStatus): { op: 'set-todo-status'; lid: string; status: TodoStatus } {
  return { op: 'set-todo-status', lid, status };
}
