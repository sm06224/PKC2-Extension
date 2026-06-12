/**
 * D2 a-to-b-bridge — A の accept を検知して B へ自動転送 (issue #47)。
 *
 * 一方向の承認パイプライン: 本ツールから A(審査側)へ offer し、A での
 * accept(record:accept、PKC2#804)を correlation で検知したら、同じ
 * payload を B(アーカイブ側)へ自動 offer する。
 *
 * v1 で成立する形に再設計:
 *  - 計画の「A で accept された任意レコードの検知 + export:request で全データ
 *    取得」は v1 では不可(accept echo は offer 送信者のみ・読み出し API なし)
 *  - 本ツール発の offer は payload を自分が知っているため、echo だけで転送が
 *    成立する。転送済みは ForwardStore から除去(重複防止)
 */

import '../../shared/base.css';
import './bridge.css';
import { makeCorrelationId } from '../../shared/envelope';
import { helpButton } from '../../shared/help';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-a-to-b-bridge';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

export type BridgeArchetype = 'text' | 'textlog' | 'todo';

/** offer payload を組み立てる(todo は body JSON 化)。Pure. */
export function buildBridgePayload(
  archetype: BridgeArchetype,
  title: string,
  body: string,
): Record<string, unknown> {
  if (archetype === 'todo') {
    return { title, archetype, body: JSON.stringify({ status: 'open', description: body }) };
  }
  return { title, archetype, body };
}

export interface PendingForward {
  correlationId: string;
  title: string;
  payload: Record<string, unknown>;
}

/** A へ送った offer の payload 控え。take で除去 = 二重転送防止。Pure model. */
export class ForwardStore {
  private map = new Map<string, PendingForward>();

  add(p: PendingForward): void {
    this.map.set(p.correlationId, p);
  }

  take(correlationId: string): PendingForward | null {
    const p = this.map.get(correlationId) ?? null;
    if (p) this.map.delete(correlationId);
    return p;
  }

  size(): number {
    return this.map.size;
  }
}

export interface BridgeMount {
  connA: HostConnection;
  connB: HostConnection;
}

