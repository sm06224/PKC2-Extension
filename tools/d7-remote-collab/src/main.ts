/**
 * D7 remote-collab — WebRTC でリモート PKC2 の一部に参加 (issue #120)。
 *
 * 拡張を緩衝地帯にして、WebRTC P2P でリモート peer の拡張とつなぐ。共有に出すのは
 * ユーザーが deliver で渡したテキスト entry のみ。受信は受信バッファに溜め、ローカル化は
 * propose(R5、同意 banner)経由のみ — リモートはあなたの PKC2 を勝手に書けない。
 *
 * 方式 S1: サーバーレス手動シグナリング(SDP コピペ)+ public STUN。双方向共有スペース。
 * 設計 doc = ideas/D-multi-pkc/D7-remote-collab.md。
 *
 * 規律: WebRTC/STUN は外部通信(明示表示)。受信本文は untrusted → textContent。
 * トランスポートは seam(collab.ts CollabTransport)。テストは fake transport で駆動。
 */

import '../../shared/base.css';
import './collab.css';
import { makeCorrelationId } from '../../shared/envelope';
import { ExtChannel, type ContainerProjection, type DeliverPayload } from '../../shared/ext-channel';
import { helpButton } from '../../shared/help';
import { button, el, foldSection, textInput } from '../../shared/ui';
import { createCollabPeer, type CollabPeer } from './rtc';
import {
  encodeMsg,
  importProposal,
  makeSharedItem,
  parseMsg,
  upsertById,
  type CollabTransport,
  type SharedItem,
} from './collab';

const TOOL_NAME = 'pkc2-remote-collab';
const TOOL_VERSION = '0.1.0';

interface CollabState {
  name: string;
  peerName: string;
  connected: boolean;
  useStun: boolean;
  candidates: SharedItem[]; // deliver で渡された共有候補
  sharedIds: Set<string>; // 実際に共有スペースに出している id
  inbox: SharedItem[]; // リモートから受信(まだローカル化していない)
  projection: ContainerProjection | null;
}

const state: CollabState = {
  name: '',
  peerName: '',
  connected: false,
  useStun: true,
  candidates: [],
  sharedIds: new Set(),
  inbox: [],
  projection: null,
};

let channel: ExtChannel | null = null;
let peer: CollabPeer | null = null;
let transport: CollabTransport | null = null;
let poolEl: HTMLElement | null = null;
let inboxEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let peerEl: HTMLElement | null = null;
const pendingProposals = new Map<string, string>();

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/* ------------------------------------------------------- transport */

function attachTransport(t: CollabTransport): void {
  transport = t;
  t.onMessage(handleData);
  t.onOpen(() => {
    state.connected = true;
    t.send(encodeMsg({ t: 'hello', name: state.name || '(匿名)' }));
    // 接続時に既に共有済みのものを送り直す
    for (const item of state.candidates) {
      if (state.sharedIds.has(item.id)) t.send(encodeMsg({ t: 'share', item }));
    }
    setStatus('🟢 peer と接続しました');
    render();
  });
  t.onClose(() => {
    state.connected = false;
    setStatus('🔌 接続が切れました');
    render();
  });
}

function handleData(data: string): void {
  const msg = parseMsg(data);
  if (!msg) return;
  if (msg.t === 'hello') {
    state.peerName = msg.name;
    setStatus(`👋 「${msg.name}」が参加しました`);
  } else if (msg.t === 'share') {
    state.inbox = upsertById(state.inbox, msg.item);
    setStatus(`📥 「${msg.item.title}」が共有されました`);
  } else if (msg.t === 'unshare') {
    state.inbox = state.inbox.filter((x) => x.id !== msg.id);
  } else if (msg.t === 'bye') {
    state.connected = false;
    setStatus('👋 peer が退出しました');
  }
  render();
}

/* ------------------------------------------------------- share / import */

function setShared(item: SharedItem, on: boolean): void {
  if (on) {
    state.sharedIds.add(item.id);
    transport?.send(encodeMsg({ t: 'share', item }));
    setStatus(`📤 「${item.title}」を共有スペースに出しました`);
  } else {
    state.sharedIds.delete(item.id);
    transport?.send(encodeMsg({ t: 'unshare', id: item.id }));
    setStatus(`「${item.title}」の共有を取り消しました`);
  }
  render();
}

