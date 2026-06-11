/**
 * B3 textlog-journaler — accumulate timestamped notes locally, offer them
 * as ONE textlog entry (issue #25).
 *
 * v1 has no append-to-existing-entry path (offers always mint a new
 * entry), so the journaler keeps the running log locally (localStorage)
 * and sends the whole day as a single textlog when you decide to file it.
 */

import '../../shared/base.css';
import './journal.css';
import { makeCorrelationId } from '../../shared/envelope';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { dailyTitle, makeLogEntry, serializeTextlogEntries, type TextlogEntryDraft } from '../../shared/textlog-body';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-textlog-journaler';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const DRAFT_KEY = 'pkc2-b3-journaler:draft';

const tracker = new OfferTracker();
let entries: TextlogEntryDraft[] = [];
let conn: HostConnection | null = null;
let listEl: HTMLElement | null = null;
let offersHost: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;

function note(text: string): void {
  if (noteEl) noteEl.textContent = text;
}

function persist(): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(entries));
  } catch { /* best-effort */ }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    entries = parsed.filter(
      (e): e is TextlogEntryDraft =>
        e !== null && typeof e === 'object'
        && typeof (e as TextlogEntryDraft).text === 'string'
        && typeof (e as TextlogEntryDraft).createdAt === 'string',
    );
  } catch { /* best-effort */ }
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (entries.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', 'まだ記録がありません — 入力して Enter で追記'));
    return;
  }
  for (const e of entries) {
    const row = el('div', 'pkc-journal-row');
    const t = new Date(e.createdAt);
    row.appendChild(el('span', 'pkc-history-time', `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`));
    row.appendChild(el('span', 'pkc-journal-text', e.text));
    const del = button('✕', 'pkc-btn-small', () => {
      entries = entries.filter((x) => x.id !== e.id);
      persist();
      renderList();
    }, 'この行を削除');
    row.appendChild(del);
    listEl.appendChild(row);
  }
}

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  for (const rec of [...tracker.all()].reverse()) {
    offersHost.appendChild(el('div', 'pkc-history-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
  }
}

export function mountJournaler(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-journal-root';

  const header = el('div', 'pkc-journal-header');
  header.setAttribute('data-pkc-region', 'journal-header');
  header.appendChild(el('span', 'pkc-journal-title', '📓 PKC2 Textlog Journaler'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — ローカルに連続追記し、まとめて 1 つの textlog として offer(v1 は既存 entry への追記不可)`),
  );
  root.appendChild(header);

  conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: note,
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      if (type === 'record:ack' && tracker.resolveAck(payload)) renderOffers();
      else if (type === 'record:accept' && tracker.resolveAccept(payload)) renderOffers();
      else if (type === 'record:reject' && tracker.resolveReject(payload)) renderOffers();
    },
  });
  root.appendChild(conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'journal-form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pkc-journal-input';
  input.placeholder = 'いまの記録を入力して Enter(タイムスタンプ付きで追記)';
  input.setAttribute('data-pkc-field', 'journal-input');
  const append = (): void => {
    const text = input.value.trim();
    if (text === '') return;
    entries.push(makeLogEntry(text));
    persist();
    renderList();
    input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      append();
    }
  });
  const row = el('div', 'pkc-btn-row');
  row.appendChild(input);
  row.appendChild(button('追記', 'pkc-btn', append));
  form.appendChild(row);
  root.appendChild(form);

  const logPanel = el('div', 'pkc-panel');
  logPanel.setAttribute('data-pkc-region', 'journal-list');
  logPanel.appendChild(el('div', 'pkc-panel-heading', '今日のログ(localStorage に自動保存)'));
  listEl = el('div', 'pkc-journal-list');
  logPanel.appendChild(listEl);
  root.appendChild(logPanel);

  const sendPanel = el('div', 'pkc-panel');
  sendPanel.setAttribute('data-pkc-region', 'journal-send');
  const title = textInput('entry title(空なら今日の日付)');
  const sendRow = el('div', 'pkc-btn-row');
  sendRow.appendChild(title);
  sendRow.appendChild(
    button('textlog として offer', 'pkc-btn', () => {
      if (entries.length === 0) {
        note('記録が空です');
        return;
      }
      const t = title.value.trim() !== '' ? title.value.trim() : `Journal ${dailyTitle()}`;
      const correlationId = makeCorrelationId();
      const sent = conn?.send(
        'record:offer',
        { title: t, body: serializeTextlogEntries(entries), archetype: 'textlog' },
        { correlationId },
      );
      if (sent) {
        tracker.begin(correlationId, `${t}(${entries.length} 行)`);
        renderOffers();
        note('送信しました — accept 後に「ログをクリア」で次の日へ');
      }
    }),
  );
  sendRow.appendChild(
    button('ログをクリア', 'pkc-btn-small', () => {
      entries = [];
      persist();
      renderList();
    }),
  );
  sendPanel.appendChild(sendRow);
  offersHost = el('div', 'pkc-history-list');
  offersHost.setAttribute('data-pkc-region', 'journal-offers');
  sendPanel.appendChild(offersHost);
  noteEl = el('div', 'pkc-hint');
  sendPanel.appendChild(noteEl);
  root.appendChild(sendPanel);

  restore();
  renderList();
  renderOffers();
  input.focus();
  return { conn };
}

const mountTarget = document.getElementById('journal-root');
if (mountTarget) mountJournaler(mountTarget);
