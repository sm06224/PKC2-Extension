/**
 * G1 filer-pro — PKC2 のファイラを拡張側で作り直す (issue #105)。
 *
 * 左 = フォルダツリー、右 = 一覧。projection(メタのみ)で閲覧・検索・
 * ソート・フィルタし、**D&D でフォルダ移動**(pkc-ext write op `move`)・
 * 関連付け(`relate`)・PKC2 との選択同期(hint / selected)を行う。
 *
 * v1 は現行 pkc-ext で完結する範囲(閲覧 + move/relate + 選択同期)のみ。
 * rename / archive / create / 本文プレビューは host 拡張待ち(G0 #110)。
 *
 * セキュリティ: 受信 projection は描画のみ(textContent)。write は host が
 * `validateWriteOps` で検証(G2)。本文・asset は受け取らない(pull 経路なし)。
 */

import '../../shared/base.css';
import './filer.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, selectInput, textInput } from '../../shared/ui';
import {
  allEntries,
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
  type FolderNode,
  type SortKey,
} from './tree';

const TOOL_NAME = 'pkc2-filer-pro';
const TOOL_VERSION = '0.1.0';

const ALL = '__all__';
type Scope = typeof ALL | string | null; // '__all__' / folder lid / null(未整理)

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
};

let channel: ExtChannel | null = null;
let treeEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let crumbEl: HTMLElement | null = null;
let draggingLid: string | null = null;
const pendingWrites = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* ----------------------------------------------------------- write ops */

function requestMove(lid: string, folderLid: string): boolean {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため移動できません(standalone)');
    return false;
  }
  if (lid === folderLid) return false;
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([moveOp(lid, folderLid)], lid, cid);
  if (ok) {
    pendingWrites.set(cid, `移動`);
    setStatus('📁 移動を要求しました — PKC2 が検証して反映します');
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
  row.appendChild(el('span', 'pkc-filer-foldername', node.title));
  row.appendChild(el('span', 'pkc-filer-foldercount', String(node.descendantEntries)));

  row.addEventListener('click', () => {
    state.scope = node.lid;
    renderList();
    renderCrumb();
    renderTree();
  });

  // ---- drop target(entry をこのフォルダへ move)
  row.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    row.classList.add('pkc-filer-droptarget');
  });
  row.addEventListener('dragleave', () => row.classList.remove('pkc-filer-droptarget'));
  row.addEventListener('drop', (ev) => {
    ev.preventDefault();
    row.classList.remove('pkc-filer-droptarget');
    const lid = ev.dataTransfer?.getData('text/plain') || draggingLid;
    if (lid) requestMove(lid, node.lid);
  });

  return row;
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
  treeEl.appendChild(unRow);

  for (const root of buildFolderTree(p)) renderTreeNode(root, 0, treeEl);
}

function entryRow(e: ProjectionEntry): HTMLElement {
  const row = el('div', 'pkc-filer-entryrow');
  row.setAttribute('data-pkc-lid', e.lid);
  if (e.lid === state.selectedLid) row.classList.add('pkc-filer-selected');
  if (e.lid === state.relateFrom) row.classList.add('pkc-filer-relatefrom');
  row.draggable = true;
  row.addEventListener('dragstart', (ev) => {
    draggingLid = e.lid;
    ev.dataTransfer?.setData('text/plain', e.lid);
  });
  row.addEventListener('dragend', () => {
    draggingLid = null;
  });

  row.appendChild(el('span', 'pkc-filer-entryicon', entryIcon(e.archetype, e.mime)));
  const name = el('span', 'pkc-filer-entryname', e.filename ?? e.title);
  row.appendChild(name);
  if (e.color_tag) {
    const dot = el('span', 'pkc-filer-colordot');
    dot.style.background = /^#[0-9a-fA-F]{3,8}$/.test(e.color_tag) ? e.color_tag : 'transparent';
    row.appendChild(dot);
  }
  for (const t of (e.tags ?? []).slice(0, 4)) row.appendChild(el('span', 'pkc-filer-tag', t));
  row.appendChild(el('span', 'pkc-filer-entrymeta', `${e.archetype} · ${e.updated_at.slice(0, 10)}`));

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

  // single click = select(同期)、double click = open(前面化)
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

  return row;
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    listEl.appendChild(el('div', 'pkc-hint', 'projection 待機中…'));
    return;
  }
  const base = scopeEntries(p);
  const shown = sortEntries(
    filterEntries(base, { query: state.query, archetype: state.archetype, tag: state.tag }),
    state.sortKey,
  );
  const heading = el('div', 'pkc-filer-listhead', `${shown.length} 件`);
  listEl.appendChild(heading);
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
  if (typeof state.scope === 'string' && state.scope !== ALL && !folderLids.has(state.scope)) state.scope = ALL;
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
  pendingWrites.clear();
  draggingLid = null;

  root.replaceChildren();
  root.className = 'pkc-filer-root';

  const header = el('div', 'pkc-filer-header');
  header.setAttribute('data-pkc-region', 'filer-header');
  header.appendChild(el('span', 'pkc-filer-title', '🗂️ PKC2 Filer Pro'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 高機能ファイラ(閲覧・整理)`));
  header.appendChild(helpButton('Filer Pro', {
    what: 'PKC2 のファイラを拡張側で作り直した高機能版です。フォルダツリーと一覧で閲覧し、ドラッグ&ドロップでフォルダ移動・関連付け・PKC2 本体との選択同期ができます。',
    how: [
      'PKC2 から起動すると左にフォルダツリー、右に一覧が出ます',
      'entry をドラッグして左のフォルダにドロップ → そのフォルダへ移動',
      'entry 名をクリック = PKC2 で選択(同期)、ダブルクリック = 開く',
      '各行の 🔗 を 2 つの entry で順にクリック → 関連付け',
      '上部で検索 / ソート / archetype・タグで絞り込み',
    ],
    flow: [
      '既定で届くのは projection(メタデータのみ — 本文・添付の実体は含まれません)',
      '移動・関連付けは pkc-ext の write op として送り、PKC2 が検証してから反映します(拡張が直接データを書き換えることはありません)',
    ],
    notes: [
      'v1 でできるのは 閲覧・移動・関連付け・選択同期 です',
      '名称変更・アーカイブ・新規作成・本文プレビューは PKC2 側の機能拡張待ちです(issue #110)',
      'フォルダ外への「未整理に戻す」移動も現状の write op では未対応です',
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
