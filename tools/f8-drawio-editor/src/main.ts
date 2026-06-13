/**
 * F8 drawio-editor — .drawio の XML ソース編集 + 簡易 SVG プレビュー (issue #66)。
 *
 * draw.io 本体(~10MB)は同梱不可のため、**編集の正は XML ソース**とし、
 * プレビューは頂点/辺の構造確認用の簡易 SVG に割り切る(計画 doc の
 * ビジュアル編集 1000-1500 行案は採らない)。圧縮保存(base64+deflate)の
 * .drawio も読める。保存は非圧縮 mxfile(draw.io でそのまま開ける)。
 * 入力は standalone(ファイル/D&D)と T1(pkc:deliver)の 2 経路。
 */

import '../../shared/base.css';
import './editor.css';
import { ExtChannel, type ContainerProjection, type DeliverPayload, type ProjectionEntry } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, type FoldSection } from '../../shared/ui';
import { cellsToSvg, extractPages, parseMxGraph, wrapMxfile, type DrawioPage } from './drawio';

const TOOL_NAME = 'pkc2-drawio-editor';
const TOOL_VERSION = '0.1.0';

const MIME_DRAWIO = 'application/vnd.jgraph.mxfile';

/** projection から drawio らしい添付を抽出。Pure. */
export function pickDrawioEntries(p: ContainerProjection): ProjectionEntry[] {
  return p.entries.filter(
    (e) =>
      e.archetype === 'attachment'
      && (e.mime === MIME_DRAWIO || /\.(drawio|dio)$/i.test(e.filename ?? '')),
  );
}

let channel: ExtChannel | null = null;
let indexEl: HTMLElement | null = null;
let editorEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let menuFold: FoldSection | null = null;

interface EditState {
  pages: DrawioPage[];
  active: number;
  label: string;
}

let state: EditState | null = null;
let previewTimer: number | null = null;

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

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderPreview(box: HTMLElement, xml: string): void {
  box.replaceChildren();
  const cells = parseMxGraph(xml);
  if (!cells) {
    box.appendChild(el('div', 'pkc-form-error', 'XML を mxGraphModel として解析できません'));
    return;
  }
  const vertexCount = cells.filter((c) => c.vertex).length;
  const edgeCount = cells.filter((c) => c.edge).length;
  box.appendChild(el('div', 'pkc-hint', `頂点 ${vertexCount} / 辺 ${edgeCount}(簡易プレビュー — 正確な描画は draw.io で)`));
  box.appendChild(cellsToSvg(cells));
}

