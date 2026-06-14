/**
 * G2 kanban-pro — todo の open/done Kanban (issue #106)。
 *
 * R1 の projection todo メタで列を構築し、done への D&D は R2 の
 * `set-todo-status` write op で書き戻す(host 検証、本文を持たない)。
 * 本体パリティ: archived todo は常に除外。past due は status open かつ期日 < 今日。
 *
 * 確定モデル: 楽観更新しない。write-result でフィードバック → 次 projection
 * 再 push で列が確定する(host が正)。
 */

import '../../shared/base.css';
import './kanban.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, selectInput, textInput } from '../../shared/ui';
import {
  isPastDue,
  kanbanColumns,
  setStatusOp,
  todayISO,
  todoFolders,
  todoMeta,
  todoTags,
  type KanbanFilter,
  type TodoStatus,
} from './kanban';

const TOOL_NAME = 'pkc2-kanban-pro';
const TOOL_VERSION = '0.1.0';

interface KanbanState {
  projection: ContainerProjection | null;
  filter: KanbanFilter;
  selectedLid: string | null;
}

const state: KanbanState = { projection: null, filter: { query: '', folder: '', tag: '' }, selectedLid: null };

let channel: ExtChannel | null = null;
let boardEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let folderSel: HTMLSelectElement | null = null;
let tagSel: HTMLSelectElement | null = null;
let draggingLid: string | null = null;
const pendingWrites = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function requestSetStatus(lid: string, status: TodoStatus): boolean {
  const p = state.projection;
  if (!p) return false;
  const e = p.entries.find((x) => x.lid === lid);
  const m = e ? todoMeta(e) : null;
  if (!m) return false;
  if (m.status === status) return false; // 同列ドロップ = no-op(無駄打ち抑制)
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため変更できません(standalone)');
    return false;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([setStatusOp(lid, status)], lid, cid);
  if (ok) {
    pendingWrites.set(cid, status === 'done' ? '完了化' : '未完了に戻す');
    setStatus(`☑️ 「${e?.title ?? lid}」を ${status === 'done' ? 'done' : 'open'} へ — PKC2 が検証して反映します`);
  }
  return ok;
}

function onWriteResult(ok: boolean, cid: string | null): void {
  const label = cid !== null ? pendingWrites.get(cid) : undefined;
  if (cid !== null) pendingWrites.delete(cid);
  setStatus(ok ? `✅ ${label ?? '変更'}を反映しました` : `✖ ${label ?? '変更'}は拒否されました(PKC2 の検証 NG)`);
}

/* -------------------------------------------------------------- render */

function card(e: ProjectionEntry, today: string): HTMLElement {
  const c = el('div', 'pkc-kanban-card');
  c.setAttribute('data-pkc-lid', e.lid);
  if (e.lid === state.selectedLid) c.classList.add('pkc-kanban-selected');
  c.draggable = true;
  c.addEventListener('dragstart', (ev) => {
    draggingLid = e.lid;
    ev.dataTransfer?.setData('text/plain', e.lid);
  });
  c.addEventListener('dragend', () => {
    draggingLid = null;
  });

  const titleRow = el('div', 'pkc-kanban-cardtitle');
  if (e.color_tag && /^#[0-9a-fA-F]{3,8}$/.test(e.color_tag)) {
    const dot = el('span', 'pkc-kanban-colordot');
    dot.style.background = e.color_tag;
    titleRow.appendChild(dot);
  }
  titleRow.appendChild(el('span', 'pkc-kanban-titletext', e.title || '(無題)'));
  c.appendChild(titleRow);

  const m = todoMeta(e)!;
  const meta = el('div', 'pkc-kanban-cardmeta');
  if (m.date !== undefined) {
    const dchip = el('span', 'pkc-kanban-date', `📅 ${m.date}`);
    if (isPastDue(e, today)) dchip.classList.add('pkc-kanban-pastdue');
    meta.appendChild(dchip);
  }
  for (const t of (e.tags ?? []).slice(0, 4)) meta.appendChild(el('span', 'pkc-kanban-tag', t));
  if (meta.childNodes.length > 0) c.appendChild(meta);

  // single click = select(同期)、double click = open(前面化)
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  c.addEventListener('click', () => {
    if (clickTimer !== null) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      state.selectedLid = e.lid;
      channel?.sendHint('select', e.lid);
      renderBoard();
    }, 220);
  });
  c.addEventListener('dblclick', () => {
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    state.selectedLid = e.lid;
    channel?.sendHint('open', e.lid);
    setStatus(`「${e.title}」を PKC2 で開きました`);
    renderBoard();
  });

  return c;
}

function column(title: string, status: TodoStatus, entries: ProjectionEntry[], today: string): HTMLElement {
  const col = el('div', 'pkc-kanban-col');
  col.setAttribute('data-pkc-col', status);
  const head = el('div', 'pkc-kanban-colhead');
  head.appendChild(el('span', 'pkc-kanban-coltitle', title));
  head.appendChild(el('span', 'pkc-kanban-colcount', String(entries.length)));
  col.appendChild(head);

  const bodyEl = el('div', 'pkc-kanban-colbody');
  bodyEl.setAttribute('data-pkc-region', `kanban-col-${status}`);
  for (const e of entries) bodyEl.appendChild(card(e, today));
  if (entries.length === 0) bodyEl.appendChild(el('div', 'pkc-hint', '(なし)'));

  // ---- drop target: この列のステータスへ set
  bodyEl.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    col.classList.add('pkc-kanban-droptarget');
  });
  bodyEl.addEventListener('dragleave', () => col.classList.remove('pkc-kanban-droptarget'));
  bodyEl.addEventListener('drop', (ev) => {
    ev.preventDefault();
    col.classList.remove('pkc-kanban-droptarget');
    const lid = ev.dataTransfer?.getData('text/plain') || draggingLid;
    if (lid) requestSetStatus(lid, status);
  });

  col.appendChild(bodyEl);
  return col;
}

