/**
 * G1 filer-pro の純関数モデル — projection からフォルダツリー / 一覧 /
 * 検索・ソート・フィルタを導出する (issue #105)。
 *
 * projection はメタデータのみ(body を含まない、spec §3.8 MUST)。フォルダ
 * 構造は ProjectionEntry.folder(親 folder の lid)から組む。write op の
 * 構築もここに集約してテスト可能にする(DnD イベント自体は実機検証)。
 */

import type { ContainerProjection, ProjectionEntry } from '../../shared/ext-channel';

export interface FolderNode {
  lid: string;
  title: string;
  children: FolderNode[];
  /** 直下の非フォルダ entry 数。 */
  directEntries: number;
  /** 子孫を含む非フォルダ entry 数。 */
  descendantEntries: number;
}

/** フォルダ階層を組む(ルート群を返す)。Pure. */
export function buildFolderTree(p: ContainerProjection): FolderNode[] {
  const folders = p.entries.filter((e) => e.archetype === 'folder');
  const folderLids = new Set(folders.map((f) => f.lid));
  const nodeOf = new Map<string, FolderNode>();
  for (const f of folders) {
    nodeOf.set(f.lid, { lid: f.lid, title: f.title, children: [], directEntries: 0, descendantEntries: 0 });
  }

  for (const e of p.entries) {
    if (e.archetype === 'folder') continue;
    if (e.folder !== undefined && nodeOf.has(e.folder)) nodeOf.get(e.folder)!.directEntries += 1;
  }

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = nodeOf.get(f.lid)!;
    const parent = f.folder;
    if (parent !== undefined && folderLids.has(parent) && parent !== f.lid) {
      nodeOf.get(parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const visited = new Set<string>();
  const finalize = (n: FolderNode): number => {
    if (visited.has(n.lid)) return 0; // 防御: 異常データの循環参照
    visited.add(n.lid);
    n.children.sort((a, b) => a.title.localeCompare(b.title));
    let total = n.directEntries;
    for (const c of n.children) total += finalize(c);
    n.descendantEntries = total;
    return total;
  };
  roots.sort((a, b) => a.title.localeCompare(b.title));
  for (const r of roots) finalize(r);
  return roots;
}

/** フォルダ配下の非フォルダ entry。folderLid=null は未整理(ルート直下)。Pure. */
export function entriesInFolder(p: ContainerProjection, folderLid: string | null): ProjectionEntry[] {
  return p.entries.filter((e) => {
    if (e.archetype === 'folder') return false;
    if (folderLid === null) return e.folder === undefined;
    return e.folder === folderLid;
  });
}

/** 全非フォルダ entry(検索スコープ = container 全体のとき)。Pure. */
export function allEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter((e) => e.archetype !== 'folder');
}

/** entry の lid → 親フォルダ lid（無ければ null）。Pure. */
export function parentFolderOf(p: ContainerProjection, lid: string): string | null {
  const e = p.entries.find((x) => x.lid === lid);
  return e?.folder ?? null;
}

/** 指定フォルダからルートまでの祖先 lid 列(自身を含む、根→自身の順)。Pure. */
export function folderPath(p: ContainerProjection, folderLid: string): string[] {
  const byLid = new Map(p.entries.map((e) => [e.lid, e]));
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = folderLid;
  while (cur !== undefined && !seen.has(cur)) {
    const e = byLid.get(cur);
    if (!e || e.archetype !== 'folder') break;
    seen.add(cur);
    path.unshift(cur);
    cur = e.folder;
  }
  return path;
}

export type SortKey = 'title' | 'updated' | 'created' | 'type';

/** ソート(非破壊)。updated/created は新しい順。Pure. */
export function sortEntries(entries: ProjectionEntry[], key: SortKey): ProjectionEntry[] {
  const arr = [...entries];
  const title = (e: ProjectionEntry): string => e.title.toLowerCase();
  if (key === 'title') arr.sort((a, b) => title(a).localeCompare(title(b)));
  else if (key === 'updated') arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  else if (key === 'created') arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else arr.sort((a, b) => a.archetype.localeCompare(b.archetype) || title(a).localeCompare(title(b)));
  return arr;
}

export interface FilterSpec {
  query: string;
  archetype: string; // '' = all
  tag: string; // '' = all
}

/** title / filename / tags 部分一致 + archetype + tag 完全一致。Pure. */
export function filterEntries(entries: ProjectionEntry[], spec: FilterSpec): ProjectionEntry[] {
  const needle = spec.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (spec.archetype !== '' && e.archetype !== spec.archetype) return false;
    if (spec.tag !== '' && !(e.tags ?? []).includes(spec.tag)) return false;
    if (needle === '') return true;
    return (
      e.title.toLowerCase().includes(needle)
      || (e.filename ?? '').toLowerCase().includes(needle)
      || (e.tags ?? []).some((t) => t.toLowerCase().includes(needle))
    );
  });
}

/** projection 内の全タグ(頻度降順)。Pure. */
export function allTags(p: ContainerProjection): string[] {
  const freq = new Map<string, number>();
  for (const e of p.entries) {
    for (const t of e.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/* ---------------------------------------------------- write op builders */
/** PKC2 host の WriteOp 形に厳密一致(features/extension-host/write.ts)。 */

export function moveOp(lid: string, folderLid: string): { op: 'move'; lid: string; folderLid: string } {
  return { op: 'move', lid, folderLid };
}

export function relateOp(from: string, to: string): { op: 'relate'; from: string; to: string } {
  return { op: 'relate', from, to };
}

const ARCHETYPE_ICON: Record<string, string> = {
  folder: '📁',
  text: '📝',
  textlog: '🧾',
  todo: '☑️',
  form: '📋',
  attachment: '📎',
  generic: '📄',
  opaque: '🔒',
};

/** archetype(と attachment は mime)→ アイコン。Pure. */
export function entryIcon(archetype: string, mime?: string): string {
  if (archetype === 'attachment' && mime) {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📕';
    if (mime === 'message/rfc822') return '✉️';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.startsWith('video/')) return '🎬';
  }
  return ARCHETYPE_ICON[archetype] ?? '•';
}
