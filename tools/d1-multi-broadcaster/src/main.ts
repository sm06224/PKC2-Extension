/**
 * D1 multi-broadcaster — 複数 PKC2 への同時 record:offer 配信 (issue #46)。
 *
 * D カテゴリの基本パターン: スロット(= shared/host-connect のインスタンス)を
 * 動的に追加し、各スロットが独立に iframe 埋め込み + ping/pong を持つ。
 * Broadcast は接続済みスロット全部へ同一 payload の record:offer を
 * スロット別 correlation_id 付きで送り、ack/accept/reject をスロット別に
 * 相関表示する(PKC2#804)。
 *
 * 計画 doc の target_id 指定・Promise.allSettled は不要になった —
 * 送信は window 直指定(iframe ごとの HostLink)で fire-and-forget、
 * 応答は correlation で非同期に追跡する。
 */

import '../../shared/base.css';
import './broadcaster.css';
import { makeCorrelationId } from '../../shared/envelope';
import { helpButton } from '../../shared/help';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-multi-broadcaster';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

export type BroadcastArchetype = 'text' | 'textlog' | 'todo';

/** offer payload を組み立てる(todo は body JSON 化)。Pure. */
export function buildBroadcastPayload(
  archetype: BroadcastArchetype,
  title: string,
  body: string,
): Record<string, unknown> {
  if (archetype === 'todo') {
    return { title, archetype, body: JSON.stringify({ status: 'open', description: body }) };
  }
  return { title, archetype, body };
}

interface Slot {
  id: number;
  conn: HostConnection;
  tracker: OfferTracker;
  box: HTMLElement;
  resultEl: HTMLElement;
}

let slots: Slot[] = [];
let slotSeq = 0;
let statusEl: HTMLElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderSlotResult(slot: Slot): void {
  const recent = [...slot.tracker.all()].slice(-3).reverse();
  slot.resultEl.replaceChildren();
  if (recent.length === 0) {
    slot.resultEl.textContent = '(まだ送信していません)';
    return;
  }
  for (const r of recent) {
    slot.resultEl.appendChild(el('div', 'pkc-d1-result', `"${r.title}" — ${offerStatusLabel(r)}`));
  }
}

function addSlot(container: HTMLElement): void {
  const id = ++slotSeq;
  const box = el('div', 'pkc-d1-slot');
  box.setAttribute('data-pkc-region', `d1-slot-${id}`);
  const head = el('div', 'pkc-d1-slothead');
  head.appendChild(el('span', 'pkc-panel-heading', `📡 PKC2 #${id}`));

  const tracker = new OfferTracker();
  const resultEl = el('div', 'pkc-hint');

  const slot: Slot = { id, conn: null as unknown as HostConnection, tracker, box, resultEl };

  head.appendChild(
    button('スロット削除', 'pkc-btn-small', () => {
      slot.conn.dispose();
      box.remove();
      slots = slots.filter((s) => s !== slot);
      setStatus(`スロット #${id} を削除しました(残り ${slots.length})`);
    }),
  );
  box.appendChild(head);

  slot.conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (t) => {
      resultEl.textContent = t;
    },
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      let changed = false;
      if (type === 'record:ack') changed = tracker.resolveAck(payload) !== null;
      else if (type === 'record:accept') changed = tracker.resolveAccept(payload) !== null;
      else if (type === 'record:reject') changed = tracker.resolveReject(payload) !== null;
      if (changed) renderSlotResult(slot);
    },
  });
  box.appendChild(slot.conn.root);
  box.appendChild(resultEl);
  renderSlotResult(slot);

  slots.push(slot);
  container.appendChild(box);
}

