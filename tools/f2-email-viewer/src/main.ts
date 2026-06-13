/**
 * F2 email-viewer — .eml の整形表示 + T1 受動受信 (issue #60).
 *
 * 依存ゼロの MIME パーサ(./eml.ts)で本文・ヘッダ・添付を構造表示する。
 * **HTML メールは描画しない** — DOMParser(inert)でテキスト抽出して表示
 * (スクリプト・リモート画像・CSS は一切実行/取得されない)。
 * 入力は standalone(ファイル/D&D)と T1(pkc:deliver)の 2 経路。
 */

import '../../shared/base.css';
import './viewer.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, type FoldSection } from '../../shared/ui';
import { parseEml, type ParsedEml } from './eml';

const TOOL_NAME = 'pkc2-email-viewer';
const TOOL_VERSION = '0.1.0';

/** projection からメールらしい添付を抽出。Pure. */
export function pickEmlEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === 'message/rfc822' || /\.eml$/i.test(e.filename ?? '')),
  );
}

/** HTML パートから inert にテキストを抽出(描画しない)。 */
export function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    return (doc.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let mailEl: HTMLElement | null = null;
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

function renderMail(parsed: ParsedEml, label: string): void {
  if (!mailEl) return;
  mailEl.replaceChildren();

  const head = el('div', 'pkc-eml-head');
  head.setAttribute('data-pkc-region', 'eml-head');
  const rows: Array<[string, string]> = [
    ['Subject', parsed.subject || '(no subject)'],
    ['From', parsed.from],
    ['To', parsed.to],
    ...(parsed.cc !== '' ? ([['Cc', parsed.cc]] as Array<[string, string]>) : []),
    ['Date', parsed.date],
  ];
  for (const [k, v] of rows) {
    const row = el('div', 'pkc-eml-headrow');
    row.appendChild(el('span', 'pkc-eml-headkey', k));
    row.appendChild(el('span', 'pkc-eml-headval', v));
    head.appendChild(row);
  }
  const allHeaders = document.createElement('details');
  allHeaders.appendChild(el('summary', 'pkc-hint', `全ヘッダ(${parsed.headers.length})`));
  for (const [k, v] of parsed.headers) {
    allHeaders.appendChild(el('div', 'pkc-eml-rawheader', `${k}: ${v}`));
  }
  head.appendChild(allHeaders);
  mailEl.appendChild(head);

  // ---- 本文(text/plain 優先、HTML はテキスト抽出)
  const bodyText = parsed.text !== '' ? parsed.text : htmlToText(parsed.htmlSource);
  const body = el('pre', 'pkc-eml-body');
  body.setAttribute('data-pkc-region', 'eml-body');
  body.textContent = bodyText !== '' ? bodyText : '(本文なし)';
  mailEl.appendChild(body);
  if (parsed.text === '' && parsed.htmlSource !== '') {
    mailEl.appendChild(
      el('div', 'pkc-hint', 'HTML メールのためテキスト抽出表示です(スクリプト・リモート画像・CSS は実行/取得されません)'),
    );
  }

  // ---- 添付
  if (parsed.attachments.length > 0) {
    const att = el('div', 'pkc-eml-attachments');
    att.setAttribute('data-pkc-region', 'eml-attachments');
    att.appendChild(el('div', 'pkc-panel-heading', `📎 添付(${parsed.attachments.length})`));
    for (const a of parsed.attachments) {
      const row = el('div', 'pkc-eml-attrow');
      row.appendChild(el('span', 'pkc-eml-attname', `${a.filename}(${a.mime}、${(a.data.length / 1024).toFixed(1)} KB)`));
      row.appendChild(
        button('保存', 'pkc-btn-small', () => {
          const blob = new Blob([a.data.slice()], { type: a.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = a.filename.replace(/[\\/:*?"<>|]/g, '_');
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
      );
      att.appendChild(row);
    }
    mailEl.appendChild(att);
  }

  menuFold?.collapse();
  setStatus(`${label} を表示中`);
}

function loadBytes(bytes: Uint8Array, label: string): void {
  try {
    renderMail(parseEml(bytes), label);
  } catch (ex) {
    setStatus(`解析に失敗しました: ${ex instanceof Error ? ex.message : String(ex)}`);
  }
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体はメール asset ではありません');
    return;
  }
  const isEml = d.mime === 'message/rfc822' || /\.eml$/i.test(d.filename ?? '');
  if (!isEml) {
    setStatus(`受信した asset はメールではありません(mime=${d.mime ?? '?'})。.msg は非対応です`);
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  loadBytes(bytes, `✉️ ${d.filename ?? '(無名)'}(PKC2 から送付)`);
}

function renderIndex(p: ContainerProjection): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const emls = pickEmlEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📨 ${p.title} のメール添付(${emls.length} 件)`));
  if (emls.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'メール(.eml)の添付はありません'));
    return;
  }
  for (const e of emls) {
    const row = el('div', 'pkc-eml-indexrow');
    row.appendChild(el('span', 'pkc-eml-indextitle', e.filename ?? e.title));
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

export function mountEmailViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-eml-root';

  const header = el('div', 'pkc-eml-header');
  header.setAttribute('data-pkc-region', 'eml-header');
  header.appendChild(el('span', 'pkc-eml-title', '✉️ PKC2 Email Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — .eml を依存ゼロで整形表示(オフライン)`));
  header.appendChild(helpButton('Email Viewer', {
    what: '.eml ファイルを本文・ヘッダ・添付に分解して表示するオフラインビューアです。単体でも、PKC2 の添付ビューア(T1)としても動きます。',
    how: [
      '単体: .eml をファイル選択 or ドラッグ&ドロップ',
      'PKC2 連携: 起動するとメール添付の索引が出ます',
      'PKC2 側で対象を「拡張へ送る」と、ここに表示されます(host-push)',
      '添付は「保存」でファイルとして取り出せます',
    ],
    flow: [
      'MIME(multipart / base64 / quoted-printable / RFC2047 ヘッダ / charset)を依存ゼロのパーサで解析します',
      'HTML メールは描画せず inert なテキスト抽出表示 — スクリプト・リモート画像(トラッキングピクセル)・CSS は一切実行/取得されません',
    ],
    notes: [
      '.msg(Outlook バイナリ)と S/MIME 復号は非対応',
      'message/rfc822 の入れ子は添付としてそのまま保存できます',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection: renderIndex, onDeliver });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'eml-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'eml-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.eml,message/rfc822';
  file.setAttribute('data-pkc-field', 'eml-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `✉️ ${f.name}`));
  });
  open.appendChild(file);

  const menu = el('div', 'pkc-fold-stack');
  menu.appendChild(indexEl);
  menu.appendChild(open);
  menuFold = foldSection('📂 メニュー — PKC2 索引 / ファイルを開く', menu);
  root.appendChild(menuFold.el);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'eml-status');
  root.appendChild(statusEl);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), `✉️ ${f.name}`));
  });

  mailEl = el('div', 'pkc-paper pkc-eml-mail');
  mailEl.setAttribute('data-pkc-region', 'eml-mail');
  mailEl.appendChild(el('div', 'pkc-hint', '.eml を開くとここに表示されます'));
  root.appendChild(mailEl);

  return { channel };
}

const mountTarget = document.getElementById('eml-root');
if (mountTarget) mountEmailViewer(mountTarget);
