/**
 * H2 ai-assistant — AI チャット連携 (issue #109)。
 *
 * PKC2 の隣で動く AI チャット。会話ログを PKC2 へ textlog として保存(R5
 * propose、同意 banner で accept→mint)。文脈はユーザーが送付ジェスチャ
 * (deliver)で渡した entry のみ(勝手に読まない)。
 *
 * 通信方式(ユーザー判断 2026-06-15 = A も含める):
 *   - http : OpenAI 互換 endpoint へ fetch。localhost(方式 B)/ 外部(方式 A)共通。
 *            外部 URL は警告を常時表示。API キーは in-memory のみ(localStorage 不可)。
 *   - clipboard : プロンプトをコピー → 外部 AI → 応答を貼り付け(方式 C、通信ゼロ)。
 *   - none : 未設定(既定)。
 *
 * 規律: AI 応答は外部由来 untrusted なので描画は textContent のみ(innerHTML 禁止)。
 * 送信前に「何が送られるか」を可視化。キーはログ/propose/status に出さない。
 * 詳細設計 = ideas/H-communication/H2-ai-assistant.md。
 */

import '../../shared/base.css';
import './assistant.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection, type DeliverPayload } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, selectInput, textInput } from '../../shared/ui';
import {
  PRESETS,
  buildMessages,
  chatCompletionsBody,
  clipboardPrompt,
  conversationProposal,
  exceedsBodyCap,
  isExternalEndpoint,
  parseAssistantContent,
  type ChatTurn,
  type ContextEntry,
  type ProviderMode,
} from './assistant';

const TOOL_NAME = 'pkc2-ai-assistant';
const TOOL_VERSION = '0.1.0';
// 非機密の設定だけ永続化(キーと会話は永続化しない — 規律)。
const CFG_KEY = 'pkc2-h2-ai-assistant:config';

interface AsstState {
  mode: ProviderMode;
  endpoint: string;
  model: string;
  apiKey: string; // in-memory のみ。localStorage に出さない。
  history: ChatTurn[];
  context: ContextEntry[];
  projection: ContainerProjection | null;
  busy: boolean;
}

const state: AsstState = {
  mode: 'none',
  endpoint: PRESETS[0]!.endpoint,
  model: '',
  apiKey: '',
  history: [],
  context: [],
  projection: null,
  busy: false,
};

let channel: ExtChannel | null = null;
let logEl: HTMLElement | null = null;
let ctxEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let statusEl: HTMLElement | null = null;
let warnEl: HTMLElement | null = null;
let pasteWrap: HTMLElement | null = null;
const pendingProposals = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* ------------------------------------------------------ persistence */

function persistConfig(): void {
  try {
    window.localStorage.setItem(CFG_KEY, JSON.stringify({ mode: state.mode, endpoint: state.endpoint, model: state.model }));
  } catch {
    /* best-effort */
  }
}

