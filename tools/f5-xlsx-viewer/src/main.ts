/**
 * F5 xlsx-viewer — .xlsx のシート切替表示 + T1 受動受信 (issue #63)。
 *
 * 依存ゼロ(shared/zip.ts + ./xlsx.ts)で値のみを <table> 表示する。
 * SheetJS は不採用: npm 配布の `xlsx` は 0.18.5 で停滞しており既知 CVE
 * (CVE-2023-30533 / CVE-2024-22363)の修正版が npm に無い。
 * 入力は standalone(ファイル/D&D)と T1(pkc:deliver)の 2 経路。
 */

import '../../shared/base.css';
import './viewer.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, type FoldSection } from '../../shared/ui';
import { colLetter, gridToCsv, openXlsx, sheetGrid, MAX_COLS, MAX_ROWS, type SheetGrid, type XlsxFile } from './xlsx';

const TOOL_NAME = 'pkc2-xlsx-viewer';
const TOOL_VERSION = '0.1.0';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** projection から xlsx らしい添付を抽出。Pure. */
export function pickXlsxEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === MIME_XLSX || /\.xlsx$/i.test(e.filename ?? '')),
  );
}

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let bookEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let menuFold: FoldSection | null = null;

interface ViewState {
  file: XlsxFile;
  label: string;
  active: number;
}

