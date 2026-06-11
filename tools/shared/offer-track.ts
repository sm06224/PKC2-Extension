/**
 * Offer round-trip tracker (PKC2#804 consumer side). Pure model, no DOM.
 *
 * The sender attaches a `correlation_id` to each `record:offer`; the host
 * (v1.x, PKC2#804) echoes it in `record:ack` (delivery, carries the
 * host-minted `offer_id`), `record:reject` (dismiss) and `record:accept`
 * (carries `assigned_lid`). This tracker resolves those echoes back to the
 * sent offer so B1/B2 can show a live status per offer.
 *
 * Old hosts send no ack and no correlation echo — `resolve*` then returns
 * null and the caller falls back to the v1.0 "相関不能" note. The
 * `offer_id` learned from an ack is used as a secondary key so a reject /
 * accept that lost its correlation_id can still be matched.
 */

export type OfferStatus = 'sent' | 'acked' | 'accepted' | 'dismissed';

export interface OfferRecord {
  correlationId: string;
  title: string;
  sentAt: string; // ISO 8601
  status: OfferStatus;
  /** Host-minted id, learned from record:ack (null until then). */
  offerId: string | null;
  /** Entry lid, learned from record:accept. */
  assignedLid: string | null;
}

const CAP = 100;

export class OfferTracker {
  private records: OfferRecord[] = [];

  /** Register a freshly sent offer. */
  begin(correlationId: string, title: string): OfferRecord {
    const rec: OfferRecord = {
      correlationId,
      title,
      sentAt: new Date().toISOString(),
      status: 'sent',
      offerId: null,
      assignedLid: null,
    };
    this.records.push(rec);
    if (this.records.length > CAP) this.records.splice(0, this.records.length - CAP);
    return rec;
  }

  all(): readonly OfferRecord[] {
    return this.records;
  }

  private find(correlationId: string | null, offerId: string | null): OfferRecord | null {
    if (correlationId !== null) {
      const byCorr = this.records.find((r) => r.correlationId === correlationId);
      if (byCorr) return byCorr;
    }
    if (offerId !== null) {
      const byOffer = this.records.find((r) => r.offerId === offerId);
      if (byOffer) return byOffer;
    }
    return null;
  }

  /** record:ack — payload { offer_id, correlation_id? }. */
  resolveAck(payload: unknown): OfferRecord | null {
    const p = asObject(payload);
    if (!p) return null;
    const rec = this.find(str(p['correlation_id']), str(p['offer_id']));
    if (!rec) return null;
    if (typeof p['offer_id'] === 'string') rec.offerId = p['offer_id'];
    // Never regress a final status (accept/dismiss can race a late ack).
    if (rec.status === 'sent') rec.status = 'acked';
    return rec;
  }

  /** record:reject — payload { offer_id, reason, correlation_id? }. */
  resolveReject(payload: unknown): OfferRecord | null {
    const p = asObject(payload);
    if (!p) return null;
    const rec = this.find(str(p['correlation_id']), str(p['offer_id']));
    if (!rec) return null;
    rec.status = 'dismissed';
    return rec;
  }

  /** record:accept — payload { offer_id, assigned_lid, correlation_id? }. */
  resolveAccept(payload: unknown): OfferRecord | null {
    const p = asObject(payload);
    if (!p) return null;
    const rec = this.find(str(p['correlation_id']), str(p['offer_id']));
    if (!rec) return null;
    if (typeof p['assigned_lid'] === 'string') rec.assignedLid = p['assigned_lid'];
    rec.status = 'accepted';
    return rec;
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** UI label for a status (shared by B1/B2). */
export function offerStatusLabel(rec: OfferRecord): string {
  switch (rec.status) {
    case 'sent':
      return '⏳ 送信済み(ack 待ち — 旧 host は ack を返しません)';
    case 'acked':
      return `📬 到達(offer_id=${rec.offerId ?? '?'})— user の accept 待ち`;
    case 'accepted':
      return `✅ 受理(lid=${rec.assignedLid ?? '?'})`;
    case 'dismissed':
      return '✖ 却下(dismiss)';
  }
}
