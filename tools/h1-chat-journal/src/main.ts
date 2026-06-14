/**
 * H1 chat-journal — チャット型セルフメモ (issue #108)。
 *
 * LINE 的な「書く心理コストが最も低い入力面」を拡張で提供する。吹き出し UI /
 * Enter 送信 / Shift+Enter 改行 / 日付セパレータ / 時刻表示 / 紙背景。下書きは
 * ローカル保持(B3 と同じ規律、localStorage)。
 *
 * create(日次 textlog の PKC2 反映)は R5(pkc-ext `t:'propose'` → 既存
 * PendingOffer banner)前提で設計しているが、R5 は PKC2 未実装で、R6 gap により
 * Tier S では v1 envelope `record:offer` も届かない(#830)。よって本 v1 は
 * **create を degrade**:ログはローカルに保持し、日次ログを📋クリップボードへ
 * コピーして PKC2 に手貼りする導線を提供する。R5 着地後に `dailyTextlogProposal`
 * を transport に載せれば直接作成へ昇格できる(`chat.ts` 参照)。
 *
 * ExtChannel(pkc-ext)は接続状態の表示のためだけに使う — projection の中身は
 * 描画しない(chat はコンテナ entry を表示しない入力面)。
 */

import '../../shared/base.css';
import './chat.css';
import { ExtChannel, type ContainerProjection } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el } from '../../shared/ui';
import {
  dayPlainText,
  groupByDay,
  makeMessage,
  timeOf,
  type ChatDay,
  type ChatMessage,
} from './chat';

const TOOL_NAME = 'pkc2-chat-journal';
const TOOL_VERSION = '0.1.0';
const STORE_KEY = 'pkc2-h1-chat-journal:log';

/** クイック挿入(絵文字 / タグ)。タグは `#` 付きで本文に挿入される。 */
const EMOJI_SHORTCUTS = ['👍', '✅', '🎯', '💡', '❓', '🔥', '😌', '🙏'] as const;
const TAG_SHORTCUTS = ['todo', 'idea', 'log', 'mood'] as const;

interface ChatState {
  messages: ChatMessage[];
  connected: boolean;
}

const state: ChatState = { messages: [], connected: false };

let channel: ExtChannel | null = null;
let logEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let statusEl: HTMLElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* -------------------------------------------------------- persistence */

function persist(): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state.messages));
  } catch {
    /* best-effort */
  }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.messages = parsed.filter(
      (m): m is ChatMessage =>
        m !== null
        && typeof m === 'object'
        && typeof (m as ChatMessage).text === 'string'
        && typeof (m as ChatMessage).createdAt === 'string',
    ).map((m) => ({
      id: typeof m.id === 'string' ? m.id : `log-${Math.random().toString(36).slice(2)}`,
      text: m.text,
      createdAt: m.createdAt,
      flags: Array.isArray(m.flags) ? m.flags.filter((f): f is string => typeof f === 'string') : [],
    }));
  } catch {
    /* best-effort */
  }
}

/* --------------------------------------------------------------- ops */

function sendCurrent(): void {
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (text === '') return;
  state.messages.push(makeMessage(text));
  persist();
  inputEl.value = '';
  render();
  scrollToBottom();
  inputEl.focus();
}

function deleteMessage(id: string): void {
  state.messages = state.messages.filter((m) => m.id !== id);
  persist();
  render();
}

function insertAtCursor(snippet: string): void {
  if (!inputEl) return;
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);
  const pad = before === '' || before.endsWith(' ') || before.endsWith('\n') ? '' : ' ';
  inputEl.value = `${before}${pad}${snippet}${after}`;
  const caret = start + pad.length + snippet.length;
  inputEl.selectionStart = inputEl.selectionEnd = caret;
  inputEl.focus();
}

function copyDay(day: ChatDay): void {
  const text = dayPlainText(day);
  const clip = (navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } }).clipboard;
  if (clip?.writeText) {
    clip.writeText(text).then(
      () => setStatus(`📋 「${day.label}」の日次ログをコピーしました — PKC2 の textlog に貼り付けられます`),
      () => setStatus('クリップボードへのコピーに失敗しました(権限)'),
    );
  } else {
    setStatus('このブラウザではコピー不可 — 手動で選択してコピーしてください');
  }
}