function renderEditor(): void {
  if (!editorEl || !state) return;
  const s = state;
  editorEl.replaceChildren();
  editorEl.appendChild(el('div', 'pkc-panel-heading', `📐 ${s.label}(${s.pages.length} ページ)`));

  if (s.pages.length > 1) {
    const tabs = el('div', 'pkc-drawio-tabs');
    for (let i = 0; i < s.pages.length; i++) {
      tabs.appendChild(
        button(s.pages[i]!.name, i === s.active ? 'pkc-btn-small pkc-drawio-tab-active' : 'pkc-btn-small', () => {
          s.active = i;
          renderEditor();
        }),
      );
    }
    editorEl.appendChild(tabs);
  }

  const split = el('div', 'pkc-drawio-split');
  const ta = document.createElement('textarea');
  ta.className = 'pkc-drawio-source';
  ta.setAttribute('data-pkc-field', 'drawio-source');
  ta.value = s.pages[s.active]!.xml;
  ta.spellcheck = false;
  split.appendChild(ta);

  const preview = el('div', 'pkc-drawio-preview');
  preview.setAttribute('data-pkc-region', 'drawio-preview');
  split.appendChild(preview);
  editorEl.appendChild(split);

  ta.addEventListener('input', () => {
    s.pages[s.active]!.xml = ta.value;
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => renderPreview(preview, ta.value), 400);
  });

  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(button('💾 .drawio 保存(非圧縮)', 'pkc-btn-small', () => {
    download('diagram.drawio', wrapMxfile(s.pages), 'application/xml');
  }));
  bar.appendChild(button('💾 プレビュー SVG 保存', 'pkc-btn-small', () => {
    const svg = preview.querySelector('svg');
    if (!svg) {
      setStatus('プレビューがありません');
      return;
    }
    download('diagram-preview.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  }));
  editorEl.appendChild(bar);

  renderPreview(preview, ta.value);
}

function loadText(text: string, label: string): void {
  void extractPages(text).then((pages) => {
    if (!pages) {
      setStatus('drawio ファイルとして解析できませんでした');
      return;
    }
    state = { pages, active: 0, label };
    renderEditor();
    menuFold?.collapse();
    setStatus(`${label} を編集中`);
  });
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'asset' || typeof d.data_base64 !== 'string') {
    setStatus('受信した実体は drawio asset ではありません');
    return;
  }
  const looksDrawio = d.mime === MIME_DRAWIO || /\.(drawio|dio|xml)$/i.test(d.filename ?? '');
  if (!looksDrawio) {
    setStatus(`受信した asset は drawio ではありません(mime=${d.mime ?? '?'})`);
    return;
  }
  const bytes = base64ToBytes(d.data_base64);
  if (!bytes) {
    setStatus('base64 デコードに失敗しました');
    return;
  }
  loadText(new TextDecoder('utf-8', { fatal: false }).decode(bytes), `${d.filename ?? '(無名)'}(PKC2 から送付)`);
}

function renderIndex(p: ContainerProjection): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const items = pickDrawioEntries(p);
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📐 ${p.title} の drawio 添付(${items.length} 件)`));
  if (items.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', 'drawio(.drawio / .dio)の添付はありません'));
    return;
  }
  for (const e of items) {
    const row = el('div', 'pkc-drawio-indexrow');
    row.appendChild(el('span', 'pkc-drawio-indextitle', e.filename ?? e.title));
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

const STARTER = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="開始" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="50" as="geometry"/>
    </mxCell>
    <mxCell id="3" value="次へ" style="ellipse;fillColor=#d5e8d4;strokeColor=#82b366" vertex="1" parent="1">
      <mxGeometry x="240" y="140" width="120" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="4" value="flow" style="strokeColor=#6a705e" edge="1" parent="1" source="2" target="3"/>
  </root>
</mxGraphModel>`;

export function mountDrawioEditor(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pkc-drawio-root';

  const header = el('div', 'pkc-drawio-header');
  header.setAttribute('data-pkc-region', 'drawio-header');
  header.appendChild(el('span', 'pkc-drawio-title', '📐 PKC2 Drawio Editor'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — .drawio の XML 編集 + 簡易プレビュー(オフライン)`));
  header.appendChild(helpButton('Drawio Editor', {
    what: '.drawio(draw.io / diagrams.net)ファイルの XML ソースを直接編集し、簡易 SVG プレビューで構造を確認するオフラインツールです。圧縮保存された .drawio も読めます。',
    how: [
      '単体: .drawio をファイル選択 or ドラッグ&ドロップ(「サンプルから開始」も可)',
      'PKC2 連携: 起動すると drawio 添付の索引が出ます。PKC2 側の「拡張へ送る」で届きます(host-push)',
      '左の XML を編集すると右のプレビューが更新されます',
      '「.drawio 保存」は非圧縮 mxfile — draw.io でそのまま開けます',
    ],
    flow: [
      '圧縮 diagram(base64 + deflate)は DecompressionStream でローカル展開します',
      'プレビューは頂点(rect/ellipse)と辺(直線)だけの簡易描画 — ラベルはタグ除去したテキストのみ、色は #hex のみ通します',
    ],
    notes: [
      'draw.io の全シェイプ・ルーティング・スタイルは再現しません(構造確認用)',
      'ビジュアル編集(ドラッグ配置)は非対応 — 編集の正は XML ソースです',
    ],
    connection: false,
  }));
  root.appendChild(header);

  channel = new ExtChannel({ onProjection: renderIndex, onDeliver });
  const connected = channel.start();

  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'drawio-index');
  indexEl.appendChild(
    el('div', 'pkc-hint', connected ? 'PKC2 に接続しました — projection 待機中…' : 'standalone 起動(PKC2 から起動すると添付の索引が出ます)'),
  );

  const open = el('div', 'pkc-panel');
  open.setAttribute('data-pkc-region', 'drawio-open');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.drawio,.dio,.xml';
  file.setAttribute('data-pkc-field', 'drawio-file');
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => loadText(text, f.name));
  });
  open.appendChild(file);
  open.appendChild(button('サンプルから開始', 'pkc-btn-small', () => loadText(STARTER, '新規ダイアグラム')));

  const menu = el('div', 'pkc-fold-stack');
  menu.appendChild(indexEl);
  menu.appendChild(open);
  menuFold = foldSection('📂 メニュー — PKC2 索引 / ファイルを開く', menu);
  root.appendChild(menuFold.el);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'drawio-status');
  root.appendChild(statusEl);

  root.addEventListener('dragover', (ev) => ev.preventDefault());
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) void f.text().then((text) => loadText(text, f.name));
  });

  editorEl = el('div', 'pkc-panel pkc-drawio-editor');
  editorEl.setAttribute('data-pkc-region', 'drawio-editor');
  editorEl.appendChild(el('div', 'pkc-hint', '.drawio を開く(またはサンプルから開始)とここに表示されます'));
  root.appendChild(editorEl);

  return { channel };
}

const mountTarget = document.getElementById('drawio-root');
if (mountTarget) mountDrawioEditor(mountTarget);
