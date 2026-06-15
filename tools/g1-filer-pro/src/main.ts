/**
 * G1 filer-pro — PKC2 のファイラを拡張側で作り直す (issue #105)。
 *
 * 左 = フォルダツリー、右 = 一覧。projection(メタのみ)で閲覧・検索・
 * ソート・フィルタし、**D&D でフォルダ移動**(pkc-ext write op `move`)・
 * 関連付け(`relate`)・PKC2 との選択同期(hint / selected)を行う。
 *
 * v2(#110 / #830 R3・R7 採用): **複数選択(チェックボックス)→ 一括移動**、
 * **フォルダ自体の D&D 移動**(host の `moveEntryToFolder` 循環ガードに依拠 +
 * クライアント側でも `canDropFolderInto` で送る前に弾く)、**rename**(`rename`
 * op、インライン編集)、**未整理へ戻す**(`unfile` op、未整理行への drop)。
 * delete/restore(ゴミ箱)・孤児アセット掃除は別 PR(R4/R8)。
 *
 * セキュリティ: 受信 projection は描画のみ(textContent)。write は host が
 * `validateWriteOps` で検証(G2)。本文・asset は受け取らない(pull 経路なし)。
 */

import '../../shared/base.css';
import './filer.css';
import { makeCorrelationId } from '../../shared/envelope';
import {
  ExtChannel,
  type ContainerProjection,
  type ProjectionEntry,
  type ProjectionOrphanAsset,
  type ProjectionRestoreCandidate,
} from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, selectInput, textInput } from '../../shared/ui';
import {
  allEntries,
  allTags,
  buildFolderTree,
  canDropFolderInto,
  deleteOp,
  entriesInFolder,
  entryIcon,
  filterEntries,
  folderPath,
  humanSize,
  moveOp,
  parentFolderOf,
  purgeOrphanAssetsOp,
  relateOp,
  renameOp,
  restoreOp,
  sortEntries,
  unfileOp,
  type FolderNode,
  type SortKey,
} from './tree';

const TOOL_NAME = 'pkc2-filer-pro';
const TOOL_VERSION = '0.1.0';

const ALL = '__all__';
const TRASH = '__trash__';
const ORPHANS = '__orphans__';
// '__all__' / '__trash__' / '__orphans__' / folder lid / null(未整理)
type Scope = typeof ALL | typeof TRASH | typeof ORPHANS | string | null;

interface FilerState {
  projection: ContainerProjection | null;
  scope: Scope;
  query: string;
  sortKey: SortKey;
  archetype: string;
  tag: string;
  expanded: Set<string>;
  selectedLid: string | null;
  relateFrom: string | null;
  /** チェックボックスでの複数選択(一括 move / unfile 用、host 同期はしない)。 */
  checkedLids: Set<string>;
  /** インライン rename 中の lid(1 件のみ)。 */
  renamingLid: string | null;
}

const state: FilerState = {
  projection: null,
  scope: ALL,
  query: '',
  sortKey: 'updated',
  archetype: '',
  tag: '',
  expanded: new Set(),
  selectedLid: null,
  relateFrom: null,
  checkedLids: new Set(),
  renamingLid: null,
};

let channel: ExtChannel | null = null;
let treeEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let crumbEl: HTMLElement | null = null;
/** ドラッグ中の lid 群(チェック済みを掴めば全部、未チェックなら 1 件)。 */
let draggingLids: string[] = [];
/** ドラッグ中がフォルダ 1 件か(循環ガード判定用)。 */
let draggingFolderLid: string | null = null;
const pendingWrites = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* ----------------------------------------------------------- write ops */

/** ドラッグ開始時に「掴む lid 群」を決める(チェック済みに含まれれば全部)。 */
function dragLidsFor(lid: string): string[] {
  return state.checkedLids.has(lid) && state.checkedLids.size > 0 ? [...state.checkedLids] : [lid];
}

