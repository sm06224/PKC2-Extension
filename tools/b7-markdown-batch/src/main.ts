/**
 * B7 markdown-batch — .md files → record:offer batch (issue #29).
 *
 * Select multiple .md files; each becomes one offer. Simple front-matter
 * (`---` fenced `key: value`)is honored: `title:` / `archetype:` /
 * `source_url:`。title fallback = 先頭の # 見出し → ファイル名。
 */

import '../../shared/base.css';
import './importer.css';
import { helpButton } from '../../shared/help';
import { sendBatch, splitFrontMatter, type BatchHandle, type BatchRow } from '../../shared/batch-offer';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-markdown-batch';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const MAX_FILES = 100;
const ALLOWED_ARCHETYPES = new Set(['text', 'textlog', 'todo', 'form', 'generic']);

const tracker = new OfferTracker();
let conn: HostConnection | null = null;
let rows: BatchRow[] = [];
let batch: BatchHandle | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let offersHost: HTMLElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/** One .md file → one offer row. Pure; exported for tests. */
export function mdToRow(filename: string, content: string): BatchRow {
  const { meta, body } = splitFrontMatter(content);
  let title = meta['title'] ?? '';
  if (title === '') {
    const h = /^#\s+(.+)$/m.exec(body);
    title = h ? h[1]!.trim() : filename.replace(/\.(md|markdown|txt)$/i, '');
  }
  const row: BatchRow = { title, body };
  const arch = meta['archetype'];
  if (arch !== undefined && ALLOWED_ARCHETYPES.has(arch)) row.archetype = arch;
  const src = meta['source_url'];
  if (src !== undefined && /^https?:\/\//.test(src)) row.source_url = src;
  return row;
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (rows.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', '.md ファイルを選択してください(複数可、front-matter の title / archetype / source_url を解釈)'));
    return;
  }
  for (const r of rows) {
    listEl.appendChild(el('div', 'pkc-history-row', `"${r.title}"${r.archetype ? ` [${r.archetype}]` : ''}(${r.body.length.toLocaleString()} units)`));
  }
}

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  for (const rec of [...tracker.all()].reverse().slice(0, 50)) {
    offersHost.appendChild(el('div', 'pkc-history-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
  }
}

export function mountMdBatch(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-imp-root';

  const headerEl = el('div', 'pkc-imp-header');
  headerEl.setAttribute('data-pkc-region', 'md-header');
  headerEl.appendChild(el('span', 'pkc-imp-title', '📚 PKC2 Markdown Batch'));
  headerEl.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 複数 .md を 1 ファイル = 1 offer で送信`));
  headerEl.appendChild(helpButton('Markdown Batch', {
    what: "複数の .md ファイルをそれぞれ 1 entry として一括 offer します。",
    how: [
      "PKC2 に接続する",
      ".md ファイルを複数選択(上限 100)",
      "一覧で title と本文サイズを確認",
      "「一括 offer」(600ms 間隔・停止可)",
    ],
    flow: [
      "front-matter(--- で囲んだ title / archetype / source_url)を解釈します",
      "title の優先順: front-matter > 先頭の # 見出し > ファイル名",
    ],
    notes: [
      "未知の archetype と http(s) 以外の source_url は安全のため無視されます",
    ],
  }));
  root.appendChild(headerEl);

  conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: setStatus,
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      if (type === 'record:ack' && tracker.resolveAck(payload)) renderOffers();
      else if (type === 'record:accept' && tracker.resolveAccept(payload)) renderOffers();
      else if (type === 'record:reject' && tracker.resolveReject(payload)) renderOffers();
    },
  });
  root.appendChild(conn.root);

  const loadPanel = el('div', 'pkc-panel');
  loadPanel.setAttribute('data-pkc-region', 'md-load');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.md,.markdown,.txt,text/markdown,text/plain';
  file.multiple = true;
  file.setAttribute('data-pkc-field', 'md-files');
  file.addEventListener('change', () => {
    const files = [...(file.files ?? [])].slice(0, MAX_FILES);
    if (files.length === 0) return;
    void Promise.all(files.map(async (f) => mdToRow(f.name, await f.text()))).then((r) => {
      rows = r;
      setStatus(`読み込み: ${rows.length} ファイル`);
      renderList();
    });
  });
  loadPanel.appendChild(file);

  const row2 = el('div', 'pkc-btn-row');
  row2.appendChild(
    button('一括 offer(間隔 600ms)', 'pkc-btn', () => {
      if (!conn || rows.length === 0) {
        setStatus('送信対象がありません');
        return;
      }
      batch?.stop();
      batch = sendBatch(conn, tracker, rows, (sent, total, done) => {
        setStatus(done ? `完了/停止: ${sent}/${total} 件送信` : `送信中 ${sent}/${total}…`);
        renderOffers();
      });
    }),
  );
  row2.appendChild(button('⏹ 停止', 'pkc-btn-small', () => batch?.stop()));
  loadPanel.appendChild(row2);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'md-status');
  loadPanel.appendChild(statusEl);
  root.appendChild(loadPanel);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'md-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', '読み込んだファイル'));
  listEl = el('div', 'pkc-history-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'md-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況(直近 50)'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  renderList();
  renderOffers();
  return { conn };
}

const mountTarget = document.getElementById('mdbatch-root');
if (mountTarget) mountMdBatch(mountTarget);
