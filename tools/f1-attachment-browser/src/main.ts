/**
 * F1 attachment-browser — 全添付の索引 + MIME 別振分けハブ (issue #59)。
 *
 * 旧計画(export:request + SR-15 pull)は host-push 体系(PKC2#806 rev.2)で
 * 置き換え: projection で添付のメタデータ(mime / filename / asset_size)を
 * 一覧・検索・ソートし、実体はユーザーの送付ジェスチャ(deliver)でのみ届く。
 * 届いた実体は 画像 = blob <img> / テキスト = textContent / その他 = 保存、
 * の汎用プレビュー。専用形式は推奨ビューア(F2/F6 …)へ振り分け案内する。
 */

import '../../shared/base.css';
import './viewer.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-attachment-browser';
const TOOL_VERSION = '0.1.0';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* --------------------------------------------- pure helpers (tested) */

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  eml: 'message/rfc822',
  docx: MIME_DOCX,
  doc: 'application/msword',
  pptx: MIME_PPTX,
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: MIME_XLSX,
  xls: 'application/vnd.ms-excel',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

/** projection から添付を抽出。Pure. */
export function pickAttachments(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter((e) => e.archetype === 'attachment');
}

/** mime(小文字)を返す。無い場合は拡張子から推定、不明は ''。Pure. */
export function mimeOf(e: { mime?: string | undefined; filename?: string | undefined }): string {
  if (e.mime) return e.mime.toLowerCase();
  const m = /\.([a-z0-9]+)$/i.exec(e.filename ?? '');
  return m ? (EXT_MIME[m[1]!.toLowerCase()] ?? '') : '';
}

/** このツール内でテキストとして安全にプレビューできる mime か。Pure. */
export function isTextLike(mime: string): boolean {
  return (
    mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/xml'
    || mime.endsWith('+json')
    || mime.endsWith('+xml')
  );
}

/** MIME 別アイコン(emoji)。Pure. */
export function iconFor(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📄';
  if (mime === 'message/rfc822') return '✉️';
  if (mime === MIME_DOCX || mime === 'application/msword') return '📃';
  if (mime === MIME_PPTX || mime === 'application/vnd.ms-powerpoint') return '📊';
  if (mime === MIME_XLSX || mime === 'application/vnd.ms-excel' || mime === 'text/csv') return '📈';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.startsWith('video/')) return '🎬';
  if (mime === 'application/zip' || mime === 'application/gzip') return '🗜️';
  if (isTextLike(mime)) return '📝';
  return '📦';
}

/** 推奨ビューアの案内ラベル('' = 保存のみ)。Pure. */
export function viewerFor(mime: string): string {
  if (mime === 'message/rfc822') return 'F2 email-viewer';
  if (mime === 'application/pdf') return 'F6 pdf-viewer';
  if (mime === MIME_DOCX) return 'F3 docx-viewer';
  if (mime === MIME_PPTX) return 'F4 pptx-viewer';
  if (mime === MIME_XLSX) return 'F5 xlsx-viewer';
  if (mime.startsWith('image/')) return 'このツールで表示';
  if (isTextLike(mime)) return 'このツールで表示';
  return '';
}

export type SortKey = 'name' | 'date' | 'type' | 'size';

/** ソート(非破壊)。date = 更新が新しい順、size = 大きい順。Pure. */
export function sortEntries(entries: ProjectionEntry[], key: SortKey): ProjectionEntry[] {
  const arr = [...entries];
  const name = (e: ProjectionEntry): string => (e.filename ?? e.title).toLowerCase();
  if (key === 'name') arr.sort((a, b) => name(a).localeCompare(name(b)));
  else if (key === 'date') arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  else if (key === 'type') arr.sort((a, b) => mimeOf(a).localeCompare(mimeOf(b)) || name(a).localeCompare(name(b)));
  else arr.sort((a, b) => (b.asset_size ?? -1) - (a.asset_size ?? -1));
  return arr;
}

/** filename / title / mime の部分一致(小文字)。空クエリは素通し。Pure. */
export function filterEntries(entries: ProjectionEntry[], query: string): ProjectionEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;
  return entries.filter(
    (e) =>
      (e.filename ?? '').toLowerCase().includes(needle)
      || e.title.toLowerCase().includes(needle)
      || mimeOf(e).includes(needle),
  );
}

