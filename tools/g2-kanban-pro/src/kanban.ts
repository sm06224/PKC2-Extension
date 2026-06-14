/**
 * G2 kanban-pro の純関数モデル (issue #106)。
 *
 * R1(PKC2#831)で projection の todo に派生メタ `{status,date?,archived?}` が
 * 載るようになったので、open/done 列・期日・past due を **本文を持たずに**
 * 構築できる。本体パリティ: **Kanban は archived todo を常に除外**。
 *
 * write は R2(PKC2#832)の `set-todo-status` op のみ(host 検証・all-or-nothing)。
 */

import type { ContainerProjection, ProjectionEntry } from '../../shared/ext-channel';

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

export interface KanbanFilter {
  query: string;
  folder: string; // '' = all
  tag: string; // '' = all
}

const EMPTY_FILTER: KanbanFilter = { query: '', folder: '', tag: '' };

function matchesFilter(e: ProjectionEntry, f: KanbanFilter): boolean {
  if (f.folder !== '' && e.folder !== f.folder) return false;
  if (f.tag !== '' && !(e.tags ?? []).includes(f.tag)) return false;
  const q = f.query.trim().toLowerCase();
  if (q !== '') {
    if (!e.title.toLowerCase().includes(q) && !(e.tags ?? []).some((t) => t.toLowerCase().includes(q))) return false;
  }
  return true;
}

/** open / done 列を構築。archived は常に除外(本体パリティ)。Pure. */
export function kanbanColumns(
  p: ContainerProjection,
  filter: KanbanFilter = EMPTY_FILTER,
): { open: ProjectionEntry[]; done: ProjectionEntry[] } {
  const todos = p.entries.filter((e) => {
    const m = todoMeta(e);
    return m !== null && m.archived !== true && matchesFilter(e, filter);
  });
  // open: 期日昇順(期日なしは末尾)→ updated。done: 更新が新しい順。
  const openKey = (e: ProjectionEntry): string => `${todoMeta(e)!.date ?? '9999-99-99'} ${e.updated_at}`;
  const open = todos
    .filter((e) => todoMeta(e)!.status === 'open')
    .sort((a, b) => openKey(a).localeCompare(openKey(b)));
  const done = todos
    .filter((e) => todoMeta(e)!.status === 'done')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { open, done };
}

/** PKC2 host の WriteOp 形に厳密一致(features/extension-host/write.ts、R2)。 */
export function setStatusOp(lid: string, status: TodoStatus): { op: 'set-todo-status'; lid: string; status: TodoStatus } {
  return { op: 'set-todo-status', lid, status };
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

/** 非 archived todo に付くタグ(頻度降順)。Pure. */
export function todoTags(p: ContainerProjection): string[] {
  const freq = new Map<string, number>();
  for (const e of p.entries) {
    const m = todoMeta(e);
    if (!m || m.archived) continue;
    for (const t of e.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** 非 archived todo が属する folder lid 一覧(出現順）。Pure. */
export function todoFolders(p: ContainerProjection): Array<{ lid: string; title: string }> {
  const seen = new Set<string>();
  const out: Array<{ lid: string; title: string }> = [];
  const titleOf = new Map(p.entries.map((e) => [e.lid, e.title]));
  for (const e of p.entries) {
    const m = todoMeta(e);
    if (!m || m.archived || e.folder === undefined || seen.has(e.folder)) continue;
    seen.add(e.folder);
    out.push({ lid: e.folder, title: titleOf.get(e.folder) ?? e.folder });
  }
  return out;
}
