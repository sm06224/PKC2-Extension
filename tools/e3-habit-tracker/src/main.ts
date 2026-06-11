/**
 * E3 habit-tracker — 習慣リストから今日の todo 群を生成して offer (issue #54).
 */

import '../../shared/base.css';
import './tool.css';
import { sendBatch, type BatchRow } from '../../shared/batch-offer';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { serializeTodoBody } from '../../shared/todo-body';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-habit-tracker';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const STORE_KEY = 'pkc2-e3-habits:list';

/** 今日の日付(YYYY-MM-DD)。Pure. */
export function todayStr(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 習慣 → 今日の todo offer 行。Pure. */
export function habitsToRows(habits: readonly string[], d: Date = new Date()): BatchRow[] {
  const date = todayStr(d);
  return habits
    .map((h) => h.trim())
    .filter((h) => h !== '')
    .map((h) => ({ title: `🔁 ${h}`, body: serializeTodoBody(h, date), archetype: 'todo' }));
}

let habits: string[] = [];
let listEl: HTMLElement | null = null;
let ui: ReturnType<typeof createOfferUi> | null = null;

function persist(): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(habits));
  } catch { /* best-effort */ }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) habits = parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* best-effort */ }
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (habits.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', '習慣を追加してください(例: ストレッチ、英語 10 分)'));
    return;
  }
  for (const [i, h] of habits.entries()) {
    const row = el('div', 'pkc-sot-listrow');
    row.appendChild(el('span', 'pkc-sot-grow', `🔁 ${h}`));
    row.appendChild(button('✕', 'pkc-btn-small', () => {
      habits.splice(i, 1);
      persist();
      renderList();
    }));
    listEl.appendChild(row);
  }
}

export function mountHabits(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '🔁 PKC2 Habit Tracker'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 習慣リスト → 今日の todo を一括生成`));
  header.appendChild(helpButton('Habit Tracker', {
    what: '毎日の習慣リストをローカルに持ち、ワンクリックで「今日の分の todo 群」を生成して offer します(cron 的 todo 生成)。',
    how: ['習慣を追加(localStorage に保存)', '毎朝「今日の分を todo 化」を押す', 'PKC2 側 banner で accept(1 件ずつ)'],
    flow: ['各習慣が期日 = 今日の todo offer になります(600ms 間隔・停止可)'],
    notes: ['自動実行はしません(単一 HTML にスケジューラは無いため、開いて押す運用)', '完了チェックは PKC2 側の todo で行います'],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'tool-form');
  const input = textInput('習慣(Enter で追加)');
  const add = (): void => {
    const v = input.value.trim();
    if (v === '') return;
    habits.push(v);
    persist();
    renderList();
    input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      add();
    }
  });
  const row = el('div', 'pkc-btn-row');
  row.appendChild(input);
  row.appendChild(button('追加', 'pkc-btn-small', add));
  row.appendChild(button(`今日の分を todo 化(${todayStr()})`, 'pkc-btn', () => {
    if (!ui) return;
    const rows = habitsToRows(habits);
    if (rows.length === 0) {
      ui.note('習慣がありません');
      return;
    }
    const u = ui;
    u.note(`送信中 0/${rows.length}…`);
    sendBatch(u.conn, u.tracker, rows, (sent, total, done) => {
      u.note(done ? `完了: ${sent}/${total} 件` : `送信中 ${sent}/${total}…`);
    });
  }));
  form.appendChild(row);
  root.appendChild(form);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'tool-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', '習慣リスト(ローカル)'));
  listEl = el('div', 'pkc-sot-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);
  root.appendChild(ui.offersPanel);

  restore();
  renderList();
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountHabits(mountTarget);
