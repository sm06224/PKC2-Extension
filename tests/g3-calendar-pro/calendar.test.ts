/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  agenda,
  isYearMonth,
  monthGrid,
  monthOf,
  shiftMonth,
  todosByDate,
  weekdayLabels,
} from '../../tools/g3-calendar-pro/src/calendar';
import type { ContainerProjection, ProjectionEntry } from '../../tools/shared/ext-channel';

const todo = (lid: string, todoMeta: NonNullable<ProjectionEntry['todo']>): ProjectionEntry => ({
  lid, title: lid, archetype: 'todo', created_at: '', updated_at: '', todo: todoMeta,
});
function proj(entries: ProjectionEntry[]): ContainerProjection {
  return { containerId: 'c', title: 'box', entries, relations: [], stats: { totalEntries: entries.length, byArchetype: {}, totalRelations: 0, totalAssets: 0 } };
}

describe('month helpers', () => {
  it('isYearMonth / shiftMonth / monthOf', () => {
    expect(isYearMonth('2026-06')).toBe(true);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthOf(new Date(2026, 5, 14))).toBe('2026-06');
  });
  it('weekdayLabels(週開始)', () => {
    expect(weekdayLabels(0)[0]).toBe('日');
    expect(weekdayLabels(1)[0]).toBe('月');
    expect(weekdayLabels(1)[6]).toBe('日');
  });
});

describe('todosByDate', () => {
  const P = proj([
    todo('a', { status: 'open', date: '2026-06-10' }),
    todo('b', { status: 'done', date: '2026-06-10' }),
    todo('c', { status: 'open' }), // 期日なし → 載らない
    todo('arch', { status: 'open', date: '2026-06-12', archived: true }),
  ]);
  it('期日別に集約、期日なしは除外', () => {
    const m = todosByDate(P);
    expect(m.get('2026-06-10')!.map((e) => e.lid)).toEqual(['a', 'b']);
    expect(m.has('2026-06-12')).toBe(false); // archived は既定で除外
  });
  it('showArchived で archived も載る', () => {
    const m = todosByDate(P, { showArchived: true });
    expect(m.get('2026-06-12')!.map((e) => e.lid)).toEqual(['arch']);
  });
});

describe('monthGrid', () => {
  it('42 マス、当月フラグ・今日・todo 配置', () => {
    const byDate = todosByDate(proj([todo('x', { status: 'open', date: '2026-06-15' })]));
    const grid = monthGrid('2026-06', byDate, '2026-06-15', 0);
    expect(grid.length).toBe(42);
    // 2026-06-01 は月曜 → 週開始日曜なら先頭に 5/31(日)が来る
    expect(grid[0]!.date).toBe('2026-05-31');
    expect(grid[0]!.inMonth).toBe(false);
    const d15 = grid.find((d) => d.date === '2026-06-15')!;
    expect(d15.inMonth).toBe(true);
    expect(d15.isToday).toBe(true);
    expect(d15.todos.map((e) => e.lid)).toEqual(['x']);
  });
});

describe('agenda', () => {
  it('期日昇順、archived は既定除外', () => {
    const P = proj([
      todo('late', { status: 'open', date: '2026-06-30' }),
      todo('soon', { status: 'done', date: '2026-06-02' }),
      todo('arch', { status: 'open', date: '2026-06-01', archived: true }),
      todo('nodate', { status: 'open' }),
    ]);
    expect(agenda(P).map((e) => e.lid)).toEqual(['soon', 'late']);
    expect(agenda(P, { showArchived: true }).map((e) => e.lid)).toEqual(['arch', 'soon', 'late']);
  });
});
