/**
 * F11 premium-markdown-viewer — ホスト renderer 借用の美麗 Markdown 描画
 * (issue: F11 / SR-18 / PKC2 #849)。
 *
 * 狙い: PKC-Markdown エンジンを **複製せず**、ホストのレンダリングコア + base.css を
 * `render-request` / `render-result` / `stylesheet`(capability `core-render`、SR-18)で
 * **借りて**描画する。これにより複製の 3 負債(drift / asset / CSS)を構造的に回避する。
 *
 * 本ツールは SR-18 の **実証プロトタイプ**。ホスト側の render service は go 待ち
 * (未実装)なので、render-result が来ない場合は **ローカル簡易フォールバック**
 * (`md-fallback`)に degrade し、banner で明示する。「🧪 ホスト描画をシミュレート」
 * ボタンで、借用フロー(借りた CSS を当てて描く第 4 surface)を host 不在でも可視化する。
 *
 * セキュリティ: ホスト/フォールバックいずれの HTML も **sandboxed iframe(no scripts)**
 * の srcdoc に流す。自分の live DOM へ innerHTML しない(repo 規律 #1 + PKC2 #849 §5 の
 * 多層防御)。受信で動作を変えない / 外部通信なし / eval なし。
 */

import '../../shared/base.css';
import './viewer.css';
import {
  ExtChannel,
  CAP_CORE_RENDER,
  type ContainerProjection,
  type DeliverPayload,
  type ProjectionEntry,
  type RenderResult,
  type StylesheetPayload,
} from '../../shared/ext-channel';
import { renderMarkdownFallback } from '../../shared/md-fallback';
import { helpButton } from '../../shared/help';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-premium-markdown-viewer';
const TOOL_VERSION = '0.1.0';

/** ホスト不在時にフォールバック描画へ落ちるまでの待ち時間(render-result 不達の判定)。 */
const RENDER_TIMEOUT_MS = 1200;
/** 編集中のライブプレビュー debounce。 */
const DEBOUNCE_MS = 350;

/** このツールが描画対象にする(markdown 想定の)archetype。 */
const TEXT_ARCHETYPES = new Set(['text', 'textlog', 'generic']);

/* ----------------------------------------------------- iframe document CSS */

/** フォールバック描画用の最小可読スタイル(借用 CSS が無い時の既定)。 */
const DEFAULT_DOC_CSS = `
  :root { color-scheme: light; }
  body { font: 16px/1.65 -apple-system, system-ui, "Segoe UI", sans-serif; color: #1b1f24; margin: 1.2rem 1.4rem; }
  h1,h2,h3 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  h1 { font-size: 1.7rem; border-bottom: 1px solid #e2e4e8; padding-bottom: .2em; }
  h2 { font-size: 1.35rem; }
  code { background: #f0f1f3; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  pre { background: #f6f8fa; padding: .8rem; border-radius: 6px; overflow:auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d0d3d8; margin: .8em 0; padding: .1em 1em; color: #57606a; }
  a { color: #0969da; }
  ul,ol { padding-left: 1.4em; }
`;

/** 「premium」上乗せ(借りた構造の上に独自タイポグラフィを被せる = 本ツールの主目的)。 */
const PREMIUM_OVERLAY_CSS = `
  body { max-width: 46rem; margin: 2rem auto; font-size: 17px; }
  h1,h2,h3 { font-family: Georgia, "Times New Roman", serif; letter-spacing: -0.01em; }
  h1 { text-align: center; border: 0; }
  h2 { border-bottom: 1px solid #ececec; padding-bottom: .15em; }
  p { margin: 0 0 1.05em; }
  blockquote { font-style: italic; }
`;