function importInbox(item: SharedItem): void {
  if (!channel?.isEstablished()) {
    setStatus('PKC2 未接続のため取り込めません(standalone)');
    return;
  }
  const cid = makeCorrelationId();
  const ok = channel.sendPropose(importProposal(item), cid);
  if (ok) {
    pendingProposals.set(cid, item.title);
    setStatus(`📤 「${item.title}」を取り込み提案 — 同意 banner で承認してください`);
  }
}

function onProposeResult(accepted: boolean, assignedLid: string | null, cid: string | null): void {
  const label = cid !== null ? pendingProposals.get(cid) : undefined;
  if (cid !== null) pendingProposals.delete(cid);
  setStatus(
    accepted
      ? `✅ 「${label ?? '受信アイテム'}」を取り込みました${assignedLid ? `(${assignedLid})` : ''}`
      : `「${label ?? '受信アイテム'}」の取り込みは見送られました`,
  );
}

/* ------------------------------------------------------- ext-channel */

function onProjection(p: ContainerProjection): void {
  state.projection = p;
}

function onDeliver(d: DeliverPayload): void {
  if (d.kind !== 'entry' || typeof d.body !== 'string') {
    setStatus('共有できるのはテキスト系 entry です(添付の実体は共有しません)');
    return;
  }
  const lid = d.lid ?? `share-${Math.random().toString(36).slice(2)}`;
  const entry = state.projection?.entries.find((e) => e.lid === lid);
  const title = entry?.title ?? d.filename ?? lid;
  const archetype = entry?.archetype ?? 'text';
  const item = makeSharedItem(lid, title, archetype, d.body);
  state.candidates = upsertById(state.candidates, item);
  // 既に共有中なら更新を流す
  if (state.connected && state.sharedIds.has(lid)) transport?.send(encodeMsg({ t: 'share', item }));
  setStatus(`📎 「${title}」を共有候補に追加しました(「共有」で peer に出ます)`);
  render();
}

/* ------------------------------------------------------------ render */

function renderPool(): void {
  if (!poolEl) return;
  poolEl.replaceChildren();
  if (state.candidates.length === 0) {
    poolEl.appendChild(el('div', 'pkc-hint', 'PKC2 で entry を送付(send ジェスチャ)すると共有候補に並びます。'));
    return;
  }
  for (const item of state.candidates) {
    const row = el('div', 'pkc-collab-row');
    row.setAttribute('data-pkc-share', item.id);
    const on = state.sharedIds.has(item.id);
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = on;
    chk.className = 'pkc-collab-check';
    chk.setAttribute('data-pkc-action', 'share-toggle');
    chk.addEventListener('change', () => setShared(item, chk.checked));
    row.appendChild(chk);
    row.appendChild(el('span', 'pkc-collab-title', item.title));
    row.appendChild(el('span', 'pkc-hint', on ? '共有中' : `${item.archetype}`));
    poolEl.appendChild(row);
  }
}

function renderInbox(): void {
  if (!inboxEl) return;
  inboxEl.replaceChildren();
  if (state.inbox.length === 0) {
    inboxEl.appendChild(el('div', 'pkc-hint', 'peer が共有したアイテムがここに溜まります。「取り込み」で PKC2 に入れます(同意 banner)。'));
    return;
  }
  for (const item of state.inbox) {
    const row = el('div', 'pkc-collab-row');
    row.setAttribute('data-pkc-inbox', item.id);
    row.appendChild(el('span', 'pkc-collab-title', item.title)); // textContent(untrusted)
    row.appendChild(el('span', 'pkc-hint', item.archetype));
    const imp = button('⬇️ 取り込み', 'pkc-btn-small', () => importInbox(item), 'PKC2 に取り込む(propose)');
    imp.setAttribute('data-pkc-action', 'import');
    row.appendChild(imp);
    inboxEl.appendChild(row);
  }
}