let view: ViewState | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function renderGrid(target: HTMLElement, grid: SheetGrid): void {
  target.replaceChildren();
  if (grid.rows.length === 0) {
    target.appendChild(el('div', 'pkc-hint', '(空シート)'));
    return;
  }
  const cols = grid.rows[0]?.length ?? 0;
  const table = document.createElement('table');
  table.className = 'pkc-xlsx-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(el('th', 'pkc-xlsx-corner', ''));
  for (let c = 0; c < cols; c++) headRow.appendChild(el('th', 'pkc-xlsx-colhead', colLetter(c)));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (let r = 0; r < grid.rows.length; r++) {
    const tr = document.createElement('tr');
    tr.appendChild(el('th', 'pkc-xlsx-rowhead', String(r + 1)));
    for (const cell of grid.rows[r]!) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  target.appendChild(table);
  if (grid.truncatedRows || grid.truncatedCols) {
    target.appendChild(
      el('div', 'pkc-hint', `⚠️ 表示上限で打ち切りました(最大 ${MAX_ROWS} 行 × ${MAX_COLS} 列)。全データは CSV 保存で取得してください`),
    );
  }
}

function renderBook(): void {
  if (!bookEl || !view) return;
  const v = view;
  bookEl.replaceChildren();
  bookEl.appendChild(el('div', 'pkc-panel-heading', `📈 ${v.label}(${v.file.sheets.length} シート)`));

  const tabs = el('div', 'pkc-xlsx-tabs');
  tabs.setAttribute('data-pkc-region', 'xlsx-tabs');
  for (let i = 0; i < v.file.sheets.length; i++) {
    const b = button(v.file.sheets[i]!.name, i === v.active ? 'pkc-btn-small pkc-xlsx-tab-active' : 'pkc-btn-small', () => {
      v.active = i;
      renderBook();
    });
    tabs.appendChild(b);
  }
  bookEl.appendChild(tabs);

  const gridBox = el('div', 'pkc-xlsx-gridbox');
  gridBox.setAttribute('data-pkc-region', 'xlsx-grid');
  gridBox.appendChild(el('div', 'pkc-hint', '読み込み中…'));
  bookEl.appendChild(gridBox);

  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(
    button('💾 このシートを CSV 保存', 'pkc-btn-small', () => {
      void sheetGrid(v.file, v.active).then((g) => {
        if (!g) return;
        const blob = new Blob([gridToCsv(g.rows)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(v.file.sheets[v.active]?.name ?? 'sheet').replace(/[\\/:*?"<>|]/g, '_')}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }),
  );
  bookEl.appendChild(bar);

  void sheetGrid(v.file, v.active).then((g) => {
    // タブ切替で view が進んでいたら破棄(世代ガード)
    if (view !== v || v.active !== view.active) return;
    if (!g) {
      gridBox.replaceChildren(el('div', 'pkc-hint', 'シートの読み込みに失敗しました'));
      return;
    }
    renderGrid(gridBox, g);
  });
}

function loadBytes(bytes: Uint8Array, label: string): void {
  void openXlsx(bytes).then((file) => {
    if (!file) {
      setStatus('xlsx として解析できませんでした(xls / xlsb は非対応です)');
      return;
    }
    view = { file, label, active: 0 };
    renderBook();
    menuFold?.collapse();
    setStatus(`${label} を表示中`);
  });
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体は xlsx asset ではありません');
    return;
  }
  const isXlsx = d.mime === MIME_XLSX || /\.xlsx$/i.test(d.filename ?? '');
  if (!isXlsx) {
    setStatus(`受信した asset は xlsx ではありません(mime=${d.mime ?? '?'})`);
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  loadBytes(bytes, `📈 ${d.filename ?? '(無名)'}(PKC2 から送付)`);
}

function renderIndex(p: ContainerProjection): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const items = pickXlsxEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📈 ${p.title} の Excel 添付(${items.length} 件)`));
  if (items.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'Excel(.xlsx)の添付はありません'));
    return;
  }
  for (const e of items) {
    const row = el('div', 'pkc-xlsx-indexrow');
    row.appendChild(el('span', 'pkc-xlsx-indextitle', e.filename ?? e.title));
    row.appendChild(
      button('開いてほしい', 'pkc-btn-small', () => {
        channel?.sendHint('open', e.lid);
        setStatus(`ヒント送信 — PKC2 側で「${e.title}」を「拡張へ送る」と表示されます`);
      }),
    );
    indexEl.appendChild(row);
  }
  indexEl.appendChild(el('div', 'pkc-hint', '実体は PKC2 側の送付ジェスチャで届きます(host-push — 取得 API はありません)'));
}

export function mountXlsxViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-xlsx-root';

  const header = el('div', 'pkc-xlsx-header');
  header.setAttribute('data-pkc-region', 'xlsx-header');
  header.appendChild(el('span', 'pkc-xlsx-title', '📈 PKC2 XLSX Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — .xlsx を依存ゼロで表示(オフライン)`));
  header.appendChild(helpButton('XLSX Viewer', {
    what: '.xlsx(Excel)をシート切替・グリッドで表示するオフラインビューアです。単体でも、PKC2 の添付ビューア(T1)としても動きます。',
    how: [
      '単体: .xlsx をファイル選択 or ドラッグ&ドロップ',
      'PKC2 連携: 起動すると Excel 添付の索引が出ます',
      'PKC2 側で対象を「拡張へ送る」と、ここに表示されます(host-push)',
      'シートはタブで切替、「CSV 保存」で値を取り出せます',
    ],
    flow: [
      'ZIP(DecompressionStream)+ XML(DOMParser)の依存ゼロ実装で、外部ライブラリを同梱しません',
      'セルの値のみを textContent で表示します — マクロ・数式は実行されません(数式はキャッシュ値)',
    ],
    notes: [
      '書式(色・罫線・数値フォーマット)は対象外。日付はシリアル値のまま表示されます',
      `表示は最大 ${MAX_ROWS} 行 × ${MAX_COLS} 列(超過分は CSV 保存で取得)`,
      '.xls / .xlsb(旧バイナリ形式)は非対応',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection: renderIndex, onDeliver });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'xlsx-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'xlsx-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = `.xlsx,${MIME_XLSX}`;
  file.setAttribute('data-pkc-field', 'xlsx-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `📈 ${f.name}`));
  });
  open.appendChild(file);

  const menu = el('div', 'pkc-fold-stack');
  menu.appendChild(indexEl);
  menu.appendChild(open);
  menuFold = foldSection('📂 メニュー — PKC2 索引 / ファイルを開く', menu);
  root.appendChild(menuFold.el);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'xlsx-status');
  root.appendChild(statusEl);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `📈 ${f.name}`));
  });

  bookEl = el('div', 'pkc-panel pkc-xlsx-book');
  bookEl.setAttribute('data-pkc-region', 'xlsx-book');
  bookEl.appendChild(el('div', 'pkc-hint', '.xlsx を開くとここに表示されます'));
  root.appendChild(bookEl);

  return { channel };
}

const mountTarget = document.getElementById('xlsx-root');
if (mountTarget) mountXlsxViewer(mountTarget);