/** entry 群を folder へ一括移動。フォルダは循環不可分を除外。1 write にまとめる。 */
function requestMoveMany(lids: string[], folderLid: string): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため移動できません(standalone)');
    return false;
  }
  const p = state.projection;
  const movable = lids.filter((lid) => {
    if (lid === folderLid) return false;
    if (p && isFolderLid(p, lid)) return canDropFolderInto(p, lid, folderLid);
    return true;
  });
  if (movable.length === 0) {
    setStatus('移動できる項目がありません(自分自身 / 子孫フォルダへは移動不可)');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite(movable.map((lid) => moveOp(lid, folderLid)), movable[0], cid);
  if (ok) {
    pendingWrites.set(cid, `${movable.length} 件の移動`);
    setStatus(`📁 ${movable.length} 件の移動を要求しました — PKC2 が検証して反映します`);
    state.checkedLids.clear();
  }
  return ok;
}

/** entry 群を未整理(root)へ(#830 R7、unfile op を 1 write にまとめる)。 */
function requestUnfileMany(lids: string[]): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため未整理に戻せません(standalone)');
    return false;
  }
  if (lids.length === 0) return false;
  const cid = makeCorrelationId();
  const ok = channel.sendWrite(lids.map((lid) => unfileOp(lid)), lids[0], cid);
  if (ok) {
    pendingWrites.set(cid, `${lids.length} 件を未整理へ`);
    setStatus(`🗂 ${lids.length} 件を未整理へ — PKC2 が検証して反映します`);
    state.checkedLids.clear();
  }
  return ok;
}

/** title 変更(#830 R3、rename op)。trim 後が空 / 無変更なら送らない。 */
function requestRename(lid: string, title: string): boolean {
  const trimmed = title.trim();
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため名称変更できません(standalone)');
    return false;
  }
  if (trimmed === '') {
    setStatus('名称が空のため変更しません');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([renameOp(lid, trimmed)], lid, cid);
  if (ok) {
    pendingWrites.set(cid, '名称変更');
    setStatus('✏️ 名称変更を要求しました — PKC2 が検証して反映します');
  }
  return ok;
}

function isFolderLid(p: ContainerProjection, lid: string): boolean {
  return p.entries.some((e) => e.lid === lid && e.archetype === 'folder');
}

/** entry 群を soft delete(#830 R4、ゴミ箱から復元可)。1 write にまとめる。 */
function requestDeleteMany(lids: string[]): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため削除できません(standalone)');
    return false;
  }
  if (lids.length === 0) return false;
  const cid = makeCorrelationId();
  const ok = channel.sendWrite(lids.map((lid) => deleteOp(lid)), lids[0], cid);
  if (ok) {
    pendingWrites.set(cid, `${lids.length} 件を削除`);
    setStatus(`🗑 ${lids.length} 件を削除(ゴミ箱から復元できます)— PKC2 が検証して反映します`);
    state.checkedLids.clear();
  }
  return ok;
}

/** soft delete 済み entry を復元(#830 R4)。 */
function requestRestore(lid: string): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため復元できません(standalone)');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([restoreOp(lid)], lid, cid);
  if (ok) {
    pendingWrites.set(cid, '復元');
    setStatus('↩️ 復元を要求しました — PKC2 が検証して反映します');
  }
  return ok;
}

/** 孤児アセットを一括掃除(#830 R8、container 単位)。 */
function requestPurgeOrphans(): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため掃除できません(standalone)');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([purgeOrphanAssetsOp()], undefined, cid);
  if (ok) {
    pendingWrites.set(cid, '孤児アセットの掃除');
    setStatus('🧹 孤児アセットの一括掃除を要求しました — PKC2 が検証して反映します');
  }
  return ok;
}

function requestRelate(from: string, to: string): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため関連付けできません(standalone)');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([relateOp(from, to)], undefined, cid);
  if (ok) {
    pendingWrites.set(cid, '関連付け');
    setStatus('🔗 関連付けを要求しました — PKC2 が検証して反映します');
  }
  return ok;
}

function onWriteResult(ok: boolean, cid: string | null): void {
  const label = cid !== null ? pendingWrites.get(cid) : undefined;
  if (cid !== null) pendingWrites.delete(cid);
  setStatus(ok ? `✅ ${label ?? '書き戻し'}を反映しました` : `✖ ${label ?? '書き戻し'}は拒否されました(PKC2 の検証 NG)`);
}

/* -------------------------------------------------------------- render */

function scopeEntries(p: ContainerProjection): ProjectionEntry[] {
  if (state.scope === ALL) return allEntries(p);
  return entriesInFolder(p, state.scope); // string | null
}