/** デモ用「ホスト base.css のつもり」のスタイル。借用で見た目が変わることを可視化。 */
const DEMO_BORROWED_CSS = `
  :root { color-scheme: light; }
  body { font: 15px/1.7 ui-sans-serif, system-ui, sans-serif; color: #24292f; margin: 1.4rem; background: #fffefb; }
  h1,h2,h3 { color: #0d4429; }
  h1 { font-size: 1.8rem; border-bottom: 2px solid #2da44e; padding-bottom: .25em; }
  code { background: #eef6ef; color: #0d4429; padding: .1em .35em; border-radius: 4px; }
  pre { background: #0d1117; color: #e6edf3; padding: .8rem; border-radius: 6px; overflow:auto; }
  pre code { background: none; color: inherit; }
  blockquote { border-left: 4px solid #2da44e; margin:.8em 0; padding:.1em 1em; color:#444; }
  a { color: #1a7f37; }
`;

/* ----------------------------------------------------- runtime state */

interface PmdState {
  projection: ContainerProjection | null;
  /** ホストから貸与された base.css(SR-18 stylesheet)。 */
  borrowedCss: string | null;
  hostEngineVersion: string | null;
  premium: boolean;
  /** 直近に描いた HTML / どちらの経路で描いたか(premium トグル再適用に使う)。 */
  lastHtml: string;
  lastMode: 'host' | 'fallback' | 'demo';
  /** 進行中 render-request の correlation_id(古い結果を無視するため)。 */
  pendingCorrelation: string | null;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  source: string;
}

const state: PmdState = {
  projection: null,
  borrowedCss: null,
  hostEngineVersion: null,
  premium: true,
  lastHtml: '',
  lastMode: 'fallback',
  pendingCorrelation: null,
  fallbackTimer: null,
  debounceTimer: null,
  source: '',
};

let channel: ExtChannel | null = null;
let editorEl: HTMLTextAreaElement | null = null;
let frameEl: HTMLIFrameElement | null = null;
let engineEl: HTMLElement | null = null;
let bannerEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let indexEl: HTMLElement | null = null;

let correlationSeq = 0;
function nextCorrelation(): string {
  correlationSeq += 1;
  return `pmd-${Date.now()}-${correlationSeq}`;
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* ----------------------------------------------------- preview (pure-ish) */

/** srcdoc 文字列を組み立てる。Pure(文字列 in → 文字列 out)。テスト可能。 */
export function buildPreviewDoc(html: string, css: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>' + css + '</style></head><body>' + html + '</body></html>'
  );
}

/** 経路(host = 借用 CSS / fallback = 既定 CSS)に応じて使う doc CSS を選ぶ。Pure。 */
export function pickDocCss(
  mode: 'host' | 'fallback' | 'demo',
  borrowedCss: string | null,
  premium: boolean,
): string {
  let base: string;
  if (mode === 'demo') base = DEMO_BORROWED_CSS;
  else if (mode === 'host' && borrowedCss) base = borrowedCss;
  else base = DEFAULT_DOC_CSS;
  return premium ? base + '\n' + PREMIUM_OVERLAY_CSS : base;
}

function applyRender(html: string, mode: 'host' | 'fallback' | 'demo', engineVersion: string | null): void {
  state.lastHtml = html;
  state.lastMode = mode;
  if (!frameEl) return;
  const css = pickDocCss(mode, state.borrowedCss, state.premium);
  // sandbox="" → スクリプト無効。借りた / フォールバック HTML を隔離描画(第 4 surface)。
  frameEl.srcdoc = buildPreviewDoc(html, css);
  if (engineEl) {
    if (mode === 'host') {
      engineEl.textContent = `engine: host ${engineVersion ?? '?'}（借用 ✓）`;
      engineEl.setAttribute('data-pmd-mode', 'host');
    } else if (mode === 'demo') {
      engineEl.textContent = `engine: シミュレート ${engineVersion ?? ''}（借用デモ）`;
      engineEl.setAttribute('data-pmd-mode', 'host');
    } else {
      engineEl.textContent = 'engine: local fallback（ホスト未提供 → 簡易描画）';
      engineEl.setAttribute('data-pmd-mode', 'fallback');
    }
  }
}

function showBanner(text: string | null): void {
  if (!bannerEl) return;
  if (text === null) {
    bannerEl.hidden = true;
  } else {
    bannerEl.textContent = text;
    bannerEl.hidden = false;
  }
}

function doFallback(source: string): void {
  applyRender(renderMarkdownFallback(source), 'fallback', null);
}

