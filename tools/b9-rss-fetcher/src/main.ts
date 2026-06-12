/**
 * B9 rss-fetcher — RSS/Atom の貼り付け → 選択 offer (issue #31)。
 *
 * 計画の「URL から fetch」は単一 HTML(file://)の CORS で成立しないため、
 * **ペーストモード**に転換: フィード XML を貼り付け / ファイルで読み込み、
 * 記事を選択して 1 件 = 1 offer で間隔送信(shared/batch-offer、flood guard 内)。
 * ネットワーク取得は一切しない。
 */

import '../../shared/base.css';
import './fetcher.css';
import { sendBatch, type BatchHandle, type BatchRow } from '../../shared/batch-offer';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el } from '../../shared/ui';
import { itemBody, parseFeed, MAX_FEED_ITEMS, type ParsedFeed } from './feed';

const TOOL_NAME = 'pkc2-rss-fetcher';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

let feed: ParsedFeed | null = null;
let checks: HTMLInputElement[] = [];
let batch: BatchHandle | null = null;

export function mountRssFetcher(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-b9-root';

  const header = el('div', 'pkc-b9-header');
  header.setAttribute('data-pkc-region', 'b9-header');
  header.appendChild(el('span', 'pkc-b9-title', '📰 PKC2 RSS Reader'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — フィード貼り付け → 選択 offer(外部通信なし)`));
  header.appendChild(helpButton('RSS Reader', {
    what: 'RSS 2.0 / Atom フィードの XML を貼り付けて記事一覧にし、選んだ記事を text として PKC2 に保存するツールです。フィードの取得(fetch)はしません — 完全オフラインです。',
    how: [
      'ブラウザでフィード URL を開き、XML を全選択コピー(またはファイル保存)',
      'ここに貼り付け / .xml ファイルを選択 → 記事一覧が出ます',
      '保存したい記事にチェック →「選択を offer」',
      '1 件 = 1 offer で間隔送信され、PKC2 側で記事ごとに accept します',
    ],
    flow: [
      '記事の description / content(HTML)は inert にテキスト化します(スクリプト・画像は実行/取得されません)',
      'リンクは http(s) のみ source_url として記録、送信間隔 600ms(host flood guard 対応)',
    ],
    notes: [
      'フィードの自動取得は CORS のため非対応(壁として記録済み)',
      `読み込み上限 ${MAX_FEED_ITEMS} 記事`,
    ],
  }));
  root.appendChild(header);

  const offerUi = createOfferUi(TOOL_ID);
  root.appendChild(offerUi.conn.root);

  const input = el('div', 'pkc-panel');
  input.setAttribute('data-pkc-region', 'b9-input');
  input.appendChild(el('div', 'pkc-panel-heading', 'フィード読み込み'));
  const paste = document.createElement('textarea');
  paste.rows = 6;
  paste.placeholder = 'ここにフィード XML(RSS 2.0 / Atom)を貼り付け';
  paste.setAttribute('data-pkc-field', 'b9-xml');
  input.appendChild(paste);
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.xml,.rss,.atom,application/rss+xml,application/atom+xml,text/xml';
  file.setAttribute('data-pkc-field', 'b9-file');
  input.appendChild(file);
  const parseBtn = button('解析', 'pkc-btn', () => loadFeed(paste.value));
  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(parseBtn);
  input.appendChild(bar);
  const status = el('div', 'pkc-hint');
  status.setAttribute('data-pkc-region', 'b9-status');
  input.appendChild(status);
  root.appendChild(input);

  const list = el('div', 'pkc-panel');
  list.setAttribute('data-pkc-region', 'b9-list');
  list.appendChild(el('div', 'pkc-hint', 'フィードを解析すると記事一覧がここに出ます'));
  root.appendChild(list);
  root.appendChild(offerUi.offersPanel);

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      paste.value = text;
      loadFeed(text);
    });
  });

  function loadFeed(text: string): void {
    if (text.trim() === '') {
      status.textContent = 'XML が空です';
      return;
    }
    feed = parseFeed(text);
    if (!feed) {
      status.textContent = 'RSS 2.0 / Atom として解析できませんでした';
      return;
    }
    status.textContent = `📥 ${feed.kind.toUpperCase()}「${feed.title || '(無題フィード)'}」 — ${feed.items.length} 記事`;
    renderList();
  }

  function renderList(): void {
    list.replaceChildren();
    checks = [];
    if (!feed) return;
    list.appendChild(el('div', 'pkc-panel-heading', `📰 ${feed.title || '(無題フィード)'}(${feed.items.length} 記事)`));

    const controls = el('div', 'pkc-btn-row');
    controls.appendChild(button('全選択', 'pkc-btn-small', () => checks.forEach((c) => { c.checked = true; })));
    controls.appendChild(button('全解除', 'pkc-btn-small', () => checks.forEach((c) => { c.checked = false; })));
    controls.appendChild(
      button('選択を offer(1 件 = 1 offer)', 'pkc-btn', () => {
        if (!feed) return;
        if (batch) {
          offerUi.note('送信中です(「停止」してから再実行してください)');
          return;
        }
        const rows: BatchRow[] = [];
        feed.items.forEach((item, i) => {
          if (!checks[i]?.checked) return;
          const row: BatchRow = { title: item.title, body: itemBody(item), archetype: 'text' };
          if (item.link !== '') row.source_url = item.link;
          rows.push(row);
        });
        if (rows.length === 0) {
          offerUi.note('記事が選択されていません');
          return;
        }
        batch = sendBatch(offerUi.conn, offerUi.tracker, rows, (sent, total, done) => {
          offerUi.note(done ? `📤 送信完了 ${sent}/${total} — PKC2 側で accept してください` : `送信中 ${sent}/${total}…`);
          if (done) batch = null;
        });
      }),
    );
    controls.appendChild(button('停止', 'pkc-btn-small', () => {
      batch?.stop();
      batch = null;
    }));
    list.appendChild(controls);

    for (const item of feed.items) {
      const row = el('label', 'pkc-b9-item');
      const check = document.createElement('input');
      check.type = 'checkbox';
      checks.push(check);
      row.appendChild(check);
      const meta = el('div', 'pkc-b9-itemmeta');
      meta.appendChild(el('div', 'pkc-b9-itemtitle', item.title));
      const sub: string[] = [];
      if (item.date !== '') sub.push(item.date);
      if (item.link !== '') sub.push(item.link);
      if (sub.length > 0) meta.appendChild(el('div', 'pkc-hint', sub.join(' — ')));
      if (item.summary !== '') {
        meta.appendChild(el('div', 'pkc-b9-itemsummary', item.summary.length > 200 ? `${item.summary.slice(0, 200)}…` : item.summary));
      }
      row.appendChild(meta);
      list.appendChild(row);
    }
  }
}

const mountTarget = document.getElementById('b9-root');
if (mountTarget) mountRssFetcher(mountTarget);
