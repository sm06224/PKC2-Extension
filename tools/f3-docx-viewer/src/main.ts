/**
 * F3 docx-viewer — .docx の構造化テキスト表示 + T1 受動受信 (issue #61)。
 *
 * 依存ゼロ(shared/zip.ts + ./docx.ts)で見出し・段落・箇条書き・表を
 * DOM 構築(textContent のみ)で表示する。HTML 変換ライブラリ(mammoth 等)は
 * 不採用 — runtime データを HTML として描画しない規律に合わせる。
 * 入力は standalone(ファイル/D&D)と T1(pkc:deliver)の 2 経路。
 */

import '../../shared/base.css';
import './viewer.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, type FoldSection } from '../../shared/ui';
import { charCount, parseDocx, type DocxBlock } from './docx';

const TOOL_NAME = 'pkc2-docx-viewer';
const TOOL_VERSION = '0.1.0';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** projection から docx らしい添付を抽出。Pure. */
export function pickDocxEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === MIME_DOCX || /\.docx$/i.test(e.filename ?? '')),
  );
}

/** ブロック列 → DOM(textContent のみ)。Pure-ish(DOM 生成)。 */
export function renderBlocks(blocks: DocxBlock[]): HTMLElement {
  const box = el('div', 'pkc-docx-doc');
  box.setAttribute('data-pkc-region', 'docx-doc');
  for (const b of blocks) {
    if (b.kind === 'heading') {
      box.appendChild(el('div', `pkc-docx-h pkc-docx-h${b.level}`, b.text));
    } else if (b.kind === 'list') {
      box.appendChild(el('div', 'pkc-docx-li', `• ${b.text}`));
    } else if (b.kind === 'table') {
      const table = document.createElement('table');
      table.className = 'pkc-docx-table';
      for (const r of b.rows) {
        const tr = document.createElement('tr');
        for (const c of r) {
          const td = document.createElement('td');
          td.textContent = c;
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      box.appendChild(table);
    } else {
      box.appendChild(el('div', 'pkc-docx-p', b.text));
    }
  }
  return box;
}

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let docEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let menuFold: FoldSection | null = null;

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
  void parseDocx(bytes).then((blocks) => {
    if (!docEl) return;
    if (!blocks) {
      setStatus('docx として解析できませんでした(.doc 旧形式は非対応です)');
      return;
    }
    docEl.replaceChildren();
    docEl.appendChild(el('div', 'pkc-panel-heading', `📃 ${label}(${blocks.length} ブロック / 約 ${charCount(blocks)} 字)`));
    docEl.appendChild(renderBlocks(blocks));
    menuFold?.collapse();
    setStatus(`${label} を表示中`);
  });
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体は docx asset ではありません');
    return;
  }
  const isDocx = d.mime === MIME_DOCX || /\.docx$/i.test(d.filename ?? '');
  if (!isDocx) {
    setStatus(`受信した asset は docx ではありません(mime=${d.mime ?? '?'})`);
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
  const items = pickDocxEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📃 ${p.title} の Word 添付(${items.length} 件)`));
  if (items.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'Word(.docx)の添付はありません'));
    return;
  }
  for (const e of items) {
    const row = el('div', 'pkc-docx-indexrow');
    row.appendChild(el('span', 'pkc-docx-indextitle', e.filename ?? e.title));
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

export function mountDocxViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-docx-root';

  const header = el('div', 'pkc-docx-header');
  header.setAttribute('data-pkc-region', 'docx-header');
  header.appendChild(el('span', 'pkc-docx-title', '📃 PKC2 DOCX Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — .docx を依存ゼロで構造表示(オフライン)`));
  header.appendChild(helpButton('DOCX Viewer', {
    what: '.docx(Word)を見出し・段落・箇条書き・表の構造で表示するオフラインビューアです。単体でも、PKC2 の添付ビューア(T1)としても動きます。',
    how: [
      '単体: .docx をファイル選択 or ドラッグ&ドロップ',
      'PKC2 連携: 起動すると Word 添付の索引が出ます',
      'PKC2 側で対象を「拡張へ送る」と、ここに表示されます(host-push)',
    ],
    flow: [
      'ZIP(DecompressionStream)+ XML(DOMParser)の依存ゼロ実装で、外部ライブラリを同梱しません',
      'テキスト構造のみを抽出して textContent で表示します — マクロ・埋め込みオブジェクトは実行されません',
    ],
    notes: [
      '文字装飾・画像・ヘッダフッタ・脚注は対象外(テキスト構造のみ)',
      '変更履歴は「削除」を除外した本文を表示します',
      '.doc(旧バイナリ形式)は非対応',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection: renderIndex, onDeliver });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'docx-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'docx-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = `.docx,${MIME_DOCX}`;
  file.setAttribute('data-pkc-field', 'docx-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), f.name));
  });
  open.appendChild(file);

  const menu = el('div', 'pkc-fold-stack');
  menu.appendChild(indexEl);
  menu.appendChild(open);
  menuFold = foldSection('📂 メニュー — PKC2 索引 / ファイルを開く', menu);
  root.appendChild(menuFold.el);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'docx-status');
  root.appendChild(statusEl);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), f.name));
  });

  docEl = el('div', 'pkc-paper pkc-docx-view');
  docEl.setAttribute('data-pkc-region', 'docx-view');
  docEl.appendChild(el('div', 'pkc-hint', '.docx を開くとここに表示されます'));
  root.appendChild(docEl);

  return { channel };
}

const mountTarget = document.getElementById('docx-root');
if (mountTarget) mountDocxViewer(mountTarget);