function renderCrumb(): void {
  if (!crumbEl) return;
  crumbEl.replaceChildren();
  const p = state.projection;
  if (!p) return;
  const parts: Array<{ label: string; scope: Scope }> = [{ label: '📦 すべて', scope: ALL }];
  if (state.scope === null) parts.push({ label: '🗂 未整理', scope: null });
  else if (state.scope === TRASH) parts.push({ label: '🗑 ゴミ箱', scope: TRASH });
  else if (state.scope === ORPHANS) parts.push({ label: '🧹 孤児アセット', scope: ORPHANS });
  else if (typeof state.scope === 'string' && state.scope !== ALL) {
    for (const lid of folderPath(p, state.scope)) {
      const f = p.entries.find((e) => e.lid === lid);
      parts.push({ label: `📁 ${f?.title ?? lid}`, scope: lid });
    }
  }
  parts.forEach((part, i) => {
    if (i > 0) crumbEl!.appendChild(el('span', 'pkc-filer-crumbsep', '›'));
    crumbEl!.appendChild(
      button(part.label, 'pkc-filer-crumb', () => {
        state.scope = part.scope;
        renderList();
        renderCrumb();
      }),
    );
  });
}

function folderRow(node: FolderNode, depth: number): HTMLElement {
  const row = el('div', 'pkc-filer-folderrow');
  row.setAttribute('data-pkc-folder', node.lid);
  row.style.paddingLeft = `${depth * 14 + 4}px`;
  if (state.scope === node.lid) row.classList.add('pkc-filer-active');

  const hasChildren = node.children.length > 0;
  const twisty = el('span', 'pkc-filer-twisty', hasChildren ? (state.expanded.has(node.lid) ? '▾' : '▸') : '·');
  if (hasChildren) {
    twisty.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (state.expanded.has(node.lid)) state.expanded.delete(node.lid);
      else state.expanded.add(node.lid);
      renderTree();
    });
  }
  row.appendChild(twisty);
  row.appendChild(el('span', 'pkc-filer-foldericon', '📁'));
  if (state.renamingLid === node.lid) {
    row.appendChild(renameInput(node.lid, node.title));
  } else {
    row.appendChild(el('span', 'pkc-filer-foldername', node.title));
  }
  row.appendChild(el('span', 'pkc-filer-foldercount', String(node.descendantEntries)));
  row.appendChild(renameButton(node.lid));

  // ---- フォルダ自体も drag source(#830: host が循環ガード、こちらも事前に弾く)
  row.draggable = true;
  row.addEventListener('dragstart', (ev) => {
    draggingLids = [node.lid];
    draggingFolderLid = node.lid;
    ev.dataTransfer?.setData('text/plain', node.lid);
  });
  row.addEventListener('dragend', () => {
    draggingLids = [];
    draggingFolderLid = null;
  });

  row.addEventListener('click', () => {
    state.scope = node.lid;
    renderList();
    renderCrumb();
    renderTree();
  });

  // ---- drop target(entry / フォルダをこのフォルダへ move)
  row.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    row.classList.add('pkc-filer-droptarget');
  });
  row.addEventListener('dragleave', () => row.classList.remove('pkc-filer-droptarget'));
  row.addEventListener('drop', (ev) => {
    ev.preventDefault();
    row.classList.remove('pkc-filer-droptarget');
    const lids = draggingLids.length > 0 ? draggingLids : pickDropLid(ev);
    if (lids.length > 0) requestMoveMany(lids, node.lid);
  });

  return row;
}

/** dataTransfer から lid を 1 件拾う(dragstart の draggingLids が空の保険)。 */
function pickDropLid(ev: DragEvent): string[] {
  const lid = ev.dataTransfer?.getData('text/plain');
  return lid ? [lid] : [];
}

/** ✏️ ボタン(クリックでインライン rename 開始)。 */
function renameButton(lid: string): HTMLButtonElement {
  const b = button('✏️', 'pkc-btn-small pkc-filer-rename', (ev?: unknown) => {
    (ev as Event | undefined)?.stopPropagation?.();
    state.renamingLid = lid;
    renderTree();
    renderList();
  }, '名称変更');
  b.setAttribute('data-pkc-action', 'rename');
  return b;
}