function renderBoard(): void {
  if (!boardEl) return;
  boardEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    boardEl.appendChild(el('div', 'pkc-hint', 'projection 待機中…'));
    return;
  }
  const { open, done } = kanbanColumns(p, state.filter);
  const today = todayISO();
  boardEl.appendChild(column('🟡 未完了 (open)', 'open', open, today));
  boardEl.appendChild(column('✅ 完了 (done)', 'done', done, today));
}

function fillSelectors(): void {
  const p = state.projection;
  if (!p || !folderSel || !tagSel) return;
  folderSel.replaceChildren(optionEl('', 'フォルダ: すべて'));
  for (const f of todoFolders(p)) folderSel.appendChild(optionEl(f.lid, `フォルダ: ${f.title}`));
  folderSel.value = state.filter.folder;
  tagSel.replaceChildren(optionEl('', 'タグ: すべて'));
  for (const t of todoTags(p)) tagSel.appendChild(optionEl(t, `タグ: ${t}`));
  tagSel.value = state.filter.tag;
}

function optionEl(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function onProjection(p: ContainerProjection): void {
  state.projection = p;
  if (state.filter.folder !== '' && !p.entries.some((e) => e.lid === state.filter.folder)) state.filter.folder = '';
  fillSelectors();
  renderBoard();
}

function onSelected(lid: string): void {
  state.selectedLid = lid;
  renderBoard();
}

/* --------------------------------------------------------------- mount */

export function mountKanbanPro(root: HTMLElement): { channel: ExtChannel } {
  state.projection = null;
  state.filter = { query: '', folder: '', tag: '' };
  state.selectedLid = null;
  pendingWrites.clear();
  draggingLid = null;

  root.replaceChildren();
  root.className = 'pkc-kanban-root';

  const header = el('div', 'pkc-kanban-header');
  header.setAttribute('data-pkc-region', 'kanban-header');
  header.appendChild(el('span', 'pkc-kanban-title', '🗂️ PKC2 Kanban Pro'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — todo の open/done ボード`));
  header.appendChild(helpButton('Kanban Pro', {
    what: 'PKC2 の todo を「未完了 / 完了」のボードで表示・操作する拡張です。カードを完了列にドラッグすると、その todo が完了になります(本文はそのまま保たれます)。',
    how: [
      'PKC2 から起動すると open / done の 2 列が出ます',
      'カードを別の列にドラッグ&ドロップ → 完了 / 未完了が切り替わります',
      'カードのクリック = PKC2 で選択、ダブルクリック = 開く',
      '上部で検索 / フォルダ・タグで絞り込み',
    ],
    flow: [
      '列・期日は projection の todo メタ(status / date)だけで作ります — 本文は受け取りません',
      'ステータス変更は set-todo-status を PKC2 に送り、PKC2 が検証して本文(説明)を保ったまま反映します',
      '楽観更新せず、PKC2 からの反映(再描画)で確定します',
    ],
    notes: [
      'アーカイブ済みの todo は常に非表示です(本体の Kanban と同じ)',
      '期日が過ぎた未完了は赤く強調されます',
      '新規 todo の作成はこの拡張では未対応です(PKC2 側の対応待ち #110)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  const toolbar = el('div', 'pkc-kanban-toolbar');
  toolbar.setAttribute('data-pkc-region', 'kanban-toolbar');
  const search = textInput('検索(タイトル / タグ)…');
  search.setAttribute('data-pkc-field', 'kanban-search');
  search.addEventListener('input', () => {
    state.filter.query = search.value;
    renderBoard();
  });
  toolbar.appendChild(search);
  folderSel = selectInput([{ value: '', label: 'フォルダ: すべて' }]);
  folderSel.setAttribute('data-pkc-field', 'kanban-folder');
  folderSel.addEventListener('change', () => {
    state.filter.folder = folderSel!.value;
    renderBoard();
  });
  toolbar.appendChild(folderSel);
  tagSel = selectInput([{ value: '', label: 'タグ: すべて' }]);
  tagSel.setAttribute('data-pkc-field', 'kanban-tag');
  tagSel.addEventListener('change', () => {
    state.filter.tag = tagSel!.value;
    renderBoard();
  });
  toolbar.appendChild(tagSel);
  root.appendChild(toolbar);

  boardEl = el('div', 'pkc-kanban-board');
  boardEl.setAttribute('data-pkc-region', 'kanban-board');
  root.appendChild(boardEl);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'kanban-status');
  root.appendChild(statusEl);

  channel = new ExtChannel({ onProjection, onDeliver: () => undefined, onWriteResult, onSelected });
  const connected = channel.start();
  setStatus(connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると todo ボードが使えます)');
  renderBoard();

  return { channel };
}

const mountTarget = document.getElementById('kanban-root');
if (mountTarget) mountKanbanPro(mountTarget);