function scrollToBottom(): void {
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

/* ------------------------------------------------------------ render */

function bubble(m: ChatMessage): HTMLElement {
  const row = el('div', 'pkc-chat-row');
  row.setAttribute('data-pkc-mid', m.id);

  const b = el('div', 'pkc-chat-bubble');
  b.appendChild(el('div', 'pkc-chat-text', m.text));
  if (m.flags.length > 0) {
    const tags = el('div', 'pkc-chat-tags');
    for (const f of m.flags) tags.appendChild(el('span', 'pkc-chat-tag', `#${f}`));
    b.appendChild(tags);
  }
  row.appendChild(b);

  const meta = el('div', 'pkc-chat-meta');
  meta.appendChild(el('span', 'pkc-chat-time', timeOf(m.createdAt)));
  meta.appendChild(button('✕', 'pkc-chat-del', () => deleteMessage(m.id), 'この行を削除'));
  row.appendChild(meta);
  return row;
}

function daySeparator(day: ChatDay): HTMLElement {
  const sep = el('div', 'pkc-chat-daysep');
  sep.setAttribute('data-pkc-date', day.date);
  sep.appendChild(el('span', 'pkc-chat-daylabel', day.label));
  sep.appendChild(
    button('📋', 'pkc-btn-small pkc-chat-daycopy', () => copyDay(day), 'この日のログをコピー(PKC2 へ手貼り)'),
  );
  return sep;
}

function render(): void {
  if (!logEl) return;
  logEl.replaceChildren();
  const days = groupByDay(state.messages);
  if (days.length === 0) {
    logEl.appendChild(el('div', 'pkc-hint', 'まだ記録がありません — 下の入力欄に書いて Enter で追記します'));
    return;
  }
  for (const day of days) {
    logEl.appendChild(daySeparator(day));
    for (const m of day.messages) logEl.appendChild(bubble(m));
  }
}

/* ------------------------------------------------------------ channel */

function onProjection(_p: ContainerProjection): void {
  if (state.connected) return;
  state.connected = true;
  setStatus('🟢 PKC2 に接続(create は対応待ち。📋 で日次ログをコピーして手貼りできます)');
}

/* -------------------------------------------------------------- mount */

export function mountChatJournal(root: HTMLElement): { channel: ExtChannel } {
  state.messages = [];
  state.connected = false;

  root.replaceChildren();
  root.className = 'pkc-chat-root';

  // ---- header
  const header = el('div', 'pkc-chat-header');
  header.setAttribute('data-pkc-region', 'chat-header');
  header.appendChild(el('span', 'pkc-chat-apptitle', '💬 PKC2 Chat Journal'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — チャット型セルフメモ`));
  header.appendChild(helpButton('Chat Journal', {
    what: 'LINE のように自分宛てメモを吹き出しで書きためる日誌ツールです。記録はこのブラウザにローカル保存され、日次ログを PKC2 の textlog に手貼りできます。',
    how: [
      '下の入力欄に書いて Enter で追記(Shift+Enter で改行)',
      '本文に #タグ を書くとタグとして記録されます(😀 / # ボタンで素早く挿入)',
      '日付セパレータの 📋 でその日のログをコピー → PKC2 の textlog に貼り付け',
      '不要な行は ✕ で削除',
    ],
    flow: [
      '記録は textlog 互換の形式({entries:[{text,createdAt,flags}…]})でローカル保持されます',
      'PKC2 への直接作成は pkc-ext の create(R5 propose)待ちです。届くまでは 📋 コピー → 手貼りで連携します',
      'projection は接続確認にだけ使い、コンテナの中身は表示しません(入力に専念)',
    ],
    notes: [
      '記録はこのブラウザの localStorage にあります(別ブラウザ・別端末からは見えません)',
      'PKC2 への直接作成(新規 entry)はこの拡張ではまだ無効です(PKC2 側 R5 対応待ち #110 / #830)',
    ],
  }));
  root.appendChild(header);

  // ---- chat log (paper)
  logEl = el('div', 'pkc-paper pkc-chat-log');
  logEl.setAttribute('data-pkc-region', 'chat-log');
  root.appendChild(logEl);

  // ---- composer
  const composer = el('div', 'pkc-chat-composer');
  composer.setAttribute('data-pkc-region', 'chat-composer');

  const shortcuts = el('div', 'pkc-chat-shortcuts');
  for (const e of EMOJI_SHORTCUTS) {
    shortcuts.appendChild(button(e, 'pkc-btn-small pkc-chat-emoji', () => insertAtCursor(e), `${e} を挿入`));
  }
  for (const t of TAG_SHORTCUTS) {
    shortcuts.appendChild(button(`#${t}`, 'pkc-btn-small pkc-chat-tagbtn', () => insertAtCursor(`#${t}`), `#${t} を挿入`));
  }
  composer.appendChild(shortcuts);

  const inputRow = el('div', 'pkc-chat-inputrow');
  inputEl = document.createElement('textarea');
  inputEl.className = 'pkc-chat-input';
  inputEl.rows = 2;
  inputEl.placeholder = '自分宛てメモ… (Enter で送信 / Shift+Enter で改行)';
  inputEl.setAttribute('data-pkc-field', 'chat-input');
  inputEl.addEventListener('keydown', (ev) => {
    // IME 変換確定の Enter は送信しない(日本語入力対策)。
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      sendCurrent();
    }
  });
  inputRow.appendChild(inputEl);
  inputRow.appendChild(button('送信', 'pkc-btn pkc-chat-send', () => sendCurrent()));
  composer.appendChild(inputRow);
  root.appendChild(composer);

  // ---- status
  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'chat-status');
  root.appendChild(statusEl);

  restore();
  render();
  scrollToBottom();

  channel = new ExtChannel({ onProjection });
  const connected = channel.start();
  setStatus(
    connected
      ? 'PKC2 を検出 — 接続確認中…(記録はローカルに保存。日次ログは 📋 で手貼り)'
      : 'standalone 起動 — 記録はこのブラウザにローカル保存されます',
  );

  return { channel };
}

const mountTarget = document.getElementById('chat-root');
if (mountTarget) mountChatJournal(mountTarget);