/** インライン rename の input(Enter=確定、Esc/blur=取消)。 */
function renameInput(lid: string, current: string): HTMLInputElement {
  const input = textInput('');
  input.className = 'pkc-filer-renameinput';
  input.value = current;
  input.setAttribute('data-pkc-field', 'rename-input');
  input.addEventListener('click', (ev) => ev.stopPropagation());
  let committed = false;
  const finish = (commit: boolean): void => {
    if (committed) return;
    committed = true;
    state.renamingLid = null;
    if (commit) requestRename(lid, input.value);
    renderTree();
    renderList();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(false));
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

function renderTreeNode(node: FolderNode, depth: number, into: HTMLElement): void {
  into.appendChild(folderRow(node, depth));
  if (state.expanded.has(node.lid)) {
    for (const child of node.children) renderTreeNode(child, depth + 1, into);
  }
}

function renderTree(): void {
  if (!treeEl) return;
  treeEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    treeEl.appendChild(el('div', 'pkc-hint', 'projection 待機中…'));
    return;
  }

  const allRow = el('div', 'pkc-filer-folderrow');
  allRow.style.paddingLeft = '4px';
  if (state.scope === ALL) allRow.classList.add('pkc-filer-active');
  allRow.appendChild(el('span', 'pkc-filer-twisty', '·'));
  allRow.appendChild(el('span', 'pkc-filer-foldericon', '📦'));
  allRow.appendChild(el('span', 'pkc-filer-foldername', 'すべて'));
  allRow.appendChild(el('span', 'pkc-filer-foldercount', String(allEntries(p).length)));
  allRow.addEventListener('click', () => {
    state.scope = ALL;
    renderList();
    renderCrumb();
    renderTree();
  });
  treeEl.appendChild(allRow);

  const unfiled = entriesInFolder(p, null);
  const unRow = el('div', 'pkc-filer-folderrow');
  unRow.style.paddingLeft = '4px';
  if (state.scope === null) unRow.classList.add('pkc-filer-active');
  unRow.appendChild(el('span', 'pkc-filer-twisty', '·'));
  unRow.appendChild(el('span', 'pkc-filer-foldericon', '🗂'));
  unRow.appendChild(el('span', 'pkc-filer-foldername', '未整理'));
  unRow.appendChild(el('span', 'pkc-filer-foldercount', String(unfiled.length)));
  unRow.addEventListener('click', () => {
    state.scope = null;
    renderList();
    renderCrumb();
    renderTree();
  });
  // ---- drop target(#830 R7: ここへ落とすと未整理へ戻す = unfile)
  unRow.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    unRow.classList.add('pkc-filer-droptarget');
  });
  unRow.addEventListener('dragleave', () => unRow.classList.remove('pkc-filer-droptarget'));
  unRow.addEventListener('drop', (ev) => {
    ev.preventDefault();
    unRow.classList.remove('pkc-filer-droptarget');
    const lids = draggingLids.length > 0 ? draggingLids : pickDropLid(ev);
    if (lids.length > 0) requestUnfileMany(lids);
  });
  unRow.setAttribute('data-pkc-action', 'unfile-target');
  treeEl.appendChild(unRow);

  // ---- ゴミ箱(#830 R4)/ 孤児アセット(#830 R8)の特殊スコープ行
  const specialRow = (icon: string, label: string, scopeVal: Scope, count: number): HTMLElement => {
    const row = el('div', 'pkc-filer-folderrow');
    row.style.paddingLeft = '4px';
    if (state.scope === scopeVal) row.classList.add('pkc-filer-active');
    row.appendChild(el('span', 'pkc-filer-twisty', '·'));
    row.appendChild(el('span', 'pkc-filer-foldericon', icon));
    row.appendChild(el('span', 'pkc-filer-foldername', label));
    row.appendChild(el('span', 'pkc-filer-foldercount', String(count)));
    row.addEventListener('click', () => {
      state.scope = scopeVal;
      renderList();
      renderCrumb();
      renderTree();
    });
    return row;
  };
  const trashRow = specialRow('🗑', 'ゴミ箱', TRASH, (p.restoreCandidates ?? []).length);
  trashRow.setAttribute('data-pkc-action', 'trash-scope');
  treeEl.appendChild(trashRow);
  const orphans = p.orphanAssets ?? [];
  if (orphans.length > 0) {
    const orphanRow = specialRow('🧹', '孤児アセット', ORPHANS, orphans.length);
    orphanRow.setAttribute('data-pkc-action', 'orphans-scope');
    treeEl.appendChild(orphanRow);
  }

  for (const root of buildFolderTree(p)) renderTreeNode(root, 0, treeEl);
}