function render(): void {
  renderPool();
  renderInbox();
  if (peerEl) {
    peerEl.textContent = state.connected
      ? `🟢 接続中${state.peerName ? ` — ${state.peerName}` : ''}`
      : '⚪ 未接続';
  }
}

/* -------------------------------------------------------------- mount */

export function mountRemoteCollab(root: HTMLElement, opts: { transport?: CollabTransport } = {}): { channel: ExtChannel } {
  state.name = '';
  state.peerName = '';
  state.connected = false;
  state.useStun = true;
  state.candidates = [];
  state.sharedIds = new Set();
  state.inbox = [];
  state.projection = null;
  pendingProposals.clear();
  peer = null;
  transport = null;

  root.replaceChildren();
  root.className = 'pkc-collab-root';

  // ---- header
  const header = el('div', 'pkc-collab-header');
  header.setAttribute('data-pkc-region', 'collab-header');
  header.appendChild(el('span', 'pkc-collab-apptitle', '🛰️ PKC2 Remote Collab'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — WebRTC でリモート PKC2 の一部に参加`));
  header.appendChild(helpButton('Remote Collab', {
    what: 'WebRTC で別の人の PKC2 とつなぎ、お互いが選んだ entry を共有スペースで見せ合う拡張です。拡張が緩衝地帯になり、相手はあなたの PKC2 を直接は触れません。',
    how: [
      '「接続」で 招待する(ホスト)or 参加する(ゲスト)を選ぶ',
      'ホスト: 招待コードを生成して相手に渡す → 相手の応答コードを貼って接続',
      'ゲスト: 招待コードを貼って応答コードを生成 → 相手に返す',
      'PKC2 で entry を送付すると共有候補に並ぶ → チェックで peer に共有',
      'peer が共有したものは受信欄に溜まる → 「取り込み」で自分の PKC2 に入れる(同意 banner)',
    ],
    flow: [
      '接続は WebRTC の P2P(peer 直結)。シグナリングはサーバーレス手動(SDP をコピペ)、STUN は IP 発見のみで本文は通りません',
      '共有に出るのは送付ジェスチャで渡した entry だけ。受信は受信欄に溜め、PKC2 へは propose(同意 banner)経由でのみ入ります',
      '相手から来た内容は外部由来として装飾なしテキストで表示します',
    ],
    notes: [
      'WebRTC は外部通信です(接続時に明示)。対称 NAT 下では繋がらないことがあります(v1 は relay/TURN なし)',
      '共有できるのはテキスト系 entry のみ(添付の実体は転送しません)',
      '本格的な認証はありません。招待/応答コードは信頼できる相手とだけ交換してください',
    ],
    connection: false,
  }));
  root.appendChild(header);

  peerEl = el('div', 'pkc-collab-peerstatus');
  peerEl.setAttribute('data-pkc-region', 'collab-peer');
  root.appendChild(peerEl);

  const warn = el('div', 'pkc-collab-warn', '⚠️ WebRTC で外部の peer と直接通信します(共有したぶんだけ相手に渡ります)');
  warn.setAttribute('data-pkc-region', 'collab-warn');
  root.appendChild(warn);

  // ---- 接続(折りたたみ、手動シグナリング)
  root.appendChild(buildConnectPanel().el);

  // ---- 共有プール(out)
  const poolWrap = el('div');
  poolEl = el('div', 'pkc-paper pkc-collab-pool');
  poolEl.setAttribute('data-pkc-region', 'collab-pool');
  poolWrap.appendChild(el('div', 'pkc-panel-heading', '📤 共有プール(送付した entry をチェックで共有)'));
  poolWrap.appendChild(poolEl);
  root.appendChild(poolWrap);

  // ---- 受信バッファ(in)
  const inWrap = el('div');
  inboxEl = el('div', 'pkc-paper pkc-collab-inbox');
  inboxEl.setAttribute('data-pkc-region', 'collab-inbox');
  inWrap.appendChild(el('div', 'pkc-panel-heading', '📥 受信(取り込みで自分の PKC2 へ)'));
  inWrap.appendChild(inboxEl);
  root.appendChild(inWrap);

  statusEl = el('div', 'pkc-statusbar');
  statusEl.setAttribute('data-pkc-region', 'collab-status');
  root.appendChild(statusEl);

  render();

  channel = new ExtChannel({ onProjection, onDeliver, onProposeResult });
  const connected = channel.start();
  setStatus(
    connected
      ? 'PKC2 に接続 — 「接続」で peer とつなぎ、送付した entry を共有できます'
      : 'standalone 起動 — peer 接続は可能ですが、取り込みは PKC2 接続時のみ',
  );

  // テスト用 transport 注入(実利用は接続パネルから WebRTC peer を張る)
  if (opts.transport) attachTransport(opts.transport);

  return { channel };
}

/** 手動シグナリングの接続パネル(WebRTC、browser 実機用)。 */
function buildConnectPanel(): { el: HTMLElement } {
  const body = el('div', 'pkc-collab-connect');

  const nameInput = textInput('あなたの表示名');
  nameInput.setAttribute('data-pkc-field', 'collab-name');
  nameInput.addEventListener('input', () => { state.name = nameInput.value; });
  body.appendChild(rowLabel('表示名', nameInput));

  const codeOut = document.createElement('textarea');
  codeOut.className = 'pkc-collab-code';
  codeOut.rows = 3;
  codeOut.readOnly = true;
  codeOut.placeholder = '生成されたコードがここに出ます(相手に渡す)';
  codeOut.setAttribute('data-pkc-field', 'collab-code-out');

  const codeIn = document.createElement('textarea');
  codeIn.className = 'pkc-collab-code';
  codeIn.rows = 3;
  codeIn.placeholder = '相手から受け取ったコードをここに貼る';
  codeIn.setAttribute('data-pkc-field', 'collab-code-in');

  const ensurePeer = (): CollabPeer => {
    if (!peer) {
      peer = createCollabPeer(state.useStun);
      attachTransport(peer.transport);
    }
    return peer;
  };

  const btnRow = el('div', 'pkc-btn-row');
  // ホスト: 招待コード生成
  btnRow.appendChild(button('招待コード生成(ホスト)', 'pkc-btn-small', () => {
    ensurePeer().createInvite().then(
      (code) => { codeOut.value = code; setStatus('招待コードを生成しました — 相手に渡してください'); },
      (e: unknown) => setStatus(`✖ 生成失敗: ${e instanceof Error ? e.message : String(e)}`),
    );
  }));
  // ゲスト: 招待コード → 応答コード生成
  btnRow.appendChild(button('応答コード生成(ゲスト)', 'pkc-btn-small', () => {
    if (codeIn.value.trim() === '') { setStatus('先に招待コードを貼ってください'); return; }
    ensurePeer().acceptInvite(codeIn.value.trim()).then(
      (code) => { codeOut.value = code; setStatus('応答コードを生成しました — 相手に返してください'); },
      (e: unknown) => setStatus(`✖ 生成失敗: ${e instanceof Error ? e.message : String(e)}`),
    );
  }));
  // ホスト: 応答コードで接続
  btnRow.appendChild(button('応答コードで接続(ホスト)', 'pkc-btn-small', () => {
    if (!peer || codeIn.value.trim() === '') { setStatus('招待コード生成後、相手の応答コードを貼ってください'); return; }
    peer.acceptAnswer(codeIn.value.trim()).then(
      () => setStatus('接続処理中… データチャネルが開くと🟢になります'),
      (e: unknown) => setStatus(`✖ 接続失敗: ${e instanceof Error ? e.message : String(e)}`),
    );
  }));
  body.appendChild(btnRow);
  body.appendChild(rowLabel('生成コード', codeOut));
  body.appendChild(rowLabel('相手のコード', codeIn));

  return foldSection('🔌 接続(WebRTC・コードを相互コピペ)', body, true);
}

function rowLabel(label: string, input: HTMLElement): HTMLElement {
  const row = el('div', 'pkc-field-row');
  row.appendChild(el('label', 'pkc-field-label', label));
  row.appendChild(input);
  return row;
}

const mountTarget = document.getElementById('collab-root');
if (mountTarget) mountRemoteCollab(mountTarget);
