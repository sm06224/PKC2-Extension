/**
 * A4 traffic-recorder — capture window traffic to a JSON file (issue #21).
 *
 * Records every message that reaches this window (and the recorder's own
 * pings) while ⏺ is on, then saves a `pkc2-traffic-capture` JSON for the
 * A5 replay-player. Pure observer: received messages are never acted on.
 * Designed for the batch-testing loop: connect → record a scenario →
 * save → replay later with A5.
 */

import '../../shared/base.css';
import './recorder.css';
import { helpButton } from '../../shared/help';
import { buildCaptureFile, CAPTURE_EVENT_CAP, type CapturedEvent } from '../../shared/capture-format';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-traffic-recorder';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

interface RecState {
  recording: boolean;
  includeForeign: boolean;
  events: CapturedEvent[];
  dropped: number;
}

const state: RecState = { recording: false, includeForeign: false, events: [], dropped: 0 };

let conn: HostConnection | null = null;
let countEl: HTMLElement | null = null;
let recBtn: HTMLButtonElement | null = null;
let noteEl: HTMLElement | null = null;

function typeOf(data: unknown): { kind: 'pkc' | 'foreign'; type: string } {
  if (data !== null && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (d['protocol'] === 'pkc-message') {
      return { kind: 'pkc', type: typeof d['type'] === 'string' ? d['type'] : '(?)' };
    }
  }
  return { kind: 'foreign', type: '(non-pkc)' };
}

function record(ev: Omit<CapturedEvent, 'at'>): void {
  if (!state.recording) return;
  if (ev.kind === 'foreign' && !state.includeForeign) return;
  if (state.events.length >= CAPTURE_EVENT_CAP) {
    state.dropped += 1;
    renderCount();
    return;
  }
  state.events.push({ ...ev, at: new Date().toISOString() });
  renderCount();
}

function renderCount(): void {
  if (!countEl) return;
  countEl.textContent =
    `${state.events.length.toLocaleString()} / ${CAPTURE_EVENT_CAP.toLocaleString()} 件`
    + (state.dropped > 0 ? `(上限到達後 ${state.dropped} 件破棄)` : '');
}

function note(text: string): void {
  if (noteEl) noteEl.textContent = text;
}

function downloadCapture(): void {
  if (state.events.length === 0) {
    note('イベントがありません(⏺ 記録を開始してトラフィックを発生させてください)');
    return;
  }
  const file = buildCaptureFile(TOOL_ID, state.events);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pkc2-traffic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  note(`保存しました(${state.events.length} 件)— A5 replay-player で再生できます`);
}

export function mountRecorder(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-rec-root';

  const header = el('div', 'pkc-rec-header');
  header.setAttribute('data-pkc-region', 'rec-header');
  header.appendChild(el('span', 'pkc-rec-title', '⏺ PKC2 Traffic Recorder'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — この window に届く全メッセージ + 自分の送信を記録し JSON 保存(受信内容で動作は変えません)`),
  );
  header.appendChild(helpButton('Traffic Recorder', {
    what: "この window に届く全メッセージ(+自分の ping)を記録して JSON 保存するレコーダーです。A5 replay-player の入力を作ります。",
    how: [
      "PKC2 に接続する",
      "⏺ 記録開始",
      "PKC2 側を操作してトラフィックを発生させる(または「Ping を送って記録」で往復を含める)",
      "⏹ 停止 → 💾 JSON 保存(pkc2-traffic-capture 形式)",
    ],
    flow: [
      "window の message イベントを受動的に記録するだけで、内容で動作は変わりません",
      "保存した JSON は A5 で任意のビルドに対して再生できます(回帰テストの軸)",
    ],
    notes: [
      "上限 5,000 件(超過分は破棄数を表示)",
      "非 PKC メッセージはトグルで含める",
      "他ツール同士の通信は記録できません(この window に届くものだけ)",
    ],
  }));
  root.appendChild(header);

  conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (text) => note(text),
  });
  root.appendChild(conn.root);

  // Raw window listener — captures everything incl. pong / record:reject /
  // graph channel, independent of host-connect's validation.
  window.addEventListener('message', (ev: MessageEvent) => {
    const t = typeOf(ev.data);
    record({ direction: 'in', origin: ev.origin, viaHost: false, kind: t.kind, type: t.type, data: ev.data });
  });

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'rec-controls');
  panel.appendChild(el('div', 'pkc-panel-heading', '記録'));

  const row = el('div', 'pkc-btn-row');
  recBtn = button('⏺ 記録開始', 'pkc-btn', () => {
    state.recording = !state.recording;
    if (recBtn) {
      recBtn.textContent = state.recording ? '⏹ 停止' : '⏺ 記録開始';
      recBtn.classList.toggle('pkc-rec-active', state.recording);
    }
    note(state.recording ? '記録中 — PKC2 側を操作してトラフィックを発生させてください' : '停止しました');
  });
  row.appendChild(recBtn);

  row.appendChild(
    button('📡 Ping を送って記録', 'pkc-btn-small', () => {
      const env = conn?.send('ping', {});
      if (env) record({ direction: 'out', origin: '-', viaHost: true, kind: 'pkc', type: 'ping', data: env });
    }, '往復(ping→pong)をキャプチャに含める'),
  );
  row.appendChild(button('💾 JSON 保存', 'pkc-btn', downloadCapture));
  row.appendChild(
    button('クリア', 'pkc-btn-small', () => {
      state.events = [];
      state.dropped = 0;
      renderCount();
      note('クリアしました');
    }),
  );
  panel.appendChild(row);

  const foreignLabel = el('label', 'pkc-inline-check');
  const foreignToggle = document.createElement('input');
  foreignToggle.type = 'checkbox';
  foreignToggle.setAttribute('data-pkc-field', 'rec-foreign');
  foreignToggle.addEventListener('change', () => {
    state.includeForeign = foreignToggle.checked;
  });
  foreignLabel.appendChild(foreignToggle);
  foreignLabel.appendChild(document.createTextNode(' 非 PKC メッセージも記録'));
  panel.appendChild(foreignLabel);

  countEl = el('div', 'pkc-rec-count');
  countEl.setAttribute('data-pkc-region', 'rec-count');
  panel.appendChild(countEl);
  noteEl = el('div', 'pkc-hint');
  noteEl.setAttribute('data-pkc-region', 'rec-note');
  panel.appendChild(noteEl);
  root.appendChild(panel);

  renderCount();
  return { conn };
}

const mountTarget = document.getElementById('recorder-root');
if (mountTarget) mountRecorder(mountTarget);
