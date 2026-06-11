/**
 * B14 daily-log-starter — one-click "today's textlog" offer (issue #36).
 *
 * Generates a dated textlog entry from a template (each non-empty line
 * becomes one log row) and offers it. The fastest way to open the day.
 */

import '../../shared/base.css';
import './daily.css';
import { makeCorrelationId } from '../../shared/envelope';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { dailyTitle, makeLogEntry, serializeTextlogEntries } from '../../shared/textlog-body';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-daily-log-starter';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

export const TEMPLATES: ReadonlyArray<{ label: string; lines: string[] }> = [
  { label: '空(日付のみ)', lines: [] },
  { label: '日報', lines: ['【今日やること】', '【やったこと】', '【メモ】'] },
  { label: '朝会', lines: ['昨日:', '今日:', 'ブロッカー:'] },
];

/** Build the textlog body from template + free lines. Pure. */
export function buildDailyBody(lines: readonly string[], at: Date = new Date()): string {
  const drafts = lines
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l, i) => makeLogEntry(l, new Date(at.getTime() + i))); // 順序維持のため 1ms ずつずらす
  return serializeTextlogEntries(drafts);
}

const tracker = new OfferTracker();
let conn: HostConnection | null = null;
let offersHost: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;

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

export function mountDaily(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-daily-root';

  const header = el('div', 'pkc-daily-header');
  header.setAttribute('data-pkc-region', 'daily-header');
  header.appendChild(el('span', 'pkc-daily-title', '🌅 PKC2 Daily Log Starter'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 今日の textlog をワンクリックで offer`));
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
  panel.setAttribute('data-pkc-region', 'daily-form');
  const title = textInput(`title(空なら ${dailyTitle()})`);
  title.setAttribute('data-pkc-field', 'daily-title');
  const tpl = selectInput(TEMPLATES.map((t, i) => ({ value: String(i), label: `テンプレ: ${t.label}` })));
  tpl.setAttribute('data-pkc-field', 'daily-template');
  const body = document.createElement('textarea');
  body.rows = 6;
  body.placeholder = '1 行 = 1 ログ行(空行は無視)';
  body.setAttribute('data-pkc-field', 'daily-body');
  tpl.addEventListener('change', () => {
    const t = TEMPLATES[Number(tpl.value)];
    body.value = t ? t.lines.join('\n') : '';
  });

  panel.appendChild(tpl);
  panel.appendChild(title);
  panel.appendChild(body);
  panel.appendChild(
    button('今日の textlog を offer', 'pkc-btn', () => {
      const t = title.value.trim() !== '' ? title.value.trim() : dailyTitle();
      const correlationId = makeCorrelationId();
      const sent = conn?.send(
        'record:offer',
        { title: t, body: buildDailyBody(body.value.split('\n')), archetype: 'textlog' },
        { correlationId },
      );
      if (sent) {
        tracker.begin(correlationId, t);
        renderOffers();
        note('送信しました — host 側 banner で accept を');
      }
    }),
  );
  noteEl = el('div', 'pkc-hint');
  panel.appendChild(noteEl);
  root.appendChild(panel);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'daily-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  renderOffers();
  return { conn };
}

const mountTarget = document.getElementById('daily-root');
if (mountTarget) mountDaily(mountTarget);
