/**
 * B2 todo-quick-sender — keyboard-first todo capture (issue #24).
 *
 * One big description field + optional due date; Enter sends a
 * `record:offer` (archetype: todo, body in PKC2's todo JSON shape) and
 * returns focus for the next item. The entry title is the description
 * itself — the fastest possible "やることを放り込む" path.
 *
 * v1 spec notes surfaced in the UI:
 *  - fire-and-forget (§8.3): each send is independent, no queue/ack;
 *  - priority/tags are not in the v1 offer payload (SR-08);
 *  - acceptance happens in the host's PendingOffer banner.
 */

import '../../shared/base.css';
import './sender.css';
import { helpButton } from '../../shared/help';
import { makeCorrelationId } from '../../shared/envelope';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el } from '../../shared/ui';
import { serializeTodoBody } from '../../shared/todo-body';

const TOOL_NAME = 'pkc2-todo-quick';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

interface HistoryEntry {
  at: string;
  kind: 'sent' | 'reject' | 'note';
  text: string;
}

const history: HistoryEntry[] = [];
const HISTORY_CAP = 100;
let historyHost: HTMLElement | null = null;
/** Offer round-trip status (correlation_id ベース、PKC2#804)。 */
const tracker = new OfferTracker();
let offersHost: HTMLElement | null = null;

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  const records = tracker.all();
  if (records.length === 0) {
    offersHost.appendChild(el('div', 'pkc-hint', 'まだ送信していません — Enter で送信できます'));
    return;
  }
  for (const rec of [...records].reverse()) {
    const row = el('div', `pkc-history-row pkc-offer-${rec.status}`);
    const t = new Date(rec.sentAt);
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    row.appendChild(el('span', 'pkc-history-time', hh));
    row.appendChild(el('span', 'pkc-history-text', `"${rec.title}" — ${offerStatusLabel(rec)}`));
    offersHost.appendChild(row);
  }
}

function pushHistory(kind: HistoryEntry['kind'], text: string): void {
  history.push({ at: new Date().toISOString(), kind, text });
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  renderHistory();
}

function renderHistory(): void {
  if (!historyHost) return;
  historyHost.replaceChildren();
  if (history.length === 0) {
    historyHost.appendChild(el('div', 'pkc-hint', 'まだ送信していません — Enter で送信できます'));
    return;
  }
  for (const h of [...history].reverse()) {
    const row = el('div', `pkc-history-row pkc-history-${h.kind}`);
    const t = new Date(h.at);
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    row.appendChild(el('span', 'pkc-history-time', hh));
    row.appendChild(el('span', 'pkc-history-text', h.text));
    historyHost.appendChild(row);
  }
}

export function mountTodoSender(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-todo-root';

  const header = el('div', 'pkc-todo-header');
  header.setAttribute('data-pkc-region', 'todo-header');
  header.appendChild(el('span', 'pkc-todo-title', '✅ PKC2 Todo Quick Sender'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — Enter で即送信、accept はホスト側で`));
  header.appendChild(helpButton('Todo Quick Sender', {
    what: "やることを Enter 一発で todo として PKC2 に放り込む最速入力です。",
    how: [
      "PKC2 に接続する",
      "やることを入力して Enter(期日は任意。送信後も保持され連投できます)",
      "「オファー状況」で到達 / 受理 / 却下を追跡",
      "PKC2 側の banner で accept すると todo entry になります",
    ],
    flow: [
      "title = 入力した本文、body は PKC2 の todo JSON({status:'open', description, date?, archived:false})で送信されます",
    ],
    notes: [
      "優先度 / タグは v1 payload に存在しません(SR-08)",
    ],
  }));
  root.appendChild(header);

  const conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (text) => pushHistory('note', text),
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      if (type === 'record:ack') {
        if (tracker.resolveAck(payload)) renderOffers();
        return;
      }
      if (type === 'record:accept') {
        if (tracker.resolveAccept(payload)) renderOffers();
        return;
      }
      if (type === 'record:reject') {
        if (tracker.resolveReject(payload)) {
          renderOffers();
          return;
        }
        const p = payload as { reason?: unknown } | null;
        const reason = p && typeof p.reason === 'string' ? p.reason : '?';
        pushHistory('reject', `record:reject 受信(reason=${reason})— 旧 host は correlation echo が無く特定不能(PKC2#804 対応 host で解消)`);
      }
    },
  });
  root.appendChild(conn.root);

  const form = el('div', 'pkc-panel pkc-todo-form');
  form.setAttribute('data-pkc-region', 'todo-form');

  const description = document.createElement('input');
  description.type = 'text';
  description.className = 'pkc-todo-input';
  description.placeholder = 'やることを入力して Enter';
  description.setAttribute('data-pkc-field', 'todo-description');

  const date = document.createElement('input');
  date.type = 'date';
  date.className = 'pkc-todo-date';
  date.title = '期日(任意)。送信後も保持されます';
  date.setAttribute('data-pkc-field', 'todo-date');

  const err = el('div', 'pkc-form-error');
  err.setAttribute('data-pkc-region', 'todo-error');

  function send(): void {
    err.textContent = '';
    const desc = description.value.trim();
    if (desc === '') {
      err.textContent = 'やることを入力してください';
      description.focus();
      return;
    }
    const payload: Record<string, unknown> = {
      title: desc,
      body: serializeTodoBody(desc, date.value),
      archetype: 'todo',
    };
    const correlationId = makeCorrelationId();
    const sent = conn.send('record:offer', payload, { correlationId });
    if (sent) {
      tracker.begin(correlationId, desc + (date.value ? `(期日 ${date.value})` : ''));
      renderOffers();
      description.value = '';
      description.focus();
    }
  }

  description.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      send();
    }
  });

  const row = el('div', 'pkc-todo-row');
  row.appendChild(description);
  row.appendChild(date);
  row.appendChild(button('Add', 'pkc-btn', send));
  form.appendChild(row);
  form.appendChild(err);
  form.appendChild(
    el('div', 'pkc-hint', 'entry title = やること本文。優先度/タグは v1 payload に存在しません(SR-08)。応答なし=受理待ち or 未達(§8.3)'),
  );
  root.appendChild(form);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'todo-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  const hist = el('div', 'pkc-panel');
  hist.setAttribute('data-pkc-region', 'todo-history');
  hist.appendChild(el('div', 'pkc-panel-heading', 'メモ(このセッションのみ)'));
  historyHost = el('div', 'pkc-history-list');
  hist.appendChild(historyHost);
  root.appendChild(hist);

  renderOffers();
  renderHistory();
  description.focus();
  return { conn };
}

const mountTarget = document.getElementById('todo-root');
if (mountTarget) mountTodoSender(mountTarget);
