/**
 * B6 csv-importer — CSV rows → record:offer batch (issue #28).
 *
 * Load a CSV (header row required), map columns to title / body, preview,
 * then send sequentially. v1 requires a user accept **per offer**(spec
 * §6.2)so the host shows one banner per row — the count is surfaced
 * before sending so大量行をうっかり流さない。
 */

import '../../shared/base.css';
import './importer.css';
import { sendBatch, parseCsv, type BatchHandle, type BatchRow } from '../../shared/batch-offer';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el, selectInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-csv-importer';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const MAX_ROWS = 200;

const tracker = new OfferTracker();
let conn: HostConnection | null = null;
let header: string[] = [];
let dataRows: string[][] = [];
let batch: BatchHandle | null = null;

let mapHost: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let offersHost: HTMLElement | null = null;
let titleSel: HTMLSelectElement | null = null;
let bodySel: HTMLSelectElement | null = null;
let restToggle: HTMLInputElement | null = null;
let archetypeSel: HTMLSelectElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  const records = tracker.all();
  for (const rec of [...records].reverse().slice(0, 50)) {
    offersHost.appendChild(el('div', 'pkc-history-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
  }
}

/** Build batch rows from the current mapping. Pure-ish (reads selects). */
export function buildRows(
  head: readonly string[],
  rows: readonly string[][],
  titleIdx: number,
  bodyIdx: number,
  includeRest: boolean,
  archetype: string,
): BatchRow[] {
  const out: BatchRow[] = [];
  for (const r of rows) {
    const title = (r[titleIdx] ?? '').trim();
    if (title === '') continue;
    let body = bodyIdx >= 0 ? (r[bodyIdx] ?? '') : '';
    if (includeRest) {
      const rest = head
        .map((h, i) => ({ h, v: (r[i] ?? '').trim(), i }))
        .filter((x) => x.i !== titleIdx && x.i !== bodyIdx && x.v !== '')
        .map((x) => `- ${x.h}: ${x.v}`);
      if (rest.length > 0) body = `${body}${body !== '' ? '\n\n' : ''}${rest.join('\n')}`;
    }
    const row: BatchRow = { title, body };
    if (archetype !== '') row.archetype = archetype;
    out.push(row);
  }
  return out;
}

function renderMapping(): void {
  if (!mapHost) return;
  mapHost.replaceChildren();
  if (header.length === 0) {
    mapHost.appendChild(el('div', 'pkc-hint', 'CSV を読み込むと列マッピングが表示されます(1 行目はヘッダ)'));
    return;
  }
  const cols = header.map((h, i) => ({ value: String(i), label: `${i + 1}: ${h}` }));
  titleSel = selectInput(cols);
  titleSel.setAttribute('data-pkc-field', 'csv-title-col');
  bodySel = selectInput([{ value: '-1', label: '(なし)' }, ...cols]);
  bodySel.setAttribute('data-pkc-field', 'csv-body-col');
  if (cols.length > 1) bodySel.value = '1';
  archetypeSel = selectInput([
    { value: '', label: 'archetype: (host 既定)' },
    ...['text', 'textlog', 'todo', 'form', 'generic'].map((a) => ({ value: a, label: `archetype: ${a}` })),
  ]);
  restToggle = document.createElement('input');
  restToggle.type = 'checkbox';
  restToggle.checked = true;

  mapHost.appendChild(el('div', 'pkc-hint', `${dataRows.length} データ行(上限 ${MAX_ROWS})`));
  const row1 = el('div', 'pkc-btn-row');
  row1.appendChild(el('span', 'pkc-field-label', 'title 列'));
  row1.appendChild(titleSel);
  row1.appendChild(el('span', 'pkc-field-label', 'body 列'));
  row1.appendChild(bodySel);
  row1.appendChild(archetypeSel);
  mapHost.appendChild(row1);
  const lbl = el('label', 'pkc-inline-check');
  lbl.appendChild(restToggle);
  lbl.appendChild(document.createTextNode(' 残りの列を「- 列名: 値」として body に含める'));
  mapHost.appendChild(lbl);

  const send = button('一括 offer(間隔 600ms)', 'pkc-btn', () => {
    if (!conn || !titleSel || !bodySel || !restToggle || !archetypeSel) return;
    const rows = buildRows(header, dataRows, Number(titleSel.value), Number(bodySel.value), restToggle.checked, archetypeSel.value);
    if (rows.length === 0) {
      setStatus('送信対象 0 行(title が空の行はスキップされます)');
      return;
    }
    batch?.stop();
    setStatus(`送信中 0/${rows.length}…(host には 1 行ずつ PendingOffer banner が積まれます)`);
    batch = sendBatch(conn, tracker, rows, (sent, total, done) => {
      setStatus(done ? `完了/停止: ${sent}/${total} 件送信` : `送信中 ${sent}/${total}…`);
      renderOffers();
    });
  });
  const stop = button('⏹ 停止', 'pkc-btn-small', () => batch?.stop());
  const row2 = el('div', 'pkc-btn-row');
  row2.appendChild(send);
  row2.appendChild(stop);
  mapHost.appendChild(row2);
}

export function mountCsvImporter(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-imp-root';

  const headerEl = el('div', 'pkc-imp-header');
  headerEl.setAttribute('data-pkc-region', 'csv-header');
  headerEl.appendChild(el('span', 'pkc-imp-title', '📑 PKC2 CSV Importer'));
  headerEl.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — CSV の各行を record:offer に(accept は host 側で 1 件ずつ)`));
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
  loadPanel.setAttribute('data-pkc-region', 'csv-load');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.csv,text/csv';
  file.setAttribute('data-pkc-field', 'csv-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setStatus('ヘッダ行 + 1 データ行以上が必要です');
        return;
      }
      header = rows[0]!.map((h) => h.trim());
      dataRows = rows.slice(1, 1 + MAX_ROWS);
      setStatus(rows.length - 1 > MAX_ROWS ? `${rows.length - 1} 行中、先頭 ${MAX_ROWS} 行のみ対象にしました` : `読み込み: ${dataRows.length} 行`);
      renderMapping();
    });
  });
  loadPanel.appendChild(file);
  root.appendChild(loadPanel);

  const mapPanel = el('div', 'pkc-panel');
  mapPanel.setAttribute('data-pkc-region', 'csv-map');
  mapHost = el('div');
  mapPanel.appendChild(mapHost);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'csv-status');
  mapPanel.appendChild(statusEl);
  root.appendChild(mapPanel);

  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'csv-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況(直近 50)'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  renderMapping();
  renderOffers();
  return { conn };
}

const mountTarget = document.getElementById('csv-root');
if (mountTarget) mountCsvImporter(mountTarget);