/** バイト数の表示文字列。不明は '—'。Pure. */
export function formatSize(n?: number): string {
  if (typeof n !== 'number' || !(n >= 0)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------ preview */

const MAX_TEXT_PREVIEW = 200_000; // UTF-16 units

let lastPreviewUrl: string | null = null;

function trackBlobUrl(blob: Blob): string {
  if (lastPreviewUrl !== null) URL.revokeObjectURL(lastPreviewUrl);
  lastPreviewUrl = URL.createObjectURL(blob);
  return lastPreviewUrl;
}

function saveBar(label: string, mime: string, bytes: Uint8Array): HTMLElement {
  const row = el('div', 'pkc-att-savebar');
  row.appendChild(
    button('💾 保存', 'pkc-btn-small', () => {
      const blob = new Blob([bytes.slice()], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (label || 'attachment').replace(/[\\/:*?"<>|]/g, '_');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
  );
  return row;
}

/**
 * 汎用プレビュー: 画像 = blob <img>(スクリプトは実行されない)/
 * テキスト = textContent / その他 = 案内 + 保存。Pure-ish(DOM 生成のみ)。
 */
export function previewBytes(label: string, mime: string, bytes: Uint8Array): HTMLElement {
  const box = el('div', 'pkc-att-preview');
  box.setAttribute('data-pkc-region', 'att-preview-body');
  box.appendChild(
    el('div', 'pkc-panel-heading', `${iconFor(mime)} ${label}(${mime || 'mime 不明'}、${formatSize(bytes.length)})`),
  );
  if (mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.className = 'pkc-att-img';
    img.alt = label;
    img.src = trackBlobUrl(new Blob([bytes.slice()], { type: mime }));
    box.appendChild(img);
  } else if (isTextLike(mime)) {
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      text = '(デコード不能)';
    }
    const pre = el('pre', 'pkc-att-text');
    pre.textContent =
      text.length > MAX_TEXT_PREVIEW
        ? `${text.slice(0, MAX_TEXT_PREVIEW)}\n…(以降 ${text.length - MAX_TEXT_PREVIEW} 文字を省略。全文は保存で取得)`
        : text;
    box.appendChild(pre);
  } else {
    box.appendChild(el('div', 'pkc-hint', 'この形式はインラインプレビュー非対応です(保存して開いてください)'));
    const v = viewerFor(mime);
    if (v !== '') box.appendChild(el('div', 'pkc-hint', `推奨ビューア: ${v}`));
  }
  box.appendChild(saveBar(label, mime, bytes));
  return box;
}

/* ------------------------------------------------------------ runtime */

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let previewEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

interface BrowserState {
  projection: ContainerProjection | null;
  query: string;
  sortKey: SortKey;
}

const state: BrowserState = { projection: null, query: '', sortKey: 'date' };

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

function renderIndex(): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    indexEl.appendChild(el('div', 'pkc-hint', 'PKC2 からの projection 待機中…'));
    return;
  }
  const all = pickAttachments(p);
  const total = all.reduce((s, x) => s + (x.asset_size ?? 0), 0);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📦 ${p.title} の添付(${all.length} 件 / 合計 ${formatSize(total)})`));
  if (all.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', '添付はありません'));
    return;
  }
  const shown = sortEntries(filterEntries(all, state.query), state.sortKey);
  if (shown.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', '検索に一致する添付はありません'));
    return;
  }
  for (const a of shown) {
    const m = mimeOf(a);
    const row = el('div', 'pkc-att-row');
    row.appendChild(el('span', 'pkc-att-icon', iconFor(m)));
    row.appendChild(el('span', 'pkc-att-name', a.filename ?? a.title));
    row.appendChild(el('span', 'pkc-att-meta', `${formatSize(a.asset_size)} · ${m || 'mime 不明'} · ${a.updated_at.slice(0, 10)}`));
    const v = viewerFor(m);
    if (v !== '') row.appendChild(el('span', 'pkc-att-viewer', `→ ${v}`));
    row.appendChild(
      button('開いてほしい', 'pkc-btn-small', () => {
        channel?.sendHint('open', a.lid);
        setStatus(`ヒント送信 — PKC2 側で「${a.title}」を「拡張へ送る」と実体が届きます`);
      }),
    );
    indexEl.appendChild(row);
  }
  indexEl.appendChild(el('div', 'pkc-hint', '実体は PKC2 側の送付ジェスチャで届きます(host-push — 取得 API はありません)'));
}

function onProjection(p: ContainerProjection): void {
  state.projection = p;
  renderIndex();
}

function onDeliver(d: DeliverPayload): void {
  if (!previewEl) return;
  if (d.kind === 'entry') {
    const box = el('div', 'pkc-att-preview');
    box.appendChild(el('div', 'pkc-panel-heading', `📄 entry ${d.lid ?? '(lid 不明)'} の body`));
    const pre = el('pre', 'pkc-att-text');
    pre.textContent = d.body ?? '(body なし)';
    box.appendChild(pre);
    previewEl.replaceChildren(box);
    setStatus(`📥 entry ${d.lid ?? ''} を受信`);
    return;
  }
  if (typeof d.data_base64 !== 'string') {
    setStatus('受信した deliver に実体(data_base64)がありません');
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  const mime = mimeOf({ mime: d.mime, filename: d.filename });
  previewEl.replaceChildren(previewBytes(d.filename ?? d.lid ?? '(無名)', mime, bytes));
  setStatus(`📥 ${d.filename ?? '(無名)'} を受信(PKC2 の送付ジェスチャ)`);
}

export function mountAttachmentBrowser(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-att-root';

  const header = el('div', 'pkc-att-header');
  header.setAttribute('data-pkc-region', 'att-header');
  header.appendChild(el('span', 'pkc-att-title', '📦 PKC2 Attachment Browser'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 添付索引 + MIME 別振分けハブ(オフライン)`));
  header.appendChild(helpButton('Attachment Browser', {
    what: 'PKC2 の全添付をメタデータ(名前・サイズ・種類)で一覧し、MIME に応じて推奨ビューア(F2/F6 など)へ振り分ける索引ハブです。画像とテキストはこのツール内でそのままプレビューできます。',
    how: [
      'PKC2 から起動すると添付の索引が出ます(検索・ソートで絞り込み)',
      '「開いてほしい」を押すと PKC2 側にヒントが出ます。実体は PKC2 側の「拡張へ送る」ジェスチャでのみ届きます(host-push)',
      '届いた実体: 画像/テキスト = インラインプレビュー、専用形式 = 推奨ビューアを案内、その他 = 保存',
      '単体起動でもローカルファイルを開いて同じプレビューが使えます',
    ],
    flow: [
      '既定で届くのは projection(メタデータのみ)— ファイル実体は含まれません',
      '実体はユーザーの送付ジェスチャの deliver でのみ届きます(拡張側から取得する API はありません)',
      '受信データの表示は textContent / blob <img> のみ — HTML としては描画しません',
    ],
    notes: [
      '専用ビューア(F2 メール / F6 PDF など)は別の単一 HTML ツールです — 該当形式は保存してそちらで開くか、PKC2 から該当ビューアを起動してください',
      'プレビューは 1 件ずつ(新しい受信で置き換わります)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection, onDeliver });
  const connected = channel.start();

  const toolbar = el('div', 'pkc-att-toolbar');
  toolbar.setAttribute('data-pkc-region', 'att-toolbar');
  const search = textInput('検索(名前 / mime)…');
  search.setAttribute('data-pkc-field', 'att-search');
  search.addEventListener('input', () => {
    state.query = search.value;
    renderIndex();
  });
  toolbar.appendChild(search);
  const sort = selectInput([
    { value: 'date', label: '更新が新しい順' },
    { value: 'name', label: '名前順' },
    { value: 'type', label: '種類順' },
    { value: 'size', label: 'サイズ順' },
  ]);
  sort.setAttribute('data-pkc-field', 'att-sort');
  sort.addEventListener('change', () => {
    state.sortKey = sort.value as SortKey;
    renderIndex();
  });
  toolbar.appendChild(sort);
  root.appendChild(toolbar);

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'att-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );
  root.appendChild(indexEl);

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'att-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.setAttribute('data-pkc-field', 'att-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => {
      const mime = (f.type || mimeOf({ filename: f.name })).toLowerCase();
      previewEl?.replaceChildren(previewBytes(f.name, mime, new Uint8Array(buf)));
      setStatus(`📂 ${f.name} を開きました(ローカル)`);
    });
  });
  open.appendChild(file);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'att-status');
  open.appendChild(statusEl);
  root.appendChild(open);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => {
      const mime = (f.type || mimeOf({ filename: f.name })).toLowerCase();
      previewEl?.replaceChildren(previewBytes(f.name, mime, new Uint8Array(buf)));
      setStatus(`📂 ${f.name} を開きました(ローカル)`);
    });
  });

  previewEl = el('div', 'pkc-panel');
  previewEl.setAttribute('data-pkc-region', 'att-preview');
  previewEl.appendChild(el('div', 'pkc-hint', '実体を受信(または ローカルファイルを開く)とここにプレビューされます'));
  root.appendChild(previewEl);

  return { channel };
}

const mountTarget = document.getElementById('att-root');
if (mountTarget) mountAttachmentBrowser(mountTarget);
