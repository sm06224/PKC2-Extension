/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  isPastDue,
  kanbanColumns,
  setStatusOp,
  todayISO,
  todoFolders,
  todoMeta,
  todoTags,
} from '../../tools/g2-kanban-pro/src/kanban';
import type { ContainerProjection, ProjectionEntry } from '../../tools/shared/ext-channel';

const todo = (over: Partial<ProjectionEntry> & { lid: string; todo: NonNullable<ProjectionEntry['todo']> }): ProjectionEntry => ({
  title: over.lid,
  archetype: 'todo',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  ...over,
});

function proj(entries: ProjectionEntry[]): ContainerProjection {
  return { containerId: 'c', title: 'box', entries, relations: [], stats: { totalEntries: entries.length, byArchetype: {}, totalRelations: 0, totalAssets: 0 } };
}

describe('todoMeta', () => {
  it('todo の派生メタを防御的に読む', () => {
    expect(todoMeta(todo({ lid: 'a', todo: { status: 'open', date: '2026-06-10' } }))).toEqual({ status: 'open', date: '2026-06-10' });
    expect(todoMeta(todo({ lid: 'b', todo: { status: 'done', archived: true } }))).toEqual({ status: 'done', archived: true });
  });
  it('非 todo / 壊れた値は null', () => {
    expect(todoMeta({ lid: 'x', title: 't', archetype: 'text', created_at: '', updated_at: '' })).toBeNull();
    expect(todoMeta(todo({ lid: 'c', todo: { status: 'weird' as 'open' } }))).toBeNull();
    expect(todoMeta(todo({ lid: 'd', todo: { status: 'open', date: '06/10' } }))).toEqual({ status: 'open' }); // 不正 date は落とす
  });
});

describe('kanbanColumns', () => {
  const P = proj([
    todo({ lid: 'o1', todo: { status: 'open', date: '2026-06-20' }, tags: ['work'] }),
    todo({ lid: 'o2', todo: { status: 'open' }, tags: ['home'], folder: 'f1' }),
    todo({ lid: 'd1', todo: { status: 'done' }, updated_at: '2026-06-05T00:00:00Z' }),
    todo({ lid: 'arch', todo: { status: 'open', archived: true } }),
    { lid: 'note', title: 'メモ', archetype: 'text', created_at: '', updated_at: '' },
  ]);

  it('open/done に分かれ、archived と非 todo は除外', () => {
    const { open, done } = kanbanColumns(P);
    expect(open.map((e) => e.lid)).toEqual(['o1', 'o2']); // 期日昇順(日付あり先)
    expect(done.map((e) => e.lid)).toEqual(['d1']);
  });

  it('期日昇順(期日なしは末尾)', () => {
    const { open } = kanbanColumns(proj([
      todo({ lid: 'late', todo: { status: 'open', date: '2026-06-30' } }),
      todo({ lid: 'none', todo: { status: 'open' } }),
      todo({ lid: 'soon', todo: { status: 'open', date: '2026-06-02' } }),
    ]));
    expect(open.map((e) => e.lid)).toEqual(['soon', 'late', 'none']);
  });

  it('folder / tag / query フィルタ', () => {
    expect(kanbanColumns(P, { query: '', folder: 'f1', tag: '' }).open.map((e) => e.lid)).toEqual(['o2']);
    expect(kanbanColumns(P, { query: '', folder: '', tag: 'work' }).open.map((e) => e.lid)).toEqual(['o1']);
    expect(kanbanColumns(P, { query: 'o1', folder: '', tag: '' }).open.map((e) => e.lid)).toEqual(['o1']);
  });
});

describe('isPastDue / todayISO / op / selectors', () => {
  it('isPastDue: open かつ期日 < 今日', () => {
    const e = todo({ lid: 'p', todo: { status: 'open', date: '2026-06-01' } });
    expect(isPastDue(e, '2026-06-14')).toBe(true);
    expect(isPastDue(e, '2026-05-30')).toBe(false);
    expect(isPastDue(todo({ lid: 'q', todo: { status: 'done', date: '2026-06-01' } }), '2026-06-14')).toBe(false);
  });
  it('todayISO はローカル YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 5, 14))).toBe('2026-06-14');
  });
  it('setStatusOp は PKC2 host の WriteOp 形', () => {
    expect(setStatusOp('a', 'done')).toEqual({ op: 'set-todo-status', lid: 'a', status: 'done' });
  });
  it('todoTags / todoFolders は archived 除外', () => {
    const P = proj([
      todo({ lid: 'a', todo: { status: 'open' }, tags: ['x'], folder: 'f1' }),
      todo({ lid: 'b', todo: { status: 'open', archived: true }, tags: ['hidden'], folder: 'f2' }),
    ]);
    expect(todoTags(P)).toEqual(['x']);
    expect(todoFolders(P).map((f) => f.lid)).toEqual(['f1']);
  });
});
