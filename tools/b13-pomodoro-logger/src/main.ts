/**
 * B13 pomodoro-logger — focus timer that files finished sessions as
 * textlog offers (issue #35).
 *
 * Pick a duration + label, start; when the timer completes, a textlog
 * offer(「🍅 25分: ラベル」)is sent automatically(接続時のみ — v1 は
 * fire-and-forget なので未接続なら手動再送ボタンに積む)。
 */

import '../../shared/base.css';
import './pomodoro.css';
import { makeCorrelationId } from '../../shared/envelope';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { makeLogEntry, serializeTextlogEntries } from '../../shared/textlog-body';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-pomodoro-logger';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

const tracker = new OfferTracker();
let conn: HostConnection | null = null;
let displayEl: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;
let offersHost: HTMLElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let endsAt = 0;
let runningLabel = '';
let runningMinutes = 0;

/** Session log text — pure for tests. */
export function sessionText(minutes: number, label: string, startedAt: Date, endedAt: Date): string {
  const hm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `🍅 ${minutes}分集中(${hm(startedAt)}〜${hm(endedAt)})${label !== '' ? `: ${label}` : ''}`;
}

function note(text: string): void {
  if (noteEl) noteEl.textContent = text;
}

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  for (const rec of [...tracker.all()].reverse()) {
    offersHost.appendChild(el('div', 'pkc-history-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
  }
}

function tick(): void {
  if (!displayEl) return;
  const left = Math.max(0, endsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  displayEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (left <= 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
    finishSession();
  }
}

function finishSession(): void {
  const ended = new Date();
  const started = new Date(ended.getTime() - runningMinutes * 60000);
  const text = sessionText(runningMinutes, runningLabel, started, ended);
  document.title = `✅ 完了 — ${TOOL_NAME}`;
  const correlationId = makeCorrelationId();
  const sent = conn?.send(
    'record:offer',
    {
      title: text,
      body: serializeTextlogEntries([makeLogEntry(text, ended)]),
      archetype: 'textlog',
    },
    { correlationId },
  );
  if (sent) {
    tracker.begin(correlationId, text);
    renderOffers();
    note('セッションを offer しました — host 側 banner で accept を');
  } else {
    note(`完了: ${text} — ホスト未接続のため送信されていません(接続して再スタートするか手動で記録してください)`);
  }
}

export function mountPomodoro(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-pomo-root';

  const header = el('div', 'pkc-pomo-header');
  header.setAttribute('data-pkc-region', 'pomo-header');
  header.appendChild(el('span', 'pkc-pomo-title', '🍅 PKC2 Pomodoro Logger'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — タイマー完了で textlog を自動 offer`));
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

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'pomo-controls');
  const minutes = selectInput([
    { value: '25', label: '25 分(集中)' },
    { value: '50', label: '50 分(ディープ)' },
    { value: '15', label: '15 分' },
    { value: '5', label: '5 分(休憩)' },
    { value: '1', label: '1 分(動作確認)' },
  ]);
  minutes.setAttribute('data-pkc-field', 'pomo-minutes');
  const label = textInput('ラベル(任意 — 例: spec 読み)');
  label.setAttribute('data-pkc-field', 'pomo-label');
  const row = el('div', 'pkc-btn-row');
  row.appendChild(minutes);
  row.appendChild(label);
  row.appendChild(
    button('▶ スタート', 'pkc-btn', () => {
      if (timer !== null) return;
      runningMinutes = Number(minutes.value);
      runningLabel = label.value.trim();
      endsAt = Date.now() + runningMinutes * 60000;
      document.title = `🍅 ${runningMinutes}分 — ${TOOL_NAME}`;
      timer = setInterval(tick, 250);
      tick();
      note('計測中…(このタブを閉じるとタイマーも止まります)');
    }),
  );
  row.appendChild(
    button('⏹ 中断', 'pkc-btn-small', () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (displayEl) displayEl.textContent = '--:--';
      document.title = TOOL_NAME;
      note('中断しました(記録は送信されません)');
    }),
  );
  panel.appendChild(row);
  displayEl = el('div', 'pkc-pomo-display', '--:--');
  displayEl.setAttribute('data-pkc-region', 'pomo-display');
  panel.appendChild(displayEl);
  noteEl = el('div', 'pkc-hint');
  panel.appendChild(noteEl);
  root.appendChild(panel);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'pomo-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', '記録したセッション'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  renderOffers();
  return { conn };
}

const mountTarget = document.getElementById('pomodoro-root');
if (mountTarget) mountPomodoro(mountTarget);
