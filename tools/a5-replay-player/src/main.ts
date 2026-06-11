/**
 * A5 replay-player — re-send a captured traffic sequence (issue #22).
 *
 * Loads an A4 capture file (or A1 message-probe "Copy All" JSON), shows the
 * replayable events, and re-sends them to the connected host in order with
 * a configurable interval. Built for the batch-testing loop: record a
 * scenario once, replay it against any PKC2 build.
 *
 * Safety:
 *  - by default only **outbound PKC envelopes**(direction 'out')are
 *    replayed — inbound host responses make no sense to send back, and
 *    foreign messages are excluded unless explicitly enabled;
 *  - replay only targets the host the user connected (identity-bound link);
 *  - the file parser is strict (shape checks, event cap) and never throws;
 *  - replayed data is rendered via textContent only.
 */

import '../../shared/base.css';
import './player.css';
import { helpButton } from '../../shared/help';
import { parseCaptureText, type CapturedEvent } from '../../shared/capture-format';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { sendToHost } from '../../shared/host-link';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-replay-player';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

interface PlayerState {
  events: CapturedEvent[];
  sourceLabel: string;
  includeInbound: boolean;
  includeForeign: boolean;
  intervalMs: number;
  playing: boolean;
  cursor: number;
  sentCount: number;
}

const state: PlayerState = {
  events: [],
  sourceLabel: '',
  includeInbound: false,
  includeForeign: false,
  intervalMs: 500,
  playing: false,
  cursor: 0,
  sentCount: 0,
};

let conn: HostConnection | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let playTimer: ReturnType<typeof setTimeout> | null = null;