export function mountBroadcaster(root: HTMLElement): void {
  // 再 mount(およびテスト)に備えて既存スロットを破棄
  for (const s of slots) s.conn.dispose();
  slots = [];
  root.replaceChildren();
  root.className = 'pkc-d1-root';

  const header = el('div', 'pkc-d1-header');
  header.setAttribute('data-pkc-region', 'd1-header');
  header.appendChild(el('span', 'pkc-d1-title', '📡 PKC2 Multi Broadcaster'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 複数 PKC2 へ同時 offer(オフライン)`));
  header.appendChild(helpButton('Multi Broadcaster', {
    what: '複数の PKC2 を iframe で並べて読み込み、同じレコードを全部へ一斉に record:offer するブリッジツールです(D カテゴリの基本形)。',
    how: [
      '「+ PKC2 スロットを追加」でスロットを増やし、各スロットで pkc2.html を読み込む(🟢 = 接続)',
      'タイトル・archetype・本文を書いて「Broadcast」',
      '各 PKC2 側で banner が出るので、それぞれ accept / dismiss',
      'スロットごとに ⏳→📬→✅/✖ の到達状況が相関表示されます(correlation_id、PKC2#804)',
    ],
    flow: [
      '送信は各 iframe の window へ直接 postMessage(targetOrigin は同一 origin に pin)— 中継サーバはありません',
      '受信(ack/accept/reject)はスロットの window identity + origin で検証してから相関します',
    ],
    notes: [
      'この HTML を pkc2.html と同じ場所に置いてください(iframe 埋め込みは same-origin のみ)',
      'PKC2 から launcher 起動した場合、追加スロットも起動元に繋がることがあります(同一 host への重複送信に注意)— standalone 利用を推奨',
      '各 PKC2 は別ファイル(別 container)である必要があります。同じファイルを 2 回読み込むと同じ container に 2 回 offer されます',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- compose
  const compose = el('div', 'pkc-panel');
  compose.setAttribute('data-pkc-region', 'd1-compose');
  compose.appendChild(el('div', 'pkc-panel-heading', 'レコード作成(全スロットへ配信)'));
  const title = textInput('タイトル');
  title.setAttribute('data-pkc-field', 'd1-title');
  compose.appendChild(title);
  const archetype = selectInput([
    { value: 'text', label: 'archetype: text' },
    { value: 'textlog', label: 'archetype: textlog' },
    { value: 'todo', label: 'archetype: todo(body は自動 JSON 化)' },
  ]);
  archetype.setAttribute('data-pkc-field', 'd1-archetype');
  compose.appendChild(archetype);
  const body = document.createElement('textarea');
  body.rows = 5;
  body.placeholder = '本文(todo の場合は description になります)';
  body.setAttribute('data-pkc-field', 'd1-body');
  compose.appendChild(body);

  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(
    button('Broadcast (record:offer × N)', 'pkc-btn', () => {
      const t = title.value.trim();
      if (t === '') {
        setStatus('タイトルが空です');
        return;
      }
      const payload = buildBroadcastPayload(archetype.value as BroadcastArchetype, t, body.value);
      let sent = 0;
      let skipped = 0;
      for (const slot of slots) {
        if (slot.conn.getStatus() !== 'connected') {
          skipped++;
          continue;
        }
        const cid = makeCorrelationId();
        const env = slot.conn.send('record:offer', payload, { correlationId: cid });
        if (env) {
          slot.tracker.begin(cid, t);
          renderSlotResult(slot);
          sent++;
        } else {
          skipped++;
        }
      }
      setStatus(`📤 送信 ${sent} 件 / スキップ ${skipped} 件(未接続)— 各 PKC2 側の banner で accept してください`);
    }),
  );
  compose.appendChild(bar);
  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'd1-status');
  compose.appendChild(statusEl);
  root.appendChild(compose);

  // ---- slots
  const slotsPanel = el('div', 'pkc-d1-slots');
  slotsPanel.setAttribute('data-pkc-region', 'd1-slots');
  root.appendChild(slotsPanel);

  const addBar = el('div', 'pkc-btn-row');
  addBar.appendChild(button('+ PKC2 スロットを追加', 'pkc-btn', () => addSlot(slotsPanel)));
  root.appendChild(addBar);

  // 最初から 2 スロット(D1 の趣旨が見えるように)
  addSlot(slotsPanel);
  addSlot(slotsPanel);
}

const mountTarget = document.getElementById('d1-root');
if (mountTarget) mountBroadcaster(mountTarget);
