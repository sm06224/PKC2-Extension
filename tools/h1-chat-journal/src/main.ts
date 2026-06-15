/**
 * H1 chat-journal — チャット型セルフメモ (issue #108)。
 *
 * LINE 的な「書く心理コストが最も低い入力面」を拡張で提供する。吹き出し UI /
 * Enter 送信 / Shift+Enter 改行 / 日付セパレータ / 時刻表示 / 紙背景。下書きは
 * ローカル保持(B3 と同じ規律、localStorage)。
 *
 * create(日次 textlog の PKC2 反映)は **R5(pkc-ext `t:'propose'` → 既存
 * record:offer 同意 banner、PKC2#833 で着地)** で実現する。📤 ボタンでその日の
 * textlog を `propose` し、host が**ユーザー同意 banner で accept したら mint**
 * される(silent 作成は無い)。R6 gap の恒久解でもあり Tier S でも動く。
 * 確定モデル: 楽観更新せず `propose-result`(accept で assigned_lid)で確定。
 *
 * 接続が無い(standalone)/ ユーザーが banner を dismiss した時のために、
 * 📋 で日次ログをクリップボードへコピー → 手貼りする degrade 導線も残す。
 *
 * ExtChannel(pkc-ext)は接続状態の表示と propose 送受信に使う — projection の
 * 中身は描画しない(chat はコンテナ entry を表示しない入力面)。
 */

import '../../shared/base.css';
import './chat.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el } from '../../shared/ui';
import {
  dailyTextlogProposal,
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
/** propose の correlation_id → その日のラベル(propose-result 表示用)。 */
const pendingProposals = new Map<string, string>();

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

/**
 * R5: その日の textlog を PKC2 へ作成提案(propose)。未接続なら 📋 コピーに
 * degrade。host はユーザー同意 banner で accept したら mint する(楽観更新せず
 * propose-result で確定)。再送するとその時点の全文で別 entry になる(v1 は
 * 既存 entry への追記経路が無い — B3 と同じモデル)。
 */
function proposeDay(day: ChatDay): void {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため作成できません — 📋 でコピーして手貼りしてください(standalone)');
    return;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendPropose(dailyTextlogProposal(day), cid);
  if (ok) {
    pendingProposals.set(cid, day.label);
    setStatus(`📤 「${day.label}」を PKC2 へ作成提案 — 同意 banner で承認してください`);
  }
}

function onProposeResult(accepted: boolean, assignedLid: string | null, cid: string | null): void {
  const label = cid !== null ? pendingProposals.get(cid) : undefined;
  if (cid !== null) pendingProposals.delete(cid);
  if (accepted) {
    setStatus(`✅ 「${label ?? '日次ログ'}」を PKC2 に作成しました${assignedLid ? `(${assignedLid})` : ''}`);
  } else {
    setStatus(`「${label ?? '日次ログ'}」の作成は見送られました(banner で却下/dismiss)`);
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
  const send = button('📤 PKC2へ', 'pkc-btn-small pkc-chat-daysend', () => proposeDay(day), 'この日のログを textlog として PKC2 に作成提案');
  send.setAttribute('data-pkc-action', 'propose-day');
  sep.appendChild(send);
  sep.appendChild(
    button('📋', 'pkc-btn-small pkc-chat-daycopy', () => copyDay(day), 'この日のログをコピー(手貼り用)'),
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
  setStatus('🟢 PKC2 に接続 — 📤 で日次ログを textlog として作成できます(同意 banner で承認)');
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
    what: 'LINE のように自分宛てメモを吹き出しで書きためる日誌ツールです。記録はこのブラウザにローカル保存され、その日のログをまとめて PKC2 の textlog として作成できます。',
    how: [
      '下の入力欄に書いて Enter で追記(Shift+Enter で改行)',
      '本文に #タグ を書くとタグとして記録されます(😀 / # ボタンで素早く挿入)',
      '日付セパレータの 📤 でその日のログを PKC2 へ作成提案 → PKC2 の同意 banner で承認',
      '接続が無い時 / 見送った時は 📋 でコピーして textlog に手貼り',
      '不要な行は ✕ で削除',
    ],
    flow: [
      '記録は textlog 互換の形式({entries:[{text,createdAt,flags}…]})でローカル保持されます',
      '📤 はその日の textlog を pkc-ext の propose(R5)で PKC2 に送り、あなたが同意 banner で承認して初めて作成されます(勝手には作られません)',
      'projection は接続確認にだけ使い、コンテナの中身は表示しません(入力に専念)',
    ],
    notes: [
      '記録はこのブラウザの localStorage にあります(別ブラウザ・別端末からは見えません)',
      '同じ日を再度 📤 すると、その時点の全文で別の textlog が作られます(v1 は既存 entry への追記経路が無いため)',
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

  pendingProposals.clear();
  channel = new ExtChannel({ onProjection, onProposeResult });
  const connected = channel.start();
  setStatus(
    connected
      ? 'PKC2 を検出 — 接続確認中…(記録はローカルに保存。日次ログは 📤 で作成)'
      : 'standalone 起動 — 記録はこのブラウザにローカル保存されます',
  );

  return { channel };
}

const mountTarget = document.getElementById('chat-root');
if (mountTarget) mountChatJournal(mountTarget);