/** The subset that would be re-sent under current toggles. Pure. */
export function selectReplayable(
  events: readonly CapturedEvent[],
  opts: { includeInbound: boolean; includeForeign: boolean },
): CapturedEvent[] {
  return events.filter((e) => {
    if (e.kind === 'foreign' && !opts.includeForeign) return false;
    if (e.direction === 'in' && !opts.includeInbound) return false;
    return true;
  });
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderList(): void {
  if (!listEl) return;
  const host = listEl; // narrow once — closures below keep the non-null ref
  host.replaceChildren();
  if (state.events.length === 0) {
    host.appendChild(el('div', 'pkc-hint', 'capture JSON(A4 保存ファイル or A1 の Copy All)を読み込んでください'));
    return;
  }
  const replayable = selectReplayable(state.events, state);
  const summary = el('div', 'pkc-player-summary');
  summary.setAttribute('data-pkc-region', 'player-summary');
  summary.textContent =
    `${state.sourceLabel}: 全 ${state.events.length} 件 / 再送対象 ${replayable.length} 件`
    + (state.playing ? `(再生中 ${state.cursor}/${replayable.length})` : '');
  host.appendChild(summary);
  const max = 200;
  replayable.slice(0, max).forEach((e, i) => {
    const row = el('div', 'pkc-player-row');
    if (state.playing && i < state.cursor) row.classList.add('pkc-player-done');
    row.appendChild(el('span', 'pkc-player-idx', String(i + 1).padStart(3, ' ')));
    row.appendChild(el('span', 'pkc-player-dir', e.direction === 'out' ? '→' : '←'));
    row.appendChild(el('span', 'pkc-player-type', e.type));
    row.appendChild(el('span', 'pkc-player-at', e.at));
    host.appendChild(row);
  });
  if (replayable.length > max) {
    host.appendChild(el('div', 'pkc-hint', `… 他 ${replayable.length - max} 件(表示上限、再送はされます)`));
  }
}

function stopReplay(reason: string): void {
  state.playing = false;
  if (playTimer !== null) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  setStatus(reason);
  renderList();
}

function startReplay(): void {
  if (state.playing) return;
  const link = conn?.getLink() ?? null;
  if (!link) {
    setStatus('ホスト未接続です(上の接続パネルから PKC2 に接続してください)');
    return;
  }
  const queue = selectReplayable(state.events, state);
  if (queue.length === 0) {
    setStatus('再送対象がありません(toggle を確認してください)');
    return;
  }
  state.playing = true;
  state.cursor = 0;
  state.sentCount = 0;
  setStatus(`再生開始: ${queue.length} 件 / 間隔 ${state.intervalMs}ms`);

  const step = (): void => {
    if (!state.playing) return;
    const cur = conn?.getLink() ?? null;
    if (!cur) {
      stopReplay('ホストとの接続が切れたため停止しました');
      return;
    }
    const e = queue[state.cursor];
    if (!e) {
      stopReplay(`再生完了: ${state.sentCount} 件送信`);
      return;
    }
    if (sendToHost(cur, e.data)) state.sentCount += 1;
    state.cursor += 1;
    renderList();
    playTimer = setTimeout(step, state.intervalMs);
  };
  step();
}

export function mountPlayer(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-player-root';

  const header = el('div', 'pkc-player-header');
  header.setAttribute('data-pkc-region', 'player-header');
  header.appendChild(el('span', 'pkc-player-title', '▶ PKC2 Replay Player'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 記録済みシナリオを接続中の host へ順次再送(既定は送信方向の PKC envelope のみ)`),
  );
  header.appendChild(helpButton('Replay Player', {
    what: "A4 の記録(または A1 の Copy All)を読み込み、接続中の PKC2 へ順番に再送する回帰テスト用プレイヤーです。",
    how: [
      "PKC2 に接続する",
      "capture JSON を読み込む(ファイル選択 or 貼り付け)",
      "送信間隔(ms)を確認 — host の flood guard(120 msg/分)を超えない値に",
      "▶ 再生。進捗は一覧のグレーアウトで分かります。⏹ でいつでも停止",
    ],
    flow: [
      "既定では「送信方向の PKC envelope」だけを、identity 束縛済みの接続先にのみ再送します",
      "受信方向(pong 等)や非 PKC メッセージの再送はトグルで明示的に有効化(host 側 validation のテスト用)",
    ],
    notes: [
      "record:offer を含むシナリオは host に PendingOffer banner が積まれます(accept は人)",
      "接続が切れると自動停止します",
    ],
  }));
  root.appendChild(header);

  conn = createHostConnection({ sourceId: TOOL_ID, onNote: (t) => setStatus(t) });
  root.appendChild(conn.root);

  // ---- load
  const loadPanel = el('div', 'pkc-panel');
  loadPanel.setAttribute('data-pkc-region', 'player-load');
  loadPanel.appendChild(el('div', 'pkc-panel-heading', 'キャプチャ読み込み'));
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.setAttribute('data-pkc-field', 'player-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => loadCaptureText(text, f.name));
  });
  loadPanel.appendChild(file);
  const paste = document.createElement('textarea');
  paste.rows = 3;
  paste.placeholder = 'または JSON をここに貼り付け(A1 の Copy All も可)';
  paste.setAttribute('data-pkc-field', 'player-paste');
  paste.addEventListener('change', () => {
    if (paste.value.trim() !== '') loadCaptureText(paste.value, '(paste)');
  });
  loadPanel.appendChild(paste);
  root.appendChild(loadPanel);

  // ---- controls
  const ctrl = el('div', 'pkc-panel');
  ctrl.setAttribute('data-pkc-region', 'player-controls');
  ctrl.appendChild(el('div', 'pkc-panel-heading', '再生'));
  const row = el('div', 'pkc-btn-row');
  row.appendChild(button('▶ 再生', 'pkc-btn', startReplay));
  row.appendChild(button('⏹ 停止', 'pkc-btn-small', () => stopReplay(`停止(${state.sentCount} 件送信済み)`)));
  const interval = document.createElement('input');
  interval.type = 'number';
  interval.min = '50';
  interval.max = '10000';
  interval.value = String(state.intervalMs);
  interval.className = 'pkc-player-interval';
  interval.title = '送信間隔(ms)。host の rate limit(120 msg/分)に注意';
  interval.setAttribute('data-pkc-field', 'player-interval');
  interval.addEventListener('change', () => {
    const n = Number(interval.value);
    if (Number.isFinite(n) && n >= 50 && n <= 10000) state.intervalMs = Math.round(n);
    else interval.value = String(state.intervalMs);
  });
  row.appendChild(interval);
  row.appendChild(el('span', 'pkc-hint', 'ms 間隔'));
  ctrl.appendChild(row);

  const inLabel = el('label', 'pkc-inline-check');
  const inToggle = document.createElement('input');
  inToggle.type = 'checkbox';
  inToggle.setAttribute('data-pkc-field', 'player-include-in');
  inToggle.addEventListener('change', () => {
    state.includeInbound = inToggle.checked;
    renderList();
  });
  inLabel.appendChild(inToggle);
  inLabel.appendChild(document.createTextNode(' 受信方向(host→sender 型)も再送する — host 側 validation / capability gate のテスト用'));
  ctrl.appendChild(inLabel);

  const fLabel = el('label', 'pkc-inline-check');
  const fToggle = document.createElement('input');
  fToggle.type = 'checkbox';
  fToggle.setAttribute('data-pkc-field', 'player-include-foreign');
  fToggle.addEventListener('change', () => {
    state.includeForeign = fToggle.checked;
    renderList();
  });
  fLabel.appendChild(fToggle);
  fLabel.appendChild(document.createTextNode(' 非 PKC メッセージも再送する'));
  ctrl.appendChild(fLabel);

  ctrl.appendChild(
    el('div', 'pkc-hint', 'record:offer を含むシナリオは host 側に PendingOffer banner が積まれます(accept は user 操作)。host の flood guard(120 msg/分)を超えない間隔で'),
  );
  statusEl = el('div', 'pkc-player-status');
  statusEl.setAttribute('data-pkc-region', 'player-status');
  ctrl.appendChild(statusEl);
  root.appendChild(ctrl);

  // ---- list
  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'player-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', '再送対象'));
  listEl = el('div', 'pkc-player-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);

  renderList();
  return { conn };
}

function loadCaptureText(text: string, name: string): void {
  const r = parseCaptureText(text);
  if (!r.ok) {
    setStatus(`読み込み失敗(${name}): ${r.error}`);
    return;
  }
  stopReplay('');
  state.events = r.events;
  state.sourceLabel = `${name} ${r.sourceLabel}`;
  setStatus(`読み込み完了: ${r.events.length} 件`);
  renderList();
}

const mountTarget = document.getElementById('player-root');
if (mountTarget) mountPlayer(mountTarget);
