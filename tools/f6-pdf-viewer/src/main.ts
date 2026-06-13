/**
 * F6 pdf-viewer — オフライン PDF ビューア + T1 受動受信 (issue #64).
 *
 * pdf.js(Apache-2.0)同梱の単一 HTML。2 つの入力経路:
 *  1. **standalone**: ファイル選択 / ドラッグ&ドロップで PDF を開く
 *  2. **T1(host-push、PKC2#806 rev.2)**: PKC2 から起動されると
 *     `pkc:projection` で PDF 添付の索引を表示し、ユーザーが PKC2 側で
 *     「拡張へ送る」した実体が `pkc:deliver` で届いて表示される。
 *     **拡張から取りに行く API は存在しない**(受動モデル)
 *
 * worker は `?raw` で同梱し Blob URL から起動(オフライン成立)。失敗時は
 * pdf.js が main-thread の fake worker へフォールバックする。
 * 描画は pdf.js の canvas のみ — 受信データを DOM に注入しない。
 */

import '../../shared/base.css';
import './viewer.css';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerRaw from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, selectInput, type FoldSection } from '../../shared/ui';

declare const __PDFJS_VERSION__: string;

const TOOL_NAME = 'pkc2-pdf-viewer';
const TOOL_VERSION = '0.1.0';
const MAX_RENDER_PAGES = 100;

// worker を Blob URL で供給(単一 HTML・オフライン)。
try {
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
    new Blob([workerRaw], { type: 'text/javascript' }),
  );
} catch {
  /* fake worker fallback に任せる */
}

/** base64 → bytes(deliver の data_base64 用)。Pure-ish(atob 依存)。 */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** projection から PDF らしい添付を抽出。Pure. */
export function pickPdfEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === 'application/pdf' || /\.pdf$/i.test(e.filename ?? '')),
  );
}

interface ViewerState {
  data: Uint8Array | null;
  sourceLabel: string;
  scale: number;
  pageCount: number;
}

const state: ViewerState = { data: null, sourceLabel: '', scale: 1.25, pageCount: 0 };

let pagesEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let indexEl: HTMLElement | null = null;
let channel: ExtChannel | null = null;
let menuFold: FoldSection | null = null;
let renderSeq = 0;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

