/**
 * G3 calendar-pro — todo 期日の月カレンダー + アジェンダ (issue #107)。
 *
 * R1 の projection todo メタ(`date`)で日付配置、past due 強調。
 * チェックボックスで done 化(R2 set-todo-status、本文保全)。本体の
 * `showArchived` 相当のトグルで archived の表示/非表示を切替。
 *
 * 確定モデル: 楽観更新せず write-result + 次 projection で確定。
 */

import '../../shared/base.css';
import './calendar.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { setStatusOp, todoMeta } from '../../shared/todo-meta';
import { button, el } from '../../shared/ui';
import {
  agenda,
  isPastDue,
  monthGrid,
  monthOf,
  shiftMonth,
  todayISO,
  todosByDate,
  weekdayLabels,
  type CalDay,
} from './calendar';

const TOOL_NAME = 'pkc2-calendar-pro';
const TOOL_VERSION = '0.1.0';

interface CalState {
  projection: ContainerProjection | null;
  month: string; // YYYY-MM
  showArchived: boolean;
  selectedLid: string | null;
}

const state: CalState = { projection: null, month: monthOf(new Date()), showArchived: false, selectedLid: null };

let channel: ExtChannel | null = null;
let gridEl: HTMLElement | null = null;
let agendaEl: HTMLElement | null = null;
let monthLabel: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
const pendingWrites = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function requestToggleDone(e: ProjectionEntry): boolean {
  const m = todoMeta(e);
  if (!m) return false;
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため変更できません(standalone)');
    return false;
  }
  const next = m.status === 'done' ? 'open' : 'done';
  const cid = makeCorrelationId();
  const ok = channel.sendWrite([setStatusOp(e.lid, next)], e.lid, cid);
  if (ok) {
    pendingWrites.set(cid, next === 'done' ? '完了化' : '未完了化');
    setStatus(`☑️ 「${e.title}」を ${next} へ — PKC2 が検証して反映します`);
  }
  return ok;
}

function onWriteResult(ok: boolean, cid: string | null): void {
  const label = cid !== null ? pendingWrites.get(cid) : undefined;
  if (cid !== null) pendingWrites.delete(cid);
  setStatus(ok ? `✅ ${label ?? '変更'}を反映しました` : `✖ ${label ?? '変更'}は拒否されました(PKC2 の検証 NG)`);
}

/* -------------------------------------------------------------- render */

function todoChip(e: ProjectionEntry, today: string): HTMLElement {
  const m = todoMeta(e)!;
  const chip = el('div', 'pkc-cal-chip');
  chip.setAttribute('data-pkc-lid', e.lid);
  if (m.status === 'done') chip.classList.add('pkc-cal-done');
  if (isPastDue(e, today)) chip.classList.add('pkc-cal-pastdue');
  if (m.archived) chip.classList.add('pkc-cal-archived');
  if (e.lid === state.selectedLid) chip.classList.add('pkc-cal-selected');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = m.status === 'done';
  check.className = 'pkc-cal-check';
  check.setAttribute('data-pkc-action', 'toggle-done');
  check.addEventListener('click', (ev) => {
    ev.stopPropagation();
    requestToggleDone(e);
  });
  chip.appendChild(check);

  if (e.color_tag && /^#[0-9a-fA-F]{3,8}$/.test(e.color_tag)) {
    const dot = el('span', 'pkc-cal-colordot');
    dot.style.background = e.color_tag;
    chip.appendChild(dot);
  }
  const label = el('span', 'pkc-cal-chiptext', e.title || '(無題)');
  chip.appendChild(label);

  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  label.addEventListener('click', () => {
    if (clickTimer !== null) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      state.selectedLid = e.lid;
      channel?.sendHint('select', e.lid);
      render();
    }, 220);
  });
  label.addEventListener('dblclick', () => {
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    state.selectedLid = e.lid;
    channel?.sendHint('open', e.lid);
    setStatus(`「${e.title}」を PKC2 で開きました`);
    render();
  });

  return chip;
}

function dayCell(d: CalDay, today: string): HTMLElement {
  const cell = el('div', 'pkc-cal-day');
  cell.setAttribute('data-pkc-date', d.date);
  if (!d.inMonth) cell.classList.add('pkc-cal-outmonth');
  if (d.isToday) cell.classList.add('pkc-cal-today');
  if (d.weekday === 0) cell.classList.add('pkc-cal-sun');
  if (d.weekday === 6) cell.classList.add('pkc-cal-sat');

  cell.appendChild(el('div', 'pkc-cal-daynum', String(d.day)));
  const list = el('div', 'pkc-cal-daytodos');
  for (const e of d.todos) list.appendChild(todoChip(e, today));
  cell.appendChild(list);
  return cell;
}