/** ソースの描画を要求。host があれば render-request、無ければ即フォールバック。 */
function requestRender(source: string): void {
  state.source = source;
  if (state.fallbackTimer !== null) {
    clearTimeout(state.fallbackTimer);
    state.fallbackTimer = null;
  }
  if (channel && channel.isEstablished()) {
    const cid = nextCorrelation();
    state.pendingCorrelation = cid;
    const sent = channel.sendRenderRequest(source, cid, { surface: 'reader', toc: true }, false);
    if (sent) {
      setStatus('render-request 送信 — ホストの core-render 応答待ち…');
      // 応答が無ければ(host が core-render 未対応)フォールバックへ degrade。
      state.fallbackTimer = setTimeout(() => {
        state.fallbackTimer = null;
        if (state.pendingCorrelation === cid) {
          state.pendingCorrelation = null;
          showBanner('ホストの描画サービス(core-render / SR-18)が応答しません。ローカル簡易描画に切り替えました。');
          doFallback(source);
          setStatus('フォールバック描画(ホスト未提供)');
        }
      }, RENDER_TIMEOUT_MS);
      return;
    }
  }
  // host 不在 = standalone
  state.pendingCorrelation = null;
  showBanner('standalone(ホスト未接続)。ローカル簡易描画です。ホスト借用は PKC2 から起動 + SR-18 実装後に有効化されます。');
  doFallback(source);
}

/** 入力 debounce 付き再描画。 */
function scheduleRender(source: string): void {
  state.source = source;
  if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    requestRender(source);
  }, DEBOUNCE_MS);
}

/* ----------------------------------------------------- channel callbacks */

function onProjection(p: ContainerProjection): void {
  state.projection = p;
  renderIndex();
}

function onStylesheet(s: StylesheetPayload): void {
  state.borrowedCss = s.css;
  state.hostEngineVersion = s.engineVersion;
  setStatus(`ホストから base.css を借用(engine ${s.engineVersion || '?'})`);
  // 既に host モードで描いているなら借りた CSS を即反映。
  if (state.lastMode === 'host') applyRender(state.lastHtml, 'host', state.hostEngineVersion);
}

function onRenderResult(r: RenderResult): void {
  if (state.pendingCorrelation === null || r.correlationId !== state.pendingCorrelation) return;
  state.pendingCorrelation = null;
  if (state.fallbackTimer !== null) {
    clearTimeout(state.fallbackTimer);
    state.fallbackTimer = null;
  }
  if (r.ok && typeof r.html === 'string') {
    if (typeof r.css === 'string' && r.css !== '') state.borrowedCss = r.css;
    state.hostEngineVersion = r.engineVersion || state.hostEngineVersion;
    showBanner(null);
    applyRender(r.html, 'host', state.hostEngineVersion);
    setStatus('ホスト core-render で描画(複製ゼロ・借用 CSS)');
  } else {
    showBanner(`ホストの描画に失敗: ${r.reason ?? '理由不明'}。ローカル簡易描画に切り替えました。`);
    doFallback(state.source);
  }
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'entry' || typeof d.body !== 'string') {
    setStatus('受信した deliver に entry body がありません(このツールはテキスト本文を描画します)');
    return;
  }
  if (editorEl) editorEl.value = d.body;
  setStatus(`📥 entry ${d.lid ?? ''} を受信 — 描画します`);
  requestRender(d.body);
}

/* ----------------------------------------------------- index UI */

function renderIndex(): void {
  if (!indexEl) return;
  indexEl.replaceChildren();
  const p = state.projection;
  if (!p) {
    indexEl.appendChild(el('div', 'pkc-hint', 'PKC2 からの projection 待機中…'));
    return;
  }
  const texts = p.entries.filter((e: ProjectionEntry) => TEXT_ARCHETYPES.has(e.archetype));
  indexEl.appendChild(el('div', 'pkc-panel-heading', `📝 テキスト系 entry(${texts.length} 件)`));
  if (texts.length === 0) {
    indexEl.appendChild(el('div', 'pkc-hint', '描画できるテキスト系 entry はありません'));
    return;
  }
  for (const e of texts) {
    const row = el('div', 'pmd-index-row');
    row.appendChild(el('span', 'pmd-index-name', e.title || '(無題)'));
    row.appendChild(el('span', 'pmd-index-arch', e.archetype));
    row.appendChild(
      button('送ってほしい', 'pkc-btn-small', () => {
        channel?.sendHint('open', e.lid);
        setStatus(`ヒント送信 — PKC2 側で「${e.title}」を「拡張へ送る」と本文が届きます(host-push)`);
      }),
    );
    indexEl.appendChild(row);
  }
  indexEl.appendChild(el('div', 'pkc-hint', '本文実体は PKC2 側の送付ジェスチャ(deliver)でのみ届きます。'));
}