function entryRow(e: ProjectionEntry): HTMLElement {
  const row = el('div', 'pkc-filer-entryrow');
  row.setAttribute('data-pkc-lid', e.lid);
  if (e.lid === state.selectedLid) row.classList.add('pkc-filer-selected');
  if (e.lid === state.relateFrom) row.classList.add('pkc-filer-relatefrom');
  if (state.checkedLids.has(e.lid)) row.classList.add('pkc-filer-checked');
  row.draggable = true;
  row.addEventListener('dragstart', (ev) => {
    draggingLids = dragLidsFor(e.lid);
    draggingFolderLid = null;
    ev.dataTransfer?.setData('text/plain', e.lid);
  });
  row.addEventListener('dragend', () => {
    draggingLids = [];
  });

  // ---- 複数選択チェックボックス(一括 move / unfile 用)
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'pkc-filer-check';
  check.checked = state.checkedLids.has(e.lid);
  check.setAttribute('data-pkc-action', 'check');
  check.addEventListener('click', (ev) => ev.stopPropagation());
  check.addEventListener('change', () => {
    if (check.checked) state.checkedLids.add(e.lid);
    else state.checkedLids.delete(e.lid);
    renderList();
  });
  row.appendChild(check);

  row.appendChild(el('span', 'pkc-filer-entryicon', entryIcon(e.archetype, e.mime)));
  let name: HTMLElement;
  if (state.renamingLid === e.lid) {
    name = renameInput(e.lid, e.title);
  } else {
    name = el('span', 'pkc-filer-entryname', e.filename ?? e.title);
  }
  row.appendChild(name);
  if (e.color_tag) {
    const dot = el('span', 'pkc-filer-colordot');
    dot.style.background = /^#[0-9a-fA-F]{3,8}$/.test(e.color_tag) ? e.color_tag : 'transparent';
    row.appendChild(dot);
  }
  for (const t of (e.tags ?? []).slice(0, 4)) row.appendChild(el('span', 'pkc-filer-tag', t));
  row.appendChild(el('span', 'pkc-filer-entrymeta', `${e.archetype} · ${e.updated_at.slice(0, 10)}`));

  row.appendChild(renameButton(e.lid));

  const relateBtn = button(state.relateFrom === e.lid ? '🔗 …' : '🔗', 'pkc-btn-small', (ev2?: unknown) => {
    void ev2;
    if (state.relateFrom === null) {
      state.relateFrom = e.lid;
      setStatus(`🔗 関連付け元「${e.title}」— 相手の 🔗 をクリック(取消は再クリック)`);
    } else if (state.relateFrom === e.lid) {
      state.relateFrom = null;
      setStatus('関連付けを取り消しました');
    } else {
      requestRelate(state.relateFrom, e.lid);
      state.relateFrom = null;
    }
    renderList();
  }, '関連付け');
  relateBtn.setAttribute('data-pkc-action', 'relate');
  row.appendChild(relateBtn);

  const delBtn = button('🗑', 'pkc-btn-small', (ev?: unknown) => {
    (ev as Event | undefined)?.stopPropagation?.();
    requestDeleteMany([e.lid]);
  }, '削除(ゴミ箱へ・復元可)');
  delBtn.setAttribute('data-pkc-action', 'delete');
  row.appendChild(delBtn);

  // single click = select(同期)、double click = open(前面化)。
  // rename 編集中(name が input)は選択ハンドラを付けない。
  if (state.renamingLid !== e.lid) {
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    name.addEventListener('click', () => {
      if (clickTimer !== null) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        state.selectedLid = e.lid;
        channel?.sendHint('select', e.lid);
        renderList();
      }, 220);
    });
    name.addEventListener('dblclick', () => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      state.selectedLid = e.lid;
      channel?.sendHint('open', e.lid);
      setStatus(`「${e.title}」を PKC2 で開きました`);
      renderList();
    });
  }

  return row;
}

