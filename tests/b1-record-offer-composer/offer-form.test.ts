import { describe, expect, it } from 'vitest';
import {
  buildOfferPayload,
  emptyOfferForm,
  serializeTodoBody,
  type OfferFormState,
} from '../../tools/b1-record-offer-composer/src/offer-form';
import { BODY_SIZE_CAP_BYTES } from '../../tools/shared/envelope';

const NOW = (): string => '2026-06-10T12:00:00.000Z';

function form(over: Partial<OfferFormState>): OfferFormState {
  return { ...emptyOfferForm(), ...over };
}

describe('buildOfferPayload', () => {
  it('requires title', () => {
    const r = buildOfferPayload(form({ title: '   ' }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('title');
  });

  it('builds a minimal text offer', () => {
    const r = buildOfferPayload(form({ title: 'T', body: 'B', archetype: 'text' }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual({ title: 'T', body: 'B', archetype: 'text' });
  });

  it('omits archetype when unspecified (host default)', () => {
    const r = buildOfferPayload(form({ title: 'T', archetype: '' }), NOW);
    expect(r.ok && !('archetype' in r.payload)).toBe(true);
  });

  it('rejects unknown archetypes', () => {
    const r = buildOfferPayload(form({ title: 'T', archetype: 'wiki' }), NOW);
    expect(r.ok).toBe(false);
  });

  it('serializes todo bodies as PKC2 todo JSON', () => {
    const r = buildOfferPayload(
      form({ title: 'T', archetype: 'todo', todoDescription: '買い物', todoDate: '2026-06-12' }),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.payload['body'] as string)).toEqual({
        status: 'open',
        description: '買い物',
        date: '2026-06-12',
        archived: false,
      });
    }
  });

  it('todo requires description; date is optional', () => {
    expect(buildOfferPayload(form({ title: 'T', archetype: 'todo' }), NOW).ok).toBe(false);
    const r = buildOfferPayload(form({ title: 'T', archetype: 'todo', todoDescription: 'x' }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.payload['body'] as string)).not.toHaveProperty('date');
  });

  it('enforces the body size cap in bytes', () => {
    const r = buildOfferPayload(form({ title: 'T', body: 'あ'.repeat(BODY_SIZE_CAP_BYTES / 3 + 1) }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('size cap');
  });

  it('includes capture fields only when present', () => {
    const r = buildOfferPayload(
      form({ title: 'T', sourceUrl: ' https://ex.test/a ', capturedNow: true, provider: 'YouTube', durationSec: '90' }),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload['source_url']).toBe('https://ex.test/a');
      expect(r.payload['captured_at']).toBe(NOW());
      expect(r.payload['provider']).toBe('YouTube');
      expect(r.payload['duration_sec']).toBe(90);
      expect(r.payload).not.toHaveProperty('kind');
      expect(r.payload).not.toHaveProperty('isbn');
      expect(r.payload).not.toHaveProperty('pages');
    }
  });

  it('rejects non-integer duration_sec / pages', () => {
    expect(buildOfferPayload(form({ title: 'T', durationSec: 'abc' }), NOW).ok).toBe(false);
    expect(buildOfferPayload(form({ title: 'T', pages: '-3' }), NOW).ok).toBe(false);
    expect(buildOfferPayload(form({ title: 'T', pages: '12.5' }), NOW).ok).toBe(false);
  });
});

describe('serializeTodoBody', () => {
  it('matches PKC2 todo body shape', () => {
    expect(JSON.parse(serializeTodoBody('d', ''))).toEqual({ status: 'open', description: 'd', archived: false });
  });
});
