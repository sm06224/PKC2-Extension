/**
 * F4 pptx-viewer — .pptx のテキストアウトライン表示 + T1 受動受信 (issue #62)。
 *
 * 依存ゼロ(shared/zip.ts + ./pptx.ts)でスライドごとのタイトル・本文テキストを
 * 縦に並べて表示する(textContent のみ、図形・画像は対象外)。
 * 入力は standalone(ファイル/D&D)と T1(pkc:deliver)の 2 経路。
 */

import '../../shared/base.css';
import './viewer.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el } from '../../shared/ui';
import { parsePptx, type PptxSlide } from './pptx';

const TOOL_NAME = 'pkc2-pptx-viewer';
const TOOL_VERSION = '0.1.0';

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** projection から pptx らしい添付を抽出。Pure. */
export function pickPptxEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === MIME_PPTX || /\.pptx$/i.test(e.filename ?? '')),
  );
}

/** スライド列 → DOM(textContent のみ)。Pure-ish(DOM 生成)。 */
export function renderSlides(slides: PptxSlide[]): HTMLElement {
  const box = el('div', 'pkc-pptx-deck');
  box.setAttribute('data-pkc-region', 'pptx-deck');
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]!;
    const card = el('div', 'pkc-pptx-slide');
    card.appendChild(el('div', 'pkc-pptx-slideno', `スライド ${i + 1} / ${slides.length}`));
    if (s.title !== '') card.appendChild(el('div', 'pkc-pptx-slidetitle', s.title));
    for (const line of s.lines) card.appendChild(el('div', 'pkc-pptx-line', line));
    if (s.title === '' && s.lines.length === 0) {
      card.appendChild(el('div', 'pkc-hint', '(テキストなし — 図形・画像のみのスライド)'));
    }
    box.appendChild(card);
  }
  return box;
}

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let deckEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

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

function loadBytes(bytes: Uint8Array, label: string): void {
  void parsePptx(bytes).then((slides) => {
    if (!deckEl) return;
    if (!slides) {
      setStatus('pptx として解析できませんでした(.ppt 旧形式は非対応です)');
      return;
    }
    deckEl.replaceChildren();
    deckEl.appendChild(el('div', 'pkc-panel-heading', `📊 ${label}(${slides.length} スライド)`));
    deckEl.appendChild(renderSlides(slides));
    setStatus(`${label} を表示中`);
  });
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体は pptx asset ではありません');
    return;
  }
  const isPptx = d.mime === MIME_PPTX || /\.pptx$/i.test(d.filename ?? '');
  if (!isPptx) {
    setStatus(`受信した asset は pptx ではありません(mime=${d.mime ?? '?'})`);
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  loadBytes(bytes, `${d.filename ?? '(無名)'}(PKC2 から送付)`);
}

function renderIndex(p: ContainerProjection): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const items = pickPptxEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📊 ${p.title} の PowerPoint 添付(${items.length} 件)`));
  if (items.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'PowerPoint(.pptx)の添付はありません'));
    return;
  }
  for (const e of items) {
    const row = el('div', 'pkc-pptx-indexrow');
    row.appendChild(el('span', 'pkc-pptx-indextitle', e.filename ?? e.title));
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

export function mountPptxViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-pptx-root';

  const header = el('div', 'pkc-pptx-header');
  header.setAttribute('data-pkc-region', 'pptx-header');
  header.appendChild(el('span', 'pkc-pptx-title', '📊 PKC2 PPTX Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — .pptx をテキストアウトラインで表示(オフライン)`));
  header.appendChild(helpButton('PPTX Viewer', {
    what: '.pptx(PowerPoint)をスライドごとのテキストアウトラインで表示するオフラインビューアです。単体でも、PKC2 の添付ビューア(T1)としても動きます。',
    how: [
      '単体: .pptx をファイル選択 or ドラッグ&ドロップ',
      'PKC2 連携: 起動すると PowerPoint 添付の索引が出ます',
      'PKC2 側で対象を「拡張へ送る」と、ここに表示されます(host-push)',
    ],
    flow: [
      'ZIP(DecompressionStream)+ XML(DOMParser)の依存ゼロ実装で、外部ライブラリを同梱しません',
      'スライドのタイトル・本文・表のテキストのみを textContent で表示します — マクロ・埋め込みオブジェクトは実行されません',
    ],
    notes: [
      '図形の描画・画像・レイアウト・アニメーション・スピーカーノートは対象外(テキストのみ)',
      '.ppt(旧バイナリ形式)は非対応',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection: renderIndex, onDeliver });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'pptx-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );
  root.appendChild(indexEl);

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'pptx-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = `.pptx,${MIME_PPTX}`;
  file.setAttribute('data-pkc-field', 'pptx-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), f.name));
  });
  open.appendChild(file);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'pptx-status');
  open.appendChild(statusEl);
  root.appendChild(open);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), f.name));
  });

  deckEl = el('div', 'pkc-panel pkc-pptx-view');
  deckEl.setAttribute('data-pkc-region', 'pptx-view');
  deckEl.appendChild(el('div', 'pkc-hint', '.pptx を開くとここに表示されます'));
  root.appendChild(deckEl);

  return { channel };
}

const mountTarget = document.getElementById('pptx-root');
if (mountTarget) mountPptxViewer(mountTarget);