/* ----------------------------------------------------- demo (host 不在の可視化) */

const DEMO_SOURCE = [
  '# プレミアム Markdown ビューア',
  '',
  'これは **ホストの描画コアを借用** するデモです。エンジンは *複製しません*。',
  '',
  '## なぜ借りるのか',
  '',
  '- drift しない(常にホスト現行版)',
  '- `asset:KEY` はホストが解決(consent 維持)',
  '- base.css を `stylesheet` で借用 → 第 4 surface でも視覚一致',
  '',
  '> 借りた構造の上に独自 CSS を被せれば「もっと綺麗」にできる。',
  '',
  '```',
  'render-request → render-result(html + css)',
  '```',
  '',
  '詳細は [SR-18](https://github.com/sm06224/PKC2-Extension) を参照。',
].join('\n');

function simulateHostRender(): void {
  const source = state.source || DEMO_SOURCE;
  if (editorEl && editorEl.value.trim() === '') editorEl.value = source;
  // 実ホスト未実装のため、render-result 相当を合成して借用フローを可視化する。
  // (HTML はフォールバックエンジンで近似。本番はホストの PKC-Markdown が返す。)
  showBanner('🧪 シミュレーション: ホストの render-result + 借用 base.css を合成しています(実際の core-render は SR-18 実装後)。');
  applyRender(renderMarkdownFallback(source), 'demo', 'demo-1.4.2');
  setStatus('🧪 借用フローのシミュレート(host base.css を当てて描画)');
}

/* ----------------------------------------------------- mount */