/** ゴミ箱(#830 R4): soft delete 済みの復元候補を 復元 ボタン付きで一覧。 */
function renderTrashList(items: ProjectionRestoreCandidate[]): void {
  if (!listEl) return;
  listEl.appendChild(el('div', 'pkc-filer-listhead', `🗑 ゴミ箱 — ${items.length} 件(復元できます)`));
  if (items.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', 'ゴミ箱は空です'));
    return;
  }
  for (const it of items) {
    const row = el('div', 'pkc-filer-entryrow');
    row.setAttribute('data-pkc-trash', it.lid);
    row.appendChild(el('span', 'pkc-filer-entryicon', entryIcon(it.archetype)));
    row.appendChild(el('span', 'pkc-filer-entryname', it.title || '(無題)'));
    row.appendChild(el('span', 'pkc-filer-entrymeta', it.archetype));
    const restoreBtn = button('↩️ 復元', 'pkc-btn-small', () => requestRestore(it.lid), '復元');
    restoreBtn.setAttribute('data-pkc-action', 'restore');
    row.appendChild(restoreBtn);
    listEl.appendChild(row);
  }
}

/** 孤児アセット(#830 R8): key + サイズを一覧 + 一括掃除。base64 本体は来ない。 */
function renderOrphanList(items: ProjectionOrphanAsset[]): void {
  if (!listEl) return;
  const total = items.reduce((s, o) => s + o.size, 0);
  listEl.appendChild(el('div', 'pkc-filer-listhead', `🧹 孤児アセット — ${items.length} 件 / 約 ${humanSize(total)}`));
  if (items.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', '孤児アセットはありません'));
    return;
  }
  const bar = el('div', 'pkc-filer-batchbar');
  bar.setAttribute('data-pkc-region', 'filer-batch');
  bar.appendChild(el('span', 'pkc-hint', 'どの entry からも参照されていないアセットです。'));
  const purgeBtn = button(`🧹 全部掃除(${items.length})`, 'pkc-btn-small', () => requestPurgeOrphans());
  purgeBtn.setAttribute('data-pkc-action', 'purge-orphans');
  bar.appendChild(purgeBtn);
  listEl.appendChild(bar);
  for (const o of items) {
    const row = el('div', 'pkc-filer-entryrow');
    row.setAttribute('data-pkc-orphan', o.key);
    row.appendChild(el('span', 'pkc-filer-entryicon', '🧩'));
    row.appendChild(el('span', 'pkc-filer-entryname', o.key));
    row.appendChild(el('span', 'pkc-filer-entrymeta', humanSize(o.size)));
    listEl.appendChild(row);
  }
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    listEl.appendChild(el('div', 'pkc-hint', 'projection 待機中…'));
    return;
  }
  if (state.scope === TRASH) {
    renderTrashList(p.restoreCandidates ?? []);
    return;
  }
  if (state.scope === ORPHANS) {
    renderOrphanList(p.orphanAssets ?? []);
    return;
  }
  const base = scopeEntries(p);
  const shown = sortEntries(
    filterEntries(base, { query: state.query, archetype: state.archetype, tag: state.tag }),
    state.sortKey,
  );
  const heading = el('div', 'pkc-filer-listhead', `${shown.length} 件`);
  listEl.appendChild(heading);

  // ---- 一括操作バー(チェック済みがある時だけ)
  if (state.checkedLids.size > 0) {
    const bar = el('div', 'pkc-filer-batchbar');
    bar.setAttribute('data-pkc-region', 'filer-batch');
    bar.appendChild(el('span', 'pkc-filer-batchcount', `☑️ ${state.checkedLids.size} 件選択`));
    bar.appendChild(el('span', 'pkc-hint', 'フォルダへドラッグで一括移動 /'));
    const unfileBtn = button('🗂 未整理へ', 'pkc-btn-small', () => requestUnfileMany([...state.checkedLids]));
    unfileBtn.setAttribute('data-pkc-action', 'batch-unfile');
    bar.appendChild(unfileBtn);
    const delBtn = button('🗑 削除', 'pkc-btn-small', () => requestDeleteMany([...state.checkedLids]));
    delBtn.setAttribute('data-pkc-action', 'batch-delete');
    bar.appendChild(delBtn);
    const clearBtn = button('選択解除', 'pkc-btn-small', () => {
      state.checkedLids.clear();
      renderList();
    });
    clearBtn.setAttribute('data-pkc-action', 'batch-clear');
    bar.appendChild(clearBtn);
    listEl.appendChild(bar);
  }

  if (shown.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', '該当する entry はありません'));
    return;
  }
  for (const e of shown) listEl.appendChild(entryRow(e));
}

