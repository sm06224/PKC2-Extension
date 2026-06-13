/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  allTags,
  buildFolderTree,
  entriesInFolder,
  entryIcon,
  filterEntries,
  folderPath,
  moveOp,
  parentFolderOf,
  relateOp,
  sortEntries,
} from '../../tools/g1-filer-pro/src/tree';
import type { ContainerProjection, ProjectionEntry } from '../../tools/shared/ext-channel';

const entry = (over: Partial<ProjectionEntry> & { lid: string }): ProjectionEntry => ({
  title: over.lid,
  archetype: 'text',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  ...over,
});

function proj(entries: ProjectionEntry[]): ContainerProjection {
  return {
    containerId: 'c', title: 'box', entries,
    relations: [],
    stats: { totalEntries: entries.length, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
  };
}

const SAMPLE = proj([
  entry({ lid: 'work', title: '仕事', archetype: 'folder' }),
  entry({ lid: 'proj', title: 'プロジェクト', archetype: 'folder', folder: 'work' }),
  entry({ lid: 'home', title: '私生活', archetype: 'folder' }),
  entry({ lid: 'a', title: 'メモA', folder: 'work', tags: ['urgent'], updated_at: '2026-06-03T00:00:00Z' }),
  entry({ lid: 'b', title: 'タスクB', archetype: 'todo', folder: 'proj', tags: ['urgent', 'q3'], updated_at: '2026-06-05T00:00:00Z' }),
  entry({ lid: 'c', title: '画像C', archetype: 'attachment', mime: 'image/png', folder: 'home' }),
  entry({ lid: 'loose', title: '未整理メモ', updated_at: '2026-06-02T00:00:00Z' }),
]);

describe('buildFolderTree', () => {
  it('階層・件数(直下/子孫)— ルートは 2 つ', () => {
    const roots = buildFolderTree(SAMPLE);
    // localeCompare の日本語順序は ICU 依存のため順序非依存で検証
    expect(new Set(roots.map((r) => r.lid))).toEqual(new Set(['work', 'home']));
    const work = roots.find((r) => r.lid === 'work')!;
    expect(work.children.map((c) => c.lid)).toEqual(['proj']);
    expect(work.directEntries).toBe(1); // a
    expect(work.descendantEntries).toBe(2); // a + b(proj 配下)
    expect(work.children[0]!.directEntries).toBe(1); // b
  });

  it('循環参照でも無限ループしない', () => {
    const cyclic = proj([
      entry({ lid: 'x', archetype: 'folder', folder: 'y' }),
      entry({ lid: 'y', archetype: 'folder', folder: 'x' }),
    ]);
    expect(() => buildFolderTree(cyclic)).not.toThrow();
  });
});

describe('entriesInFolder / parentFolderOf / folderPath', () => {
  it('フォルダ配下 / 未整理(null)', () => {
    expect(entriesInFolder(SAMPLE, 'work').map((e) => e.lid)).toEqual(['a']);
    expect(entriesInFolder(SAMPLE, 'proj').map((e) => e.lid)).toEqual(['b']);
    expect(entriesInFolder(SAMPLE, null).map((e) => e.lid)).toEqual(['loose']);
  });
  it('parentFolderOf / folderPath', () => {
    expect(parentFolderOf(SAMPLE, 'b')).toBe('proj');
    expect(parentFolderOf(SAMPLE, 'loose')).toBe(null);
    expect(folderPath(SAMPLE, 'proj')).toEqual(['work', 'proj']);
  });
});

describe('sort / filter / tags', () => {
  it('sortEntries updated は新しい順', () => {
    const xs = entriesInFolder(SAMPLE, 'work').concat(entriesInFolder(SAMPLE, null));
    expect(sortEntries(xs, 'updated').map((e) => e.lid)).toEqual(['a', 'loose']);
  });
  it('filterEntries: query / archetype / tag', () => {
    const all = SAMPLE.entries.filter((e) => e.archetype !== 'folder');
    expect(filterEntries(all, { query: 'タスク', archetype: '', tag: '' }).map((e) => e.lid)).toEqual(['b']);
    expect(filterEntries(all, { query: '', archetype: 'todo', tag: '' }).map((e) => e.lid)).toEqual(['b']);
    expect(filterEntries(all, { query: '', archetype: '', tag: 'urgent' }).map((e) => e.lid)).toEqual(['a', 'b']);
    expect(filterEntries(all, { query: 'urgent', archetype: '', tag: '' }).map((e) => e.lid)).toEqual(['a', 'b']); // タグ部分一致
  });
  it('allTags は頻度降順', () => {
    expect(allTags(SAMPLE)).toEqual(['urgent', 'q3']);
  });
});

describe('write op builders / icon', () => {
  it('moveOp / relateOp は PKC2 host の WriteOp 形に一致', () => {
    expect(moveOp('a', 'work')).toEqual({ op: 'move', lid: 'a', folderLid: 'work' });
    expect(relateOp('a', 'b')).toEqual({ op: 'relate', from: 'a', to: 'b' });
  });
  it('entryIcon', () => {
    expect(entryIcon('folder')).toBe('📁');
    expect(entryIcon('todo')).toBe('☑️');
    expect(entryIcon('attachment', 'image/png')).toBe('🖼️');
    expect(entryIcon('attachment', 'application/pdf')).toBe('📕');
    expect(entryIcon('unknown-x')).toBe('•');
  });
});