function restoreConfig(): void {
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return;
    const c = JSON.parse(raw) as Record<string, unknown>;
    if (c['mode'] === 'http' || c['mode'] === 'clipboard' || c['mode'] === 'none') state.mode = c['mode'];
    if (typeof c['endpoint'] === 'string') state.endpoint = c['endpoint'];
    if (typeof c['model'] === 'string') state.model = c['model'];
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------- chat */

function updateWarning(): void {
  if (!warnEl) return;
  if (state.mode === 'http' && isExternalEndpoint(state.endpoint)) {
    let host = state.endpoint;
    try {
      host = new URL(state.endpoint).host;
    } catch {
      /* keep raw */
    }
    warnEl.textContent = `⚠️ 外部送信: このプロンプトと include した文脈が外部 ${host} に送信されます`;
    warnEl.style.display = '';
  } else {
    warnEl.textContent = '';
    warnEl.style.display = 'none';
  }
}

async function sendHttp(): Promise<void> {
  const messages = buildMessages(state.context, state.history);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.apiKey !== '') headers['Authorization'] = `Bearer ${state.apiKey}`;
  state.busy = true;
  setStatus('🤖 応答待ち…');
  render();
  try {
    const res = await fetch(state.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(chatCompletionsBody(state.model, messages)),
    });
    if (!res.ok) {
      setStatus(`✖ AI 応答エラー: HTTP ${res.status}`);
      return;
    }
    const json: unknown = await res.json();
    const content = parseAssistantContent(json);
    if (content === null) {
      setStatus('✖ 応答を解釈できませんでした(OpenAI 互換の choices[0].message.content 形を期待)');
      return;
    }
    state.history.push({ role: 'assistant', content });
    setStatus('✅ 応答を受信しました');
  } catch (e) {
    setStatus(`✖ 通信失敗: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    state.busy = false;
    render();
  }
}

function sendCurrent(): void {
  if (!inputEl || state.busy) return;
  const text = inputEl.value.trim();
  if (text === '') return;
  if (state.mode === 'none') {
    setStatus('プロバイダ未設定 — 「接続設定」で localhost / 外部 / クリップボードを選んでください');
    return;
  }
  if (state.mode === 'http' && state.model.trim() === '') {
    setStatus('モデル名を入力してください(例: gpt-4o-mini / llama3.1 など)');
    return;
  }
  state.history.push({ role: 'user', content: text });
  inputEl.value = '';
  render();
  if (state.mode === 'http') {
    void sendHttp();
  } else {
    // clipboard: プロンプトをコピーして貼り付け欄を出す
    const prompt = clipboardPrompt(state.context, state.history);
    const clip = (navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } }).clipboard;
    if (clip?.writeText) {
      clip.writeText(prompt).then(
        () => setStatus('📋 プロンプトをコピーしました — 外部 AI に貼り、応答を下の欄に貼り付けてください'),
        () => setStatus('クリップボードへのコピーに失敗しました(権限)'),
      );
    } else {
      setStatus('このブラウザではコピー不可 — 下のプロンプトを手動でコピーしてください');
    }
    render();
  }
}

function takePastedResponse(text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') return;
  state.history.push({ role: 'assistant', content: trimmed });
  setStatus('✅ 応答を取り込みました');
  render();
}

function resetConversation(): void {
  state.history = [];
  for (const c of state.context) c.include = false;
  setStatus('🆕 新しい会話を開始しました(履歴と文脈の include をクリア)');
  render();
}

/* ------------------------------------------------------------- save */

function saveConversation(): void {
  if (state.history.length === 0) {
    setStatus('保存する会話がありません');
    return;
  }
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため保存できません(standalone)');
    return;
  }
  const proposal = conversationProposal(state.history);
  if (exceedsBodyCap(proposal.body)) {
    setStatus('✖ 会話が長すぎて保存できません(本文上限 262,144 文字超)— 新しい会話に分けてください');
    return;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendPropose(proposal, cid);
  if (ok) {
    pendingProposals.set(cid, proposal.title);
    setStatus('📤 会話を PKC2 へ保存提案 — 同意 banner で承認してください');
  }
}

function onProposeResult(accepted: boolean, assignedLid: string | null, cid: string | null): void {
  const label = cid !== null ? pendingProposals.get(cid) : undefined;
  if (cid !== null) pendingProposals.delete(cid);
  setStatus(
    accepted
      ? `✅ 会話を保存しました${assignedLid ? `(${assignedLid})` : ''}`
      : `「${label ?? '会話'}」の保存は見送られました`,
  );
}

/* ------------------------------------------------------------ deliver */

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'entry' || typeof d.body !== 'string') {
    setStatus('文脈に使えるのはテキスト系 entry です(添付の実体は AI に渡しません)');
    return;
  }
  const lid = d.lid ?? `ctx-${Math.random().toString(36).slice(2)}`;
  const title = state.projection?.entries.find((e) => e.lid === lid)?.title ?? d.filename ?? lid;
  const existing = state.context.find((c) => c.lid === lid);
  if (existing) {
    existing.body = d.body;
    existing.include = true;
  } else {
    state.context.push({ lid, title, body: d.body, include: true });
  }
  setStatus(`📎 文脈に「${title}」を追加しました(会話に含めます)`);
  render();
}

/* ------------------------------------------------------------ render */

function bubble(t: ChatTurn): HTMLElement {
  const row = el('div', t.role === 'user' ? 'pkc-ai-row pkc-ai-user' : 'pkc-ai-row pkc-ai-asst');
  const b = el('div', 'pkc-ai-bubble');
  b.appendChild(el('div', 'pkc-ai-role', t.role === 'user' ? 'あなた' : '🤖 AI'));
  b.appendChild(el('div', 'pkc-ai-text', t.content)); // textContent(untrusted 応答は HTML 化しない)
  row.appendChild(b);
  return row;
}

function renderContext(): void {
  if (!ctxEl) return;
  ctxEl.replaceChildren();
  if (state.context.length === 0) {
    ctxEl.appendChild(el('div', 'pkc-hint', 'PKC2 で entry を送付(send ジェスチャ)すると、ここに文脈候補として並びます。include したものだけ AI に渡ります。'));
    return;
  }
  for (const c of state.context) {
    const row = el('div', 'pkc-ai-ctxrow');
    row.setAttribute('data-pkc-ctx', c.lid);
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = c.include;
    chk.className = 'pkc-ai-ctxcheck';
    chk.setAttribute('data-pkc-action', 'ctx-include');
    chk.addEventListener('change', () => {
      c.include = chk.checked;
    });
    row.appendChild(chk);
    row.appendChild(el('span', 'pkc-ai-ctxtitle', c.title));
    row.appendChild(el('span', 'pkc-hint', `${c.body.length} 文字`));
    ctxEl.appendChild(row);
  }
}

function render(): void {
  if (!logEl) return;
  logEl.replaceChildren();
  if (state.history.length === 0) {
    logEl.appendChild(el('div', 'pkc-hint', 'メッセージを入力して送信してください。'));
  } else {
    for (const t of state.history) logEl.appendChild(bubble(t));
  }
  renderContext();
  updateWarning();
  // クリップボード貼り付け欄は clipboard モードの時だけ
  if (pasteWrap) pasteWrap.style.display = state.mode === 'clipboard' ? '' : 'none';
}

/* ------------------------------------------------------------ channel */

function onProjection(p: ContainerProjection): void {
  state.projection = p;
}

/* -------------------------------------------------------------- mount */

export function mountAiAssistant(root: HTMLElement): { channel: ExtChannel } {
  state.mode = 'none';
  state.endpoint = PRESETS[0]!.endpoint;
  state.model = '';
  state.apiKey = '';
  state.history = [];
  state.context = [];
  state.projection = null;
  state.busy = false;
  pendingProposals.clear();
  restoreConfig();

  root.replaceChildren();
  root.className = 'pkc-ai-root';

  // ---- header
  const header = el('div', 'pkc-ai-header');
  header.setAttribute('data-pkc-region', 'ai-header');
  header.appendChild(el('span', 'pkc-ai-apptitle', '🤖 PKC2 AI Assistant'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — AI チャット連携`));
  header.appendChild(helpButton('AI Assistant', {
    what: 'PKC2 の隣で動く AI チャットです。会話を PKC2 に textlog として保存でき、PKC2 のメモを送付ジェスチャで渡したぶんだけ文脈に使えます。',
    how: [
      '「接続設定」で方式を選ぶ: localhost LLM(ollama / LM Studio)/ 外部 API / クリップボード',
      'http の場合は endpoint・モデル名・(外部なら)API キーを入力',
      'メッセージを入力して送信(Enter 送信 / Shift+Enter 改行)',
      'PKC2 で entry を送付すると「文脈」に並ぶ → include したものだけ AI に渡る',
      '📤 で会話を PKC2 に保存(同意 banner で承認)、🆕 で新しい会話',
    ],
    flow: [
      'localhost / 外部いずれも OpenAI 互換 Chat Completions に送ります(差は URL とキーだけ)',
      '会話保存は pkc-ext の propose(R5)。承認して初めて PKC2 に textlog ができます',
      'AI 応答は外部由来のため、装飾なしのテキストとして表示します(HTML 描画しません)',
    ],
    notes: [
      'API キーはこのページのメモリにだけ保持し、保存しません(リロードで消えます)。endpoint とモデル名だけ localStorage に残ります',
      '外部 API を選ぶと、プロンプトと include した文脈が外部に送信されます(警告を常時表示)。Tier S の sandbox は通信を遮断しません',
      '文脈に渡せるのは送付ジェスチャで渡したテキスト entry だけです(添付の実体は渡しません)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- 接続設定(折りたたみ)
  const cfgBody = el('div', 'pkc-ai-cfg');
  const modeSel = selectInput([
    { value: 'none', label: '未設定' },
    { value: 'http', label: 'http(localhost / 外部 API)' },
    { value: 'clipboard', label: 'クリップボード手動' },
  ]);
  modeSel.value = state.mode;
  modeSel.setAttribute('data-pkc-field', 'ai-mode');
  modeSel.addEventListener('change', () => {
    state.mode = modeSel.value as ProviderMode;
    persistConfig();
    render();
  });
  cfgBody.appendChild(rowLabel('方式', modeSel));

  const presetRow = el('div', 'pkc-ai-presets');
  for (const p of PRESETS) {
    presetRow.appendChild(button(p.label, 'pkc-btn-small', () => {
      state.mode = 'http';
      state.endpoint = p.endpoint;
      modeSel.value = 'http';
      endpointInput.value = p.endpoint;
      persistConfig();
      render();
    }));
  }
  cfgBody.appendChild(presetRow);

  const endpointInput = textInput('http://localhost:11434/v1/chat/completions');
  endpointInput.value = state.endpoint;
  endpointInput.setAttribute('data-pkc-field', 'ai-endpoint');
  endpointInput.addEventListener('input', () => {
    state.endpoint = endpointInput.value;
    persistConfig();
    updateWarning();
  });
  cfgBody.appendChild(rowLabel('endpoint', endpointInput));

  const modelInput = textInput('モデル名(例: gpt-4o-mini / llama3.1)');
  modelInput.value = state.model;
  modelInput.setAttribute('data-pkc-field', 'ai-model');
  modelInput.addEventListener('input', () => {
    state.model = modelInput.value;
    persistConfig();
  });
  cfgBody.appendChild(rowLabel('モデル', modelInput));

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = 'API キー(外部 API のみ・保存しません)';
  keyInput.setAttribute('data-pkc-field', 'ai-key');
  keyInput.addEventListener('input', () => {
    state.apiKey = keyInput.value; // in-memory のみ
  });
  cfgBody.appendChild(rowLabel('APIキー', keyInput));

  const cfgFold = foldSection('🔌 接続設定', cfgBody, state.mode === 'none');
  root.appendChild(cfgFold.el);

  warnEl = el('div', 'pkc-ai-warn');
  warnEl.setAttribute('data-pkc-region', 'ai-warn');
  root.appendChild(warnEl);

  // ---- 文脈(折りたたみ)
  ctxEl = el('div', 'pkc-ai-ctx');
  ctxEl.setAttribute('data-pkc-region', 'ai-context');
  const ctxWrap = el('div');
  ctxWrap.appendChild(ctxEl);
  const resetBtn = button('🆕 新しい会話', 'pkc-btn-small', resetConversation);
  resetBtn.setAttribute('data-pkc-action', 'reset');
  ctxWrap.appendChild(resetBtn);
  root.appendChild(foldSection('📎 文脈(送付された entry)', ctxWrap, false).el);

  // ---- chat log
  logEl = el('div', 'pkc-paper pkc-ai-log');
  logEl.setAttribute('data-pkc-region', 'ai-log');
  root.appendChild(logEl);

  // ---- クリップボード貼り付け欄(clipboard モード時のみ表示)
  pasteWrap = el('div', 'pkc-ai-paste');
  pasteWrap.setAttribute('data-pkc-region', 'ai-paste');
  const pasteArea = document.createElement('textarea');
  pasteArea.className = 'pkc-ai-pastearea';
  pasteArea.rows = 3;
  pasteArea.placeholder = '外部 AI の応答をここに貼り付け → 取り込み';
  pasteArea.setAttribute('data-pkc-field', 'ai-paste');
  pasteWrap.appendChild(pasteArea);
  const takeBtn = button('取り込み', 'pkc-btn-small', () => {
    takePastedResponse(pasteArea.value);
    pasteArea.value = '';
  });
  takeBtn.setAttribute('data-pkc-action', 'take-paste');
  pasteWrap.appendChild(takeBtn);
  root.appendChild(pasteWrap);

  // ---- composer
  const composer = el('div', 'pkc-ai-composer');
  composer.setAttribute('data-pkc-region', 'ai-composer');
  inputEl = document.createElement('textarea');
  inputEl.className = 'pkc-ai-input';
  inputEl.rows = 2;
  inputEl.placeholder = 'メッセージ… (Enter 送信 / Shift+Enter 改行)';
  inputEl.setAttribute('data-pkc-field', 'ai-input');
  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      sendCurrent();
    }
  });
  composer.appendChild(inputEl);
  const sendBtn = button('送信', 'pkc-btn pkc-ai-send', () => sendCurrent());
  sendBtn.setAttribute('data-pkc-action', 'send');
  composer.appendChild(sendBtn);
  const saveBtn = button('📤 保存', 'pkc-btn-small pkc-ai-save', () => saveConversation());
  saveBtn.setAttribute('data-pkc-action', 'save');
  composer.appendChild(saveBtn);
  root.appendChild(composer);

  // ---- status
  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'ai-status');
  root.appendChild(statusEl);

  render();

  channel = new ExtChannel({ onProjection, onDeliver, onProposeResult });
  const connected = channel.start();
  setStatus(
    connected
      ? 'PKC2 を検出 — 文脈の送付・会話の保存が使えます。まず「接続設定」で方式を選んでください'
      : 'standalone 起動 — 「接続設定」で方式を選べばチャットできます(保存は PKC2 接続時のみ)',
  );

  return { channel };
}

function rowLabel(label: string, input: HTMLElement): HTMLElement {
  const row = el('div', 'pkc-field-row');
  row.appendChild(el('label', 'pkc-field-label', label));
  row.appendChild(input);
  return row;
}

const mountTarget = document.getElementById('ai-root');
if (mountTarget) mountAiAssistant(mountTarget);