function render(): void {
  if (!gridEl || !agendaEl || !monthLabel) return;
  const p = state.projection;
  monthLabel.textContent = state.month.replace('-', '年') + '月';
  gridEl.replaceChildren();
  agendaEl.replaceChildren();
  if (!p) {
    gridEl.appendChild(el('div', 'pkc-hint', 'projection 待機中…'));
    return;
  }
  const today = todayISO();
  const byDate = todosByDate(p, { showArchived: state.showArchived });

  // weekday header
  const headRow = el('div', 'pkc-cal-weekhead');
  for (const w of weekdayLabels(0)) headRow.appendChild(el('div', 'pkc-cal-weekcell', w));
  gridEl.appendChild(headRow);

  const grid = el('div', 'pkc-cal-grid');
  grid.setAttribute('data-pkc-region', 'cal-grid');
  for (const d of monthGrid(state.month, byDate, today, 0)) grid.appendChild(dayCell(d, today));
  gridEl.appendChild(grid);

  // agenda
  const items = agenda(p, { showArchived: state.showArchived });
  agendaEl.appendChild(el('div', 'pkc-panel-heading', `📋 期日つき todo(${items.length})`));
  if (items.length === 0) {
    agendaEl.appendChild(el('div', 'pkc-hint', '期日のある todo はありません'));
  } else {
    for (const e of items) {
      const row = el('div', 'pkc-cal-agendarow');
      row.appendChild(el('span', 'pkc-cal-agendadate', todoMeta(e)!.date ?? ''));
      row.appendChild(todoChip(e, today));
      agendaEl.appendChild(row);
    }
  }
}

function onProjection(p: ContainerProjection): void {
  state.projection = p;
  render();
}

function onSelected(lid: string): void {
  state.selectedLid = lid;
  render();
}

/* --------------------------------------------------------------- mount */

export function mountCalendarPro(root: HTMLElement): { channel: ExtChannel } {
  state.projection = null;
  state.month = monthOf(new Date());
  state.showArchived = false;
  state.selectedLid = null;
  pendingWrites.clear();

  root.replaceChildren();
  root.className = 'pkc-cal-root';

  const header = el('div', 'pkc-cal-header');
  header.setAttribute('data-pkc-region', 'cal-header');
  header.appendChild(el('span', 'pkc-cal-title', '📅 PKC2 Calendar Pro'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — todo 期日カレンダー`));
  header.appendChild(helpButton('Calendar Pro', {
    what: 'PKC2 の todo を期日でカレンダー表示する拡張です。チェックを付けると完了になります(本文はそのまま保たれます)。',
    how: [
      'PKC2 から起動すると今月のカレンダーが出ます',
      '◀ ▶ で月移動、「今日」で現在月へ',
      'todo のチェックで完了/未完了を切替',
      'todo クリック = PKC2 で選択、ダブルクリック = 開く',
      '「アーカイブ表示」でアーカイブ済みも表示',
    ],
    flow: [
      '期日 / past due は projection の todo メタ(date / status)だけで判定します — 本文は受け取りません',
      '完了切替は set-todo-status を送り、PKC2 が本文(説明)を保ったまま反映します',
    ],
    notes: [
      '期日が過ぎた未完了は赤く強調されます',
      'アーカイブ済みは既定で非表示(本体の showArchived 相当のトグルで表示)',
      '新規 todo の作成・期日変更はこの拡張では未対応です(PKC2 側の対応待ち #110)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- toolbar
  const toolbar = el('div', 'pkc-cal-toolbar');
  toolbar.setAttribute('data-pkc-region', 'cal-toolbar');
  toolbar.appendChild(button('◀', 'pkc-btn-small', () => {
    state.month = shiftMonth(state.month, -1);
    render();
  }, '前の月'));
  monthLabel = el('span', 'pkc-cal-monthlabel');
  monthLabel.setAttribute('data-pkc-field', 'cal-month');
  toolbar.appendChild(monthLabel);
  toolbar.appendChild(button('▶', 'pkc-btn-small', () => {
    state.month = shiftMonth(state.month, 1);
    render();
  }, '次の月'));
  toolbar.appendChild(button('今日', 'pkc-btn-small', () => {
    state.month = monthOf(new Date());
    render();
  }));
  const archToggle = button('アーカイブ表示: OFF', 'pkc-btn-small', () => {
    state.showArchived = !state.showArchived;
    archToggle.textContent = state.showArchived ? 'アーカイブ表示: ON' : 'アーカイブ表示: OFF';
    render();
  });
  archToggle.setAttribute('data-pkc-field', 'cal-archived');
  toolbar.appendChild(archToggle);
  root.appendChild(toolbar);

  const main = el('div', 'pkc-cal-main');
  gridEl = el('div', 'pkc-paper pkc-cal-calendar');
  gridEl.setAttribute('data-pkc-region', 'cal-calendar');
  agendaEl = el('div', 'pkc-paper pkc-cal-agenda');
  agendaEl.setAttribute('data-pkc-region', 'cal-agenda');
  main.appendChild(gridEl);
  main.appendChild(agendaEl);
  root.appendChild(main);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'cal-status');
  root.appendChild(statusEl);

  channel = new ExtChannel({ onProjection, onDeliver: () => undefined, onWriteResult, onSelected });
  const connected = channel.start();
  setStatus(connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると todo カレンダーが使えます)');
  render();

  return { channel };
}

const mountTarget = document.getElementById('cal-root');
if (mountTarget) mountCalendarPro(mountTarget);
