/**
 * Offer UI bundle — the standard block for simple sender tools (B15 / E
 * series): host connection + correlation tracker + 「オファー状況」 panel
 * + a one-call tracked send. Collapses ~35 lines of per-tool boilerplate.
 */

import { makeCorrelationId } from './envelope';
import { createHostConnection, type HostConnection } from './host-connect';
import { OfferTracker, offerStatusLabel } from './offer-track';
import { el } from './ui';

export interface OfferUi {
  conn: HostConnection;
  tracker: OfferTracker;
  /** 「オファー状況」 panel(状態行 + 一覧。自動再描画)。 */
  offersPanel: HTMLElement;
  /** record:offer を correlation_id 付きで送り、状況パネルに登録する。 */
  sendTracked(displayTitle: string, payload: Record<string, unknown>): boolean;
  /** 状況パネル先頭の一行メッセージ。 */
  note(text: string): void;
}

export function createOfferUi(sourceId: string, heading = 'オファー状況'): OfferUi {
  const tracker = new OfferTracker();
  const offersPanel = el('div', 'pkc-panel');
  offersPanel.setAttribute('data-pkc-region', 'offer-status');
  offersPanel.appendChild(el('div', 'pkc-panel-heading', heading));
  const noteEl = el('div', 'pkc-hint');
  offersPanel.appendChild(noteEl);
  const list = el('div', 'pkc-offerui-list');
  offersPanel.appendChild(list);

  function renderOffers(): void {
    list.replaceChildren();
    for (const rec of [...tracker.all()].reverse().slice(0, 50)) {
      list.appendChild(el('div', 'pkc-offerui-row', `"${rec.title}" — ${offerStatusLabel(rec)}`));
    }
  }

  function note(text: string): void {
    noteEl.textContent = text;
  }

  const conn = createHostConnection({
    sourceId,
    onNote: note,
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      if (type === 'record:ack' && tracker.resolveAck(payload)) renderOffers();
      else if (type === 'record:accept' && tracker.resolveAccept(payload)) renderOffers();
      else if (type === 'record:reject' && tracker.resolveReject(payload)) renderOffers();
    },
  });

  function sendTracked(displayTitle: string, payload: Record<string, unknown>): boolean {
    const correlationId = makeCorrelationId();
    const sent = conn.send('record:offer', payload, { correlationId });
    if (sent) {
      tracker.begin(correlationId, displayTitle);
      renderOffers();
      note('送信しました — PKC2 側の banner で accept してください');
    }
    return sent !== null;
  }

  // Minimal styles, id-guarded(どの CSS 構成でも成立させる)。
  if (!document.getElementById('pkc-offerui-style')) {
    const style = document.createElement('style');
    style.id = 'pkc-offerui-style';
    style.textContent =
      '.pkc-offerui-list{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;font-size:12px;margin-top:4px;}'
      + '.pkc-offerui-row{display:flex;gap:8px;align-items:baseline;}';
    document.head.appendChild(style);
  }

  return { conn, tracker, offersPanel, sendTracked, note };
}
