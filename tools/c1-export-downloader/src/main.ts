/**
 * C1 export-downloader — request the host's export and save it (issue #38).
 *
 * Sends `export:request` and downloads the returned `export:result` HTML as
 * a file. `export:request` is **embedded-only** (spec §7.5.3): the host must
 * be a PKC2 this tool embeds in its own iframe — the shared connection block
 * provides exactly that. On a non-embedded host (launcher opener) the
 * request is capability-rejected silently; the timeout surfaces it.
 *
 * The result HTML is **never rendered or parsed** here — it goes straight
 * into a Blob download (the whole container is in there; rendering it would
 * widen the attack/leak surface for zero benefit).
 */

import '../../shared/base.css';
import './downloader.css';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { button, el, fieldRow, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-export-downloader';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const RESULT_TIMEOUT_MS = 30000;

interface HistoryEntry {
  at: string;
  kind: 'sent' | 'result' | 'note';
  text: string;
}

const history: HistoryEntry[] = [];
const HISTORY_CAP = 50;
let historyHost: HTMLElement | null = null;
let resultHost: HTMLElement | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastResult: { filename: string; html: string } | null = null;

function pushHistory(kind: HistoryEntry['kind'], text: string): void {
  history.push({ at: new Date().toISOString(), kind, text });
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  renderHistory();
}

function renderHistory(): void {
  if (!historyHost) return;
  historyHost.replaceChildren();
  if (history.length === 0) {
    historyHost.appendChild(el('div', 'pkc-hint', 'まだ要求していません'));
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

/** Sanitize a host-provided filename for the download attribute. */
export function safeFilename(name: unknown, fallback: string): string {
  if (typeof name !== 'string' || name.trim() === '') return fallback;
  // Strip path separators / control chars; keep it a plain leaf name.
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (cleaned === '' || /^\.+$/.test(cleaned)) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}.html` : cleaned;
}

function renderResult(): void {
  if (!resultHost) return;
  resultHost.replaceChildren();
  if (!lastResult) {
    resultHost.appendChild(el('div', 'pkc-hint', 'export:result 未受信'));
    return;
  }
  const r = lastResult;
  const sizeKb = (new Blob([r.html]).size / 1024).toFixed(1);
  resultHost.appendChild(el('div', undefined, `受信: ${r.filename}(${sizeKb} KB)`));
  resultHost.appendChild(
    button('Download HTML', 'pkc-btn', () => {
      const blob = new Blob([r.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the click a tick before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      pushHistory('note', `ダウンロード開始: ${r.filename}`);
    }),
  );
}

export function mountDownloader(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-dl-root';

  const header = el('div', 'pkc-dl-header');
  header.setAttribute('data-pkc-region', 'dl-header');
  header.appendChild(el('span', 'pkc-dl-title', '📦 PKC2 Export Downloader'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — export:request は embedded-only(下の iframe 読み込みで接続)`),
  );
  root.appendChild(header);

  const conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (text) => pushHistory('note', text),
    onStatus: (status, profile) => {
      if (status === 'connected' && profile && !profile.capabilities.includes('export:request')) {
        pushHistory('note', 'このホストは export:request を advertise していません(pong.capabilities を確認)');
      }
    },
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      if (inbound.envelope.type === 'export:result') {
        const p = inbound.envelope.payload as { filename?: unknown; html?: unknown } | null;
        if (!p || typeof p.html !== 'string') {
          pushHistory('note', 'export:result を受信しましたが payload.html が不正です');
          return;
        }
        if (pendingTimer !== null) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        const fallback = `pkc2-export-${new Date().toISOString().slice(0, 10)}.html`;
        lastResult = { filename: safeFilename(p.filename, fallback), html: p.html };
        pushHistory('result', `export:result 受信(${(new Blob([p.html]).size / 1024).toFixed(1)} KB)`);
        renderResult();
      }
    },
  });
  root.appendChild(conn.root);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'dl-form');
  panel.appendChild(el('div', 'pkc-panel-heading', 'export:request'));
  const filename = textInput('filename(任意 — host 既定名あり)');
  panel.appendChild(fieldRow('filename', filename));
  panel.appendChild(
    button('Request Export', 'pkc-btn', () => {
      const payload: Record<string, unknown> = {};
      if (filename.value.trim() !== '') payload['filename'] = filename.value.trim();
      const sent = conn.send('export:request', payload);
      if (!sent) return;
      pushHistory('sent', 'export:request 送信 — 30 秒待機');
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        pushHistory(
          'note',
          '30 秒以内に export:result が届きませんでした。ホストが embedded でない(capability gate, spec §7.5.3)か、container が大きく処理中の可能性があります',
        );
      }, RESULT_TIMEOUT_MS);
    }),
  );
  panel.appendChild(
    el('div', 'pkc-hint', '受信 HTML は描画・解析せず、そのままファイル保存します(container 全体が含まれるため)。応答は数 MB になることがあります'),
  );
  root.appendChild(panel);

  const result = el('div', 'pkc-panel');
  result.setAttribute('data-pkc-region', 'dl-result');
  result.appendChild(el('div', 'pkc-panel-heading', '結果'));
  resultHost = el('div', 'pkc-dl-result');
  result.appendChild(resultHost);
  root.appendChild(result);

  const hist = el('div', 'pkc-panel');
  hist.setAttribute('data-pkc-region', 'dl-history');
  hist.appendChild(el('div', 'pkc-panel-heading', '履歴(このセッションのみ)'));
  historyHost = el('div', 'pkc-history-list');
  hist.appendChild(historyHost);
  root.appendChild(hist);

  renderHistory();
  renderResult();
  return { conn };
}

const mountTarget = document.getElementById('downloader-root');
if (mountTarget) mountDownloader(mountTarget);