async function renderPdf(): Promise<void> {
  if (!pagesEl || !state.data) return;
  const seq = ++renderSeq;
  pagesEl.replaceChildren(el('div', 'pkc-hint', '描画中…'));
  try {
    // pdf.js は transfer で buffer を解放するため毎回コピーを渡す
    // (zoom 変更での再描画に元データを保持する)。
    const doc = await pdfjs.getDocument({ data: state.data.slice() }).promise;
    if (seq !== renderSeq) return; // 新しい読み込みが始まった
    state.pageCount = doc.numPages;
    pagesEl.replaceChildren();
    const shown = Math.min(doc.numPages, MAX_RENDER_PAGES);
    for (let i = 1; i <= shown; i++) {
      const page = await doc.getPage(i);
      if (seq !== renderSeq) return;
      const viewport = page.getViewport({ scale: state.scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pkc-pdf-page';
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      pagesEl.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    }
    if (doc.numPages > shown) {
      pagesEl.appendChild(el('div', 'pkc-hint', `… 全 ${doc.numPages} ページ中 ${shown} ページまで表示(上限)`));
    }
    menuFold?.collapse();
    setStatus(`${state.sourceLabel} — ${doc.numPages} ページ(zoom ${Math.round(state.scale * 100)}%)`);
  } catch (ex) {
    if (seq !== renderSeq) return;
    pagesEl.replaceChildren();
    setStatus(`PDF を開けませんでした: ${ex instanceof Error ? ex.message : String(ex)}`);
  }
}

function loadBytes(bytes: Uint8Array, label: string): void {
  state.data = bytes;
  state.sourceLabel = label;
  setStatus(`読み込み中: ${label}`);
  void renderPdf();
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体は PDF asset ではありません(entry 本文は本ツールの対象外)');
    return;
  }
  const isPdf = d.mime === 'application/pdf' || /\.pdf$/i.test(d.filename ?? '');
  if (!isPdf) {
    setStatus(`受信した asset は PDF ではありません(mime=${d.mime ?? '?'})`);
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  loadBytes(bytes, `📄 ${d.filename ?? d.asset_key ?? '(無名)'}(PKC2 から送付)`);
}

function renderIndex(p: ContainerProjection): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const pdfs = pickPdfEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📚 ${p.title} の PDF 添付(${pdfs.length} 件)`));
  if (pdfs.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'PDF の添付はありません'));
    return;
  }
  for (const e of pdfs) {
    const row = el('div', 'pkc-pdf-indexrow');
    const size = e.asset_size !== undefined ? `(~${Math.round((e.asset_size * 3) / 4 / 1024).toLocaleString()} KB)` : '';
    row.appendChild(el('span', 'pkc-pdf-indextitle', `${e.filename ?? e.title}${size}`));
    row.appendChild(
      button('開いてほしい', 'pkc-btn-small', () => {
        channel?.sendHint('open', e.lid);
        setStatus(`ヒントを送信しました — PKC2 側で「${e.title}」を右クリック →「拡張へ送る」で表示できます`);
      }, 'ホストへの軽量ヒント(実体は PKC2 側の送付操作で届きます)'),
    );
    indexEl.appendChild(row);
  }
  indexEl.appendChild(
    el('div', 'pkc-hint', '実体は PKC2 側の「拡張へ送る」操作(send ジェスチャ)で届きます — このツールから取得することはできません(host-push 体系)'),
  );
}

export function mountPdfViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-pdf-root';

  const header = el('div', 'pkc-pdf-header');
  header.setAttribute('data-pkc-region', 'pdf-header');
  header.appendChild(el('span', 'pkc-pdf-title', '📄 PKC2 PDF Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — pdf.js v${__PDFJS_VERSION__}(Apache-2.0)同梱・オフライン`));
  header.appendChild(helpButton('PDF Viewer', {
    what: 'PDF をその場で表示するオフラインビューアです。単体でも、PKC2 の添付ビューア(T1)としても動きます。',
    how: [
      '単体: PDF をファイル選択 or ドラッグ&ドロップ',
      'PKC2 連携: PKC2 から起動すると添付の索引が出ます',
      'PKC2 側で対象を「拡張へ送る」と、ここに表示されます(host-push)',
      'zoom はセレクタで変更',
    ],
    flow: [
      '連携時は pkc:projection(索引のみ)→ ユーザーの送付操作 → pkc:deliver(実体)の受動モデルです(PKC2#806 rev.2)',
      'このツールから PKC2 のデータを取得する API はありません',
    ],
    notes: [
      '描画上限 100 ページ',
      'PDF の描画は pdf.js の canvas のみ(受信データを DOM に注入しません)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- T1 channel(ホストがいれば索引 + deliver 受信)
  channel = new ExtChannel({
    onProjection: (p) => renderIndex(p),
    onDeliver,
  });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'pdf-index');
  if (connected) {
    indexEl.appendChild(el('div', 'pkc-hint', 'PKC2 に接続しました — projection 待機中…'));
  } else {
    indexEl.appendChild(el('div', 'pkc-hint', 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'));
  }

  // ---- standalone 入力
  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'pdf-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.pdf,application/pdf';
  file.setAttribute('data-pkc-field', 'pdf-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `📄 ${f.name}`));
  });
  const zoom = selectInput([
    { value: '1', label: 'zoom: 100%' },
    { value: '1.25', label: 'zoom: 125%' },
    { value: '1.5', label: 'zoom: 150%' },
    { value: '2', label: 'zoom: 200%' },
  ]);
  zoom.value = String(state.scale);
  zoom.addEventListener('change', () => {
    state.scale = Number(zoom.value) || 1.25;
    void renderPdf();
  });
  const row = el('div', 'pkc-btn-row');
  row.appendChild(file);
  row.appendChild(zoom);
  open.appendChild(row);

  const menu = el('div', 'pkc-fold-stack');
  menu.appendChild(indexEl);
  menu.appendChild(open);
  menuFold = foldSection('📂 メニュー — PKC2 索引 / ファイルを開く / zoom', menu);
  root.appendChild(menuFold.el);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'pdf-status');
  root.appendChild(statusEl);

  // drag & drop
  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `📄 ${f.name}`));
  });

  pagesEl = el('div', 'pkc-pdf-pages');
  pagesEl.setAttribute('data-pkc-region', 'pdf-pages');
  root.appendChild(pagesEl);

  return { channel };
}

const mountTarget = document.getElementById('pdf-root');
if (mountTarget) mountPdfViewer(mountTarget);
