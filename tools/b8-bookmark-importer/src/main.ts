/**
 * B8 bookmark-importer — bookmarks.html → record:offer batch (issue #30).
 *
 * Parses the NETSCAPE bookmark export (Chrome / Firefox / Edge 共通)via
 * DOMParser(inert — 文書に挿入しないためスクリプトは実行されない)、
 * 各ブックマークを「title + markdown リンク body + source_url」の text
 * offer にする。フォルダ階層はパス表記で body に残す。
 */

import '../../shared/base.css';
import './importer.css';
import { sendBatch, type BatchHandle, type BatchRow } from '../../shared/batch-offer';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-bookmark-importer';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const MAX_BOOKMARKS = 200;

export interface Bookmark {
  title: string;
  url: string;
  folder: string;
}

/**
 * Extract bookmarks with folder paths from a NETSCAPE bookmarks.html.
 * DOMParser is inert(返り値の文書は表示されない); only http(s) URLs
 * are kept. Pure given a Document factory; exported for tests.
 */
export function parseBookmarksHtml(html: string): Bookmark[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // NETSCAPE 形式は <DT> が閉じられず、パーサごとにネストが崩れる。
  // 構造を歩かず「全 <a> を拾い、祖先の各 DL について直前の H3 を
  // フォルダ名として遡る」方式なら整形・崩れの両方で安定する。
  const folderOf = (a: Element): string => {
    const path: string[] = [];
    let el: Element | null = a.parentElement;
    while (el) {
      if (el.tagName === 'DL') {
        let sib: Element | null = el.previousElementSibling;
        while (sib && sib.tagName !== 'H3') sib = sib.previousElementSibling;
        if (sib) path.unshift((sib.textContent ?? '').trim());
      }
      el = el.parentElement;
    }
    return path.join(' / ');
  };
  const out: Bookmark[] = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = a.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ title: (a.textContent ?? '').trim() || url, url, folder: folderOf(a) });
    if (out.length >= MAX_BOOKMARKS) break;
  }
  return out;
}

/** Bookmark → offer row. Pure. */
export function bookmarkToRow(b: Bookmark): BatchRow {
  const lines = [`[${b.title}](${b.url})`];
  if (b.folder !== '') lines.push('', `> folder: ${b.folder}`);
  return { title: b.title, body: lines.join('\n'), archetype: 'text', source_url: b.url };
}

const tracker = new OfferTracker();
let conn: HostConnection | null = null;
let bookmarks: Bookmark[] = [];
let batch: BatchHandle | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let offersHost: HTMLElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (bookmarks.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', 'ブラウザの bookmarks.html(エクスポート)を選択してください'));
    return;
  }
  for (const b of bookmarks.slice(0, 100)) {
    listEl.appendChild(el('div', 'pkc-history-row', `${b.folder !== '' ? `${b.folder} / ` : ''}${b.title}`));
  }
  if (bookmarks.length > 100) listEl.appendChild(el('div', 'pkc-hint', `… 他 ${bookmarks.length - 100} 件`));
}

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  for (const rec of [...tracker.all()].reverse().slice(0, 50)) {
    offersHost.appendChild(el('div', 'pkc-history-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
  }
}

export function mountBookmarkImporter(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-imp-root';

  const headerEl = el('div', 'pkc-imp-header');
  headerEl.setAttribute('data-pkc-region', 'bm-header');
  headerEl.appendChild(el('span', 'pkc-imp-title', '🔖 PKC2 Bookmark Importer'));
  headerEl.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — bookmarks.html の各項目を text offer に(上限 ${MAX_BOOKMARKS})`));
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
  loadPanel.setAttribute('data-pkc-region', 'bm-load');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.html,text/html';
  file.setAttribute('data-pkc-field', 'bm-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((html) => {
      bookmarks = parseBookmarksHtml(html);
      setStatus(`読み込み: ${bookmarks.length} 件(http(s) のみ)`);
      renderList();
    });
  });
  loadPanel.appendChild(file);
  const row2 = el('div', 'pkc-btn-row');
  row2.appendChild(
    button('一括 offer(間隔 600ms)', 'pkc-btn', () => {
      if (!conn || bookmarks.length === 0) {
        setStatus('送信対象がありません');
        return;
      }
      batch?.stop();
      batch = sendBatch(conn, tracker, bookmarks.map(bookmarkToRow), (sent, total, done) => {
        setStatus(done ? `完了/停止: ${sent}/${total} 件送信` : `送信中 ${sent}/${total}…`);
        renderOffers();
      });
    }),
  );
  row2.appendChild(button('⏹ 停止', 'pkc-btn-small', () => batch?.stop()));
  loadPanel.appendChild(row2);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'bm-status');
  loadPanel.appendChild(statusEl);
  root.appendChild(loadPanel);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'bm-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', '読み込んだブックマーク'));
  listEl = el('div', 'pkc-history-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'bm-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況(直近 50)'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  renderList();
  renderOffers();
  return { conn };
}

const mountTarget = document.getElementById('bookmark-root');
if (mountTarget) mountBookmarkImporter(mountTarget);
