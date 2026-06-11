/**
 * E2 expense-tracker — 家計簿(textlog ベース)(issue #53).
 *
 * 計画では form archetype 想定だったが、PKC2 の form body は固定 3
 * フィールド(name/note/checked)で家計簿を表現できないため、
 * **textlog ベースへ方針変更**:支出をローカルに記帳 → 1 日分を
 * 「¥金額 内容 #カテゴリ」の textlog として offer(PKC2 の検索とも相性◎)。
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { dailyTitle, makeLogEntry, serializeTextlogEntries } from '../../shared/textlog-body';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-expense-tracker';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const STORE_KEY = 'pkc2-e2-expense:items';
const CATEGORIES = ['食費', '交通', '日用品', '交際', '趣味', 'その他'];

export interface Expense {
  amount: number;
  label: string;
  category: string;
  at: string; // ISO
}

/** 1 支出 → 1 ログ行。Pure. */
export function expenseLine(e: Expense): string {
  return `¥${e.amount.toLocaleString('ja-JP')} ${e.label} #${e.category}`;
}

/** 合計。Pure. */
export function totalOf(items: readonly Expense[]): number {
  return items.reduce((sum, e) => sum + e.amount, 0);
}

let items: Expense[] = [];
let listEl: HTMLElement | null = null;
let totalEl: HTMLElement | null = null;
let ui: ReturnType<typeof createOfferUi> | null = null;

function persist(): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch { /* best-effort */ }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    items = parsed.filter(
      (x): x is Expense =>
        x !== null && typeof x === 'object'
        && typeof (x as Expense).amount === 'number'
        && typeof (x as Expense).label === 'string',
    );
  } catch { /* best-effort */ }
}

function renderList(): void {
  if (!listEl || !totalEl) return;
  listEl.replaceChildren();
  for (const [i, e] of items.entries()) {
    const row = el('div', 'pkc-sot-listrow');
    row.appendChild(el('span', 'pkc-sot-grow', expenseLine(e)));
    row.appendChild(button('✕', 'pkc-btn-small', () => {
      items.splice(i, 1);
      persist();
      renderList();
    }));
    listEl.appendChild(row);
  }
  totalEl.textContent = `合計: ¥${totalOf(items).toLocaleString('ja-JP')}(${items.length} 件)`;
}

export function mountExpense(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '💰 PKC2 Expense Tracker'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 記帳 → 1 日分を textlog offer`));
  header.appendChild(helpButton('Expense Tracker', {
    what: '支出をローカルに記帳し、まとめて「¥金額 内容 #カテゴリ」形式の textlog として PKC2 に offer する家計簿です。',
    how: ['金額・内容・カテゴリを入れて「記帳」(Enter でも可)', '合計を確認', '「textlog として offer」→ accept 後「クリア」'],
    flow: ['1 支出 = 1 ログ行。#カテゴリ表記なので PKC2 の検索でカテゴリ集計しやすい形です'],
    notes: ['計画の form archetype は固定 3 フィールドのため textlog ベースに変更しています', '記帳データはこのブラウザの localStorage にあります'],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'tool-form');
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.placeholder = '金額';
  amount.setAttribute('data-pkc-field', 'expense-amount');
  const label = textInput('内容(例: コーヒー)');
  const cat = selectInput(CATEGORIES.map((c) => ({ value: c, label: c })));
  const err = el('div', 'pkc-form-error');
  const add = (): void => {
    err.textContent = '';
    const n = Number(amount.value);
    if (!Number.isFinite(n) || n <= 0 || label.value.trim() === '') {
      err.textContent = '金額(正の数)と内容を入れてください';
      return;
    }
    items.push({ amount: Math.round(n), label: label.value.trim(), category: cat.value, at: new Date().toISOString() });
    persist();
    renderList();
    amount.value = '';
    label.value = '';
    amount.focus();
  };
  label.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      add();
    }
  });
  const row = el('div', 'pkc-btn-row');
  row.appendChild(amount);
  row.appendChild(label);
  row.appendChild(cat);
  row.appendChild(button('記帳', 'pkc-btn', add));
  form.appendChild(row);
  form.appendChild(err);
  root.appendChild(form);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'tool-list');
  totalEl = el('div', 'pkc-panel-heading');
  listPanel.appendChild(totalEl);
  listEl = el('div', 'pkc-sot-list');
  listPanel.appendChild(listEl);
  const row2 = el('div', 'pkc-btn-row');
  row2.appendChild(button('textlog として offer', 'pkc-btn', () => {
    if (items.length === 0) {
      ui?.note('記帳がありません');
      return;
    }
    const title = `家計簿 ${dailyTitle()}`;
    const entries = items.map((e) => makeLogEntry(expenseLine(e), new Date(e.at)));
    entries.push(makeLogEntry(`合計 ¥${totalOf(items).toLocaleString('ja-JP')}`));
    ui?.sendTracked(title, { title, body: serializeTextlogEntries(entries), archetype: 'textlog' });
  }));
  row2.appendChild(button('クリア', 'pkc-btn-small', () => {
    items = [];
    persist();
    renderList();
  }));
  listPanel.appendChild(row2);
  root.appendChild(listPanel);
  root.appendChild(ui.offersPanel);

  restore();
  renderList();
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountExpense(mountTarget);
