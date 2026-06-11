/**
 * E1 reading-list — URL 読書管理 → text offer (issue #52).
 *
 * URL をローカルの読書リスト(localStorage)で管理し、項目ごとに
 * source_url 付き text entry として PKC2 へ offer できる。状態
 * (積読/読書中/読了)はローカル管理(v1 に entry 更新経路が無いため、
 * offer は「いまの状態のスナップショット」)。
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-reading-list';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const STORE_KEY = 'pkc2-e1-reading-list:items';
const STATUSES = ['積読', '読書中', '読了'] as const;

export interface ReadingItem {
  id: string;
  url: string;
  title: string;
  memo: string;
  status: (typeof STATUSES)[number];
  addedAt: string;
}

/** item → offer payload。Pure. */
export function itemToPayload(item: ReadingItem): Record<string, unknown> {
  const body = [
    `[${item.title}](${item.url})`,
    '',
    `- 状態: ${item.status}`,
    `- 追加: ${item.addedAt.slice(0, 10)}`,
    ...(item.memo !== '' ? ['', item.memo] : []),
  ].join('\n');
  return { title: `📖 ${item.title}`, body, archetype: 'text', source_url: item.url };
}

let items: ReadingItem[] = [];
let listEl: HTMLElement | null = null;
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
      (x): x is ReadingItem =>
        x !== null && typeof x === 'object'
        && typeof (x as ReadingItem).url === 'string'
        && typeof (x as ReadingItem).title === 'string',
    );
  } catch { /* best-effort */ }
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (items.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', 'URL とタイトルを追加してください'));
    return;
  }
  for (const item of items) {
    const row = el('div', 'pkc-sot-listrow');
    row.appendChild(el('span', 'pkc-sot-status', item.status));
    const t = el('span', 'pkc-sot-grow', `${item.title} — ${item.url}`);
    t.title = item.memo;
    row.appendChild(t);
    row.appendChild(button('状態', 'pkc-btn-small', () => {
      const i = STATUSES.indexOf(item.status);
      item.status = STATUSES[(i + 1) % STATUSES.length]!;
      persist();
      renderList();
    }, '積読 → 読書中 → 読了 を循環'));
    row.appendChild(button('offer', 'pkc-btn-small', () => {
      ui?.sendTracked(`📖 ${item.title}`, itemToPayload(item));
    }));
    row.appendChild(button('✕', 'pkc-btn-small', () => {
      items = items.filter((x) => x.id !== item.id);
      persist();
      renderList();
    }));
    listEl.appendChild(row);
  }
}

export function mountReadingList(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '📖 PKC2 Reading List'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — URL 読書管理 + 個別 offer`));
  header.appendChild(helpButton('Reading List', {
    what: '読みたい URL をローカルで管理し、項目ごとに source_url 付き text entry として PKC2 に offer します。',
    how: ['URL・タイトル・メモを入れて「追加」', '「状態」で 積読 → 読書中 → 読了 を切替', '残したい項目は「offer」で PKC2 へ', '✕ でリストから削除'],
    flow: ['offer の body は markdown リンク + 状態 + メモ。source_url が付くので host 側で provenance ヘッダが注入されます'],
    notes: ['状態はローカル管理です(v1 に entry 更新経路が無いため、offer は送信時点のスナップショット)', 'リストはこのブラウザの localStorage に保存されます'],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'tool-form');
  const url = textInput('https://…');
  const title = textInput('タイトル(空なら URL)');
  const memo = textInput('メモ(任意)');
  const err = el('div', 'pkc-form-error');
  const row = el('div', 'pkc-btn-row');
  row.appendChild(url);
  row.appendChild(title);
  row.appendChild(memo);
  row.appendChild(button('追加', 'pkc-btn', () => {
    err.textContent = '';
    const u = url.value.trim();
    if (!/^https?:\/\//i.test(u)) {
      err.textContent = 'http(s) の URL を入れてください';
      return;
    }
    items.push({
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      url: u,
      title: title.value.trim() !== '' ? title.value.trim() : u,
      memo: memo.value.trim(),
      status: '積読',
      addedAt: new Date().toISOString(),
    });
    persist();
    renderList();
    url.value = '';
    title.value = '';
    memo.value = '';
    url.focus();
  }));
  form.appendChild(row);
  form.appendChild(err);
  root.appendChild(form);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'tool-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', '読書リスト(ローカル)'));
  listEl = el('div', 'pkc-sot-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);
  root.appendChild(ui.offersPanel);

  restore();
  renderList();
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountReadingList(mountTarget);