export function mountBridge(root: HTMLElement): BridgeMount {
  root.replaceChildren();
  root.className = 'pkc-d2-root';

  const store = new ForwardStore();
  const trackerA = new OfferTracker();
  const trackerB = new OfferTracker();
  let active = true;
  const holdQueue: PendingForward[] = [];

  const header = el('div', 'pkc-d2-header');
  header.setAttribute('data-pkc-region', 'd2-header');
  header.appendChild(el('span', 'pkc-d2-title', '🌉 PKC2 A→B Bridge'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — A の accept を B へ自動転送(オフライン)`));
  header.appendChild(helpButton('A→B Bridge', {
    what: '一方向の承認パイプラインです: このツールから PKC2-A(審査側)へ offer し、A で accept されたレコードだけを PKC2-B(アーカイブ側)へ自動転送します。',
    how: [
      'A スロットと B スロットにそれぞれ pkc2.html を読み込む(🟢 = 接続)',
      'レコードを書いて「A へ offer」',
      'A 側で banner を accept → 同じ内容が自動で B へ offer されます(B 側でも accept)',
      'A で dismiss すると転送されません。「自動転送 OFF」中の accept は保留され、ON で流れます',
    ],
    flow: [
      'accept の検知は record:accept の correlation_id echo(PKC2#804)です — 本ツールが送った offer だけが対象',
      '転送済みは控えから除去するため、同じ accept が二重転送されることはありません',
    ],
    notes: [
      'A 内で人手作成されたレコードの検知・取得は v1 では不可(読み出し API なし)— 本ツール発の offer のみ橋渡しできます',
      'この HTML を pkc2.html と同じ場所に置いてください(iframe 埋め込みは same-origin のみ)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  // ---- compose
  const compose = el('div', 'pkc-panel');
  compose.setAttribute('data-pkc-region', 'd2-compose');
  compose.appendChild(el('div', 'pkc-panel-heading', 'レコード作成 → A(審査側)へ'));
  const title = textInput('タイトル');
  title.setAttribute('data-pkc-field', 'd2-title');
  compose.appendChild(title);
  const archetype = selectInput([
    { value: 'text', label: 'archetype: text' },
    { value: 'textlog', label: 'archetype: textlog' },
    { value: 'todo', label: 'archetype: todo(body は自動 JSON 化)' },
  ]);
  archetype.setAttribute('data-pkc-field', 'd2-archetype');
  compose.appendChild(archetype);
  const body = document.createElement('textarea');
  body.rows = 4;
  body.placeholder = '本文';
  body.setAttribute('data-pkc-field', 'd2-body');
  compose.appendChild(body);

  const logPanel = el('div', 'pkc-panel');
  logPanel.setAttribute('data-pkc-region', 'd2-log');
  logPanel.appendChild(el('div', 'pkc-panel-heading', '転送ログ'));
  const logList = el('div', 'pkc-d2-log');
  logPanel.appendChild(logList);

  function log(text: string): void {
    const row = el('div', 'pkc-d2-logrow', `${new Date().toLocaleTimeString()} ${text}`);
    logList.prepend(row);
    while (logList.children.length > 200) logList.lastChild?.remove();
  }

  function forwardToB(pf: PendingForward): void {
    if (connB.getStatus() !== 'connected') {
      holdQueue.push(pf);
      log(`⏸ "${pf.title}" — B 未接続のため保留(接続後「保留分を転送」)`);
      return;
    }
    const cid = makeCorrelationId();
    const env = connB.send('record:offer', pf.payload, { correlationId: cid });
    if (env) {
      trackerB.begin(cid, pf.title);
      log(`📤 "${pf.title}" を B へ転送 — B 側 banner で accept してください`);
    } else {
      holdQueue.push(pf);
      log(`⏸ "${pf.title}" — B への送信失敗のため保留`);
    }
  }

  function onAResolved(kind: 'ack' | 'accept' | 'reject', correlationId: string, recTitle: string): void {
    if (kind === 'ack') return;
    if (kind === 'reject') {
      const dropped = store.take(correlationId);
      if (dropped) log(`✖ A が "${dropped.title}" を却下 — 転送しません`);
      return;
    }
    const pf = store.take(correlationId);
    if (!pf) return; // 既転送 or 本ツール発でない
    log(`✅ A が "${pf.title}" を受理`);
    if (!active) {
      holdQueue.push(pf);
      log(`⏸ 自動転送 OFF のため保留(${holdQueue.length} 件)`);
      return;
    }
    forwardToB(pf);
    void recTitle;
  }

  const slots = el('div', 'pkc-d2-slots');
  const makeSlot = (label: string, tracker: OfferTracker, onResolved?: typeof onAResolved): { box: HTMLElement; conn: HostConnection } => {
    const box = el('div', 'pkc-d2-slot');
    box.setAttribute('data-pkc-region', `d2-slot-${label}`);
    box.appendChild(el('div', 'pkc-panel-heading', label === 'A' ? '🅰 PKC2-A(審査側)' : '🅱 PKC2-B(アーカイブ側)'));
    const note = el('div', 'pkc-hint');
    const conn = createHostConnection({
      sourceId: TOOL_ID,
      onNote: (t) => {
        note.textContent = t;
      },
      onEnvelope: (inbound) => {
        if (!inbound.viaHost) return;
        const { type, payload } = inbound.envelope;
        let rec = null;
        let kind: 'ack' | 'accept' | 'reject' | null = null;
        if (type === 'record:ack') {
          rec = tracker.resolveAck(payload);
          kind = 'ack';
        } else if (type === 'record:accept') {
          rec = tracker.resolveAccept(payload);
          kind = 'accept';
        } else if (type === 'record:reject') {
          rec = tracker.resolveReject(payload);
          kind = 'reject';
        }
        if (rec && kind) {
          if (label === 'B') log(`🅱 "${rec.title}" — ${offerStatusLabel(rec)}`);
          onResolved?.(kind, rec.correlationId, rec.title);
        }
      },
    });
    box.appendChild(conn.root);
    box.appendChild(note);
    slots.appendChild(box);
    return { box, conn };
  };

  const { conn: connA } = makeSlot('A', trackerA, onAResolved);
  const { conn: connB } = makeSlot('B', trackerB);

  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(
    button('A へ offer', 'pkc-btn', () => {
      const t = title.value.trim();
      if (t === '') {
        log('タイトルが空です');
        return;
      }
      if (connA.getStatus() !== 'connected') {
        log('A が未接続です');
        return;
      }
      const payload = buildBridgePayload(archetype.value as BridgeArchetype, t, body.value);
      const cid = makeCorrelationId();
      const env = connA.send('record:offer', payload, { correlationId: cid });
      if (env) {
        trackerA.begin(cid, t);
        store.add({ correlationId: cid, title: t, payload });
        log(`📨 "${t}" を A へ offer — A 側 banner の accept 待ち`);
      }
    }),
  );
  const toggle = button('自動転送: ON', 'pkc-btn-small', () => {
    active = !active;
    toggle.textContent = active ? '自動転送: ON' : '自動転送: OFF';
    log(active ? '▶ 自動転送を再開しました' : '⏸ 自動転送を一時停止しました');
    if (active) flushHold();
  });
  bar.appendChild(toggle);
  bar.appendChild(
    button('保留分を転送', 'pkc-btn-small', () => flushHold()),
  );
  compose.appendChild(bar);
  root.appendChild(compose);
  root.appendChild(slots);
  root.appendChild(logPanel);

  function flushHold(): void {
    const queued = holdQueue.splice(0, holdQueue.length);
    if (queued.length === 0) {
      log('保留はありません');
      return;
    }
    for (const pf of queued) forwardToB(pf);
  }

  return { connA, connB };
}

const mountTarget = document.getElementById('d2-root');
if (mountTarget) mountBridge(mountTarget);