/* ------------------------------------------------------------- channel */

function onProjection(p: ContainerProjection): void {
  state.projection = p;
  // 既存の展開状態のうち、消えたフォルダを掃除
  const folderLids = new Set(p.entries.filter((e) => e.archetype === 'folder').map((e) => e.lid));
  for (const lid of [...state.expanded]) if (!folderLids.has(lid)) state.expanded.delete(lid);
  if (
    typeof state.scope === 'string'
    && state.scope !== ALL && state.scope !== TRASH && state.scope !== ORPHANS
    && !folderLids.has(state.scope)
  ) state.scope = ALL;
  // 消えた entry を選択状態から掃除(move/unfile/rename 反映後の再 push に追従)
  const liveLids = new Set(p.entries.map((e) => e.lid));
  for (const lid of [...state.checkedLids]) if (!liveLids.has(lid)) state.checkedLids.delete(lid);
  if (state.renamingLid !== null && !liveLids.has(state.renamingLid)) state.renamingLid = null;
  renderTree();
  renderList();
  renderCrumb();
}

function onSelected(lid: string): void {
  state.selectedLid = lid;
  const p = state.projection;
  if (p) {
    // 親フォルダを展開して見える状態にする(scope は変えない — 邪魔しない)
    const parent = parentFolderOf(p, lid);
    if (parent) for (const f of folderPath(p, parent)) state.expanded.add(f);
    renderTree();
  }
  renderList();
}

/* --------------------------------------------------------------- mount */

