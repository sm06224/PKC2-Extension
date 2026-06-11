import { describe, expect, it } from 'vitest';
import { OfferTracker, offerStatusLabel } from '../../tools/shared/offer-track';

describe('OfferTracker (PKC2#804 consumer)', () => {
  it('tracks send → ack → accept with offer_id / assigned_lid learning', () => {
    const t = new OfferTracker();
    t.begin('c-1', 'メモ');
    expect(t.all()[0]?.status).toBe('sent');

    const acked = t.resolveAck({ offer_id: 'o-9', correlation_id: 'c-1' });
    expect(acked?.status).toBe('acked');
    expect(acked?.offerId).toBe('o-9');

    const accepted = t.resolveAccept({ offer_id: 'o-9', assigned_lid: 'lid-42', correlation_id: 'c-1' });
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.assignedLid).toBe('lid-42');
    expect(offerStatusLabel(accepted!)).toContain('lid-42');
  });

  it('correlates reject via correlation_id', () => {
    const t = new OfferTracker();
    t.begin('c-2', 'x');
    expect(t.resolveReject({ offer_id: 'o-1', reason: 'dismissed', correlation_id: 'c-2' })?.status).toBe('dismissed');
  });

  it('falls back to the offer_id learned from ack when correlation is missing', () => {
    const t = new OfferTracker();
    t.begin('c-3', 'x');
    t.resolveAck({ offer_id: 'o-7', correlation_id: 'c-3' });
    // 旧コード経路などで correlation_id が落ちても offer_id で相関できる
    expect(t.resolveReject({ offer_id: 'o-7', reason: 'dismissed' })?.status).toBe('dismissed');
  });

  it('returns null for unmatched echoes (old host / foreign offer)', () => {
    const t = new OfferTracker();
    t.begin('c-4', 'x');
    expect(t.resolveReject({ offer_id: 'unknown', reason: 'dismissed' })).toBeNull();
    expect(t.resolveAck({ offer_id: 'unknown' })).toBeNull();
  });

  it('a late ack never regresses a final status', () => {
    const t = new OfferTracker();
    t.begin('c-5', 'x');
    t.resolveAccept({ offer_id: 'o-5', assigned_lid: 'lid-1', correlation_id: 'c-5' });
    const rec = t.resolveAck({ offer_id: 'o-5', correlation_id: 'c-5' });
    expect(rec?.status).toBe('accepted');
  });

  it('caps tracked offers', () => {
    const t = new OfferTracker();
    for (let i = 0; i < 120; i++) t.begin(`c-${i}`, 'x');
    expect(t.all().length).toBe(100);
    expect(t.all()[0]?.correlationId).toBe('c-20');
  });

  it('tolerates garbage payloads without throwing', () => {
    const t = new OfferTracker();
    t.begin('c-6', 'x');
    for (const bad of [null, 42, 'str', [], { offer_id: 9, correlation_id: 9 }]) {
      expect(t.resolveAck(bad)).toBeNull();
      expect(t.resolveReject(bad)).toBeNull();
      expect(t.resolveAccept(bad)).toBeNull();
    }
  });
});