export function mountPremiumMarkdownViewer(root: HTMLElement): { channel: ExtChannel } {
  root.replaceChildren();
  root.className = 'pmd-root';

  const header = el('div', 'pmd-header');
  header.setAttribute('data-pkc-region', 'pmd-header');
  header.appendChild(el('span', 'pmd-title', '✨ Premium Markdown Viewer'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — ホスト renderer 借用(エンジン非同梱)`));
  header.appendChild(
    helpButton('Premium Markdown Viewer', {
      what: 'テキスト系 entry を、ホスト(PKC2)の PKC-Markdown レンダリングコアを借りて綺麗に描画するビューア/エディタです。エンジンを複製せず、借りた base.css の上に独自スタイルを被せて美麗化します(SR-18 / PKC2 #849 の実証ツール)。',
      how: [
        'PKC2 から起動するとテキスト系 entry の索引が出ます。「送ってほしい」で PKC2 側の送付ジェスチャを促し、届いた本文を描画します(host-push)',
        '左ペインでソースを編集すると、右ペインがライブ更新します',
        'ホストが core-render(SR-18)に対応していれば借用描画、未対応ならローカル簡易描画に degrade します',
        '「🧪 ホスト描画をシミュレート」で、ホスト不在でも借用フロー(借りた CSS を当てる)を確認できます',
      ],
      flow: [
        'render-request(ソース)→ host → render-result(html + css)。実体は拡張が既に持つ本文のみ(新規開示なし)',
        '未配送の asset:KEY は broken-ref(consent 維持。実体は別途送付ジェスチャで)',
        'host / フォールバックいずれの HTML も sandboxed iframe(スクリプト無効)で隔離描画します',
      ],
      notes: [
        'ホスト側の render service は実装 go 待ち(PKC2 #849)。それまではフォールバック描画で standalone 動作します',
        'WYSIWYG 双方向編集は非対応(ソース編集 + ライブプレビュー)',
      ],
      connection: false,
    }),
  );
  root.appendChild(header);

  // capability core-render を申告して接続(SR-18)。
  channel = new ExtChannel(
    { onProjection, onDeliver, onRenderResult, onStylesheet },
    { capabilities: [CAP_CORE_RENDER] },
  );
  const connected = channel.start();

  const toolbar = el('div', 'pmd-toolbar');
  toolbar.setAttribute('data-pkc-region', 'pmd-toolbar');
  const premiumBtn = button(
    'premium CSS: ON',
    'pkc-btn-small',
    () => {
      state.premium = !state.premium;
      premiumBtn.textContent = `premium CSS: ${state.premium ? 'ON' : 'OFF'}`;
      applyRender(state.lastHtml, state.lastMode, state.hostEngineVersion);
    },
    '借りた構造の上に独自タイポグラフィを被せる',
  );
  toolbar.appendChild(premiumBtn);
  toolbar.appendChild(button('🧪 ホスト描画をシミュレート', 'pkc-btn-small', simulateHostRender));
  toolbar.appendChild(
    button('サンプルを読み込む', 'pkc-btn-small', () => {
      if (editorEl) editorEl.value = DEMO_SOURCE;
      scheduleRender(DEMO_SOURCE);
    }),
  );
  engineEl = el('span', 'pmd-engine');
  engineEl.setAttribute('data-pmd-mode', 'fallback');
  engineEl.textContent = 'engine: —';
  toolbar.appendChild(engineEl);
  root.appendChild(toolbar);

  bannerEl = el('div', 'pmd-banner');
  bannerEl.setAttribute('data-pkc-region', 'pmd-banner');
  bannerEl.hidden = true;
  root.appendChild(bannerEl);

  // index(接続時のみ意味があるが standalone でも空表示)
  indexEl = el('div', 'pkc-panel');
  indexEl.setAttribute('data-pkc-region', 'pmd-index');
  // 索引は header 直下のメニューには入れず、左ペイン上部に薄く出す代わりに status で誘導。

  const body = el('div', 'pmd-body');
  body.setAttribute('data-pkc-region', 'pmd-body');

  const editorPane = el('div', 'pmd-pane');
  editorPane.appendChild(el('div', 'pmd-pane-label', 'source (PKC-Markdown)'));
  const editor = document.createElement('textarea');
  editor.className = 'pmd-editor';
  editor.setAttribute('data-pkc-field', 'pmd-source');
  editor.spellcheck = false;
  editor.placeholder = '# Markdown をここに…\n\nPKC2 から本文を送ると自動で入ります。';
  editor.addEventListener('input', () => scheduleRender(editor.value));
  editorPane.appendChild(editor);
  editorPane.appendChild(indexEl);
  editorEl = editor;
  body.appendChild(editorPane);

  const previewPane = el('div', 'pmd-pane');
  previewPane.appendChild(el('div', 'pmd-pane-label', 'preview (borrowed renderer)'));
  const frame = document.createElement('iframe');
  frame.className = 'pmd-frame';
  frame.title = 'rendered markdown';
  // no allow-scripts / no allow-same-origin: 借りた HTML を完全隔離。
  frame.setAttribute('sandbox', '');
  frame.setAttribute('data-pkc-region', 'pmd-preview');
  previewPane.appendChild(frame);
  frameEl = frame;
  body.appendChild(previewPane);

  root.appendChild(body);

  statusEl = el('div', 'pmd-statusbar');
  statusEl.setAttribute('data-pkc-region', 'pmd-status');
  root.appendChild(statusEl);

  setStatus(
    connected
      ? 'PKC2 に接続(core-render 申告済み)— projection / 送付待機中…'
      : 'standalone 起動 — ソースを入力するとローカル簡易描画。PKC2 から起動すると借用描画が有効化されます。',
  );
  renderIndex();
  // 初期プレビュー(空)。
  applyRender('', 'fallback', null);

  return { channel };
}

const mountTarget = document.getElementById('pmd-root');
if (mountTarget) mountPremiumMarkdownViewer(mountTarget);