export function mountFilerPro(root: HTMLElement): { channel: ExtChannel } {
  // 再 mount(およびテスト)に備えて view state をリセット
  state.projection = null;
  state.scope = ALL;
  state.query = '';
  state.sortKey = 'updated';
  state.archetype = '';
  state.tag = '';
  state.expanded = new Set();
  state.selectedLid = null;
  state.relateFrom = null;
  state.checkedLids = new Set();
  state.renamingLid = null;
  pendingWrites.clear();
  draggingLids = [];
  draggingFolderLid = null;

  root.replaceChildren();
  root.className = 'pkc-filer-root';

  const header = el('div', 'pkc-filer-header');
  header.setAttribute('data-pkc-region', 'filer-header');
  header.appendChild(el('span', 'pkc-filer-title', '🗂️ PKC2 Filer Pro'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 高機能ファイラ(閲覧・整理)`));
  header.appendChild(helpButton('Filer Pro', {
    what: 'PKC2 のファイラを拡張側で作り直した高機能版です。フォルダツリーと一覧で閲覧し、ドラッグ&ドロップでフォルダ/複数 entry の移動・名称変更・未整理へ戻す・関連付け・PKC2 本体との選択同期ができます。',
    how: [
      'PKC2 から起動すると左にフォルダツリー、右に一覧が出ます',
      'entry をドラッグして左のフォルダにドロップ → そのフォルダへ移動',
      'チェックボックスで複数選択 → まとめてドラッグで一括移動 / 「未整理へ」で一括フォルダ外し',
      'フォルダ自体もドラッグで別フォルダへ移動できます(自分の子孫へは移動できません)',
      '各行の ✏️ で名称変更(Enter 確定 / Esc 取消)、🗑 で削除(ゴミ箱へ・復元可)',
      '左の「🗂 未整理」へドロップ → フォルダから外す(未整理に戻す)',
      '左の「🗑 ゴミ箱」で削除済みを確認・復元、「🧹 孤児アセット」で未参照アセットを一括掃除',
      'entry 名をクリック = PKC2 で選択(同期)、ダブルクリック = 開く / 🔗 を 2 つで関連付け',
      '上部で検索 / ソート / archetype・タグで絞り込み',
    ],
    flow: [
      '既定で届くのは projection(メタデータのみ — 本文・添付の実体は含まれません)',
      '移動・名称変更・未整理化・削除・復元・関連付けは pkc-ext の write op(move / rename / unfile / delete / restore / relate)として送り、PKC2 が検証してから反映します(拡張が直接データを書き換えることはありません)',
      '一括操作は複数 op を 1 つの write にまとめて送ります(1 件でも検証 NG なら全体が拒否されます)',
    ],
    notes: [
      'できるのは 閲覧・移動(複数/フォルダ可)・名称変更・未整理へ戻す・削除/復元(ゴミ箱)・孤児アセット掃除・関連付け・選択同期 です',
      'フォルダを自分自身や子孫フォルダへは移動できません(送る前に弾き、PKC2 側でも循環をガードします)',
      '削除は soft delete(ゴミ箱から復元可)。孤児アセットの掃除は参照中のアセットには影響しません',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- toolbar
  const toolbar = el('div', 'pkc-filer-toolbar');
  toolbar.setAttribute('data-pkc-region', 'filer-toolbar');
  const search = textInput('検索(名前 / タグ)…');
  search.setAttribute('data-pkc-field', 'filer-search');
  search.addEventListener('input', () => {
    state.query = search.value;
    renderList();
  });
  toolbar.appendChild(search);
  const sort = selectInput([
    { value: 'updated', label: '更新が新しい順' },
    { value: 'created', label: '作成が新しい順' },
    { value: 'title', label: '名前順' },
    { value: 'type', label: '種類順' },
  ]);
  sort.setAttribute('data-pkc-field', 'filer-sort');
  sort.addEventListener('change', () => {
    state.sortKey = sort.value as SortKey;
    renderList();
  });
  toolbar.appendChild(sort);
  const archetypeSel = selectInput([{ value: '', label: '種類: すべて' }]);
  archetypeSel.setAttribute('data-pkc-field', 'filer-archetype');
  archetypeSel.addEventListener('change', () => {
    state.archetype = archetypeSel.value;
    renderList();
  });
  toolbar.appendChild(archetypeSel);
  const tagSel = selectInput([{ value: '', label: 'タグ: すべて' }]);
  tagSel.setAttribute('data-pkc-field', 'filer-tag');
  tagSel.addEventListener('change', () => {
    state.tag = tagSel.value;
    renderList();
  });
  toolbar.appendChild(tagSel);
  root.appendChild(toolbar);

  crumbEl = el('div', 'pkc-filer-crumbs');
  crumbEl.setAttribute('data-pkc-region', 'filer-crumbs');
  root.appendChild(crumbEl);

  // ---- panes
  const split = el('div', 'pkc-filer-split');
  treeEl = el('div', 'pkc-paper pkc-filer-tree');
  treeEl.setAttribute('data-pkc-region', 'filer-tree');
  listEl = el('div', 'pkc-paper pkc-filer-list');
  listEl.setAttribute('data-pkc-region', 'filer-list');
  split.appendChild(treeEl);
  split.appendChild(listEl);
  root.appendChild(split);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'filer-status');
  root.appendChild(statusEl);

  // archetype / tag セレクタは projection 到着時に options を埋める
  const fillSelectors = (): void => {
    const p = state.projection;
    if (!p) return;
    const archetypes = [...new Set(p.entries.map((e) => e.archetype))].filter((a) => a !== 'folder').sort();
    archetypeSel.replaceChildren();
    archetypeSel.appendChild(optionEl('', '種類: すべて'));
    for (const a of archetypes) archetypeSel.appendChild(optionEl(a, `種類: ${a}`));
    archetypeSel.value = state.archetype;
    tagSel.replaceChildren();
    tagSel.appendChild(optionEl('', 'タグ: すべて'));
    for (const t of allTags(p)) tagSel.appendChild(optionEl(t, `タグ: ${t}`));
    tagSel.value = state.tag;
  };

  channel = new ExtChannel({
    onProjection: (p) => {
      onProjection(p);
      fillSelectors();
    },
    onDeliver: () => undefined,
    onWriteResult,
    onSelected,
  });
  const connected = channel.start();

  setStatus(connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動するとファイラが使えます)');
  renderTree();
  renderList();
  renderCrumb();

  return { channel };
}

function optionEl(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

const mountTarget = document.getElementById('filer-root');
if (mountTarget) mountFilerPro(mountTarget);
