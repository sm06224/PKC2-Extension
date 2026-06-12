/**
 * record:offer payload assembly — pure and unit-testable.
 *
 * Mirrors `RecordOfferPayload` (PKC-Message v1 spec §7.2.1 + the v1.1
 * capture-profile additive fields §9.2.1). Notable v1 limits this form
 * surfaces instead of hiding:
 *  - no `tags` field exists in the offer payload (SR-08 territory);
 *  - assets cannot be attached (spec §6.3 forbids it);
 *  - todo bodies are JSON-as-string in PKC2's own shape.
 */

import { BODY_SIZE_CAP_UTF16_UNITS } from '../../shared/envelope';
import { serializeTodoBody } from '../../shared/todo-body';

/** #805 のホスト上限をミラー(超過は payload 全体 reject される)。 */
export const MAX_OFFER_TAGS = 20;
export const MAX_OFFER_TAG_LENGTH = 64;

/**
 * カンマ区切り → tags 配列(trim / 空除去 / 重複除去 — host の
 * validateOfferTags と同じ正規化)。上限違反は error。Pure.
 */
export function parseTagsInput(raw: string): { ok: true; tags: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (t === '' || seen.has(t)) continue;
    if (t.length > MAX_OFFER_TAG_LENGTH) {
      return { ok: false, error: `tag が長すぎます(≤ ${MAX_OFFER_TAG_LENGTH} 文字): ${t.slice(0, 20)}…` };
    }
    seen.add(t);
    out.push(t);
  }
  if (out.length > MAX_OFFER_TAGS) return { ok: false, error: `tags は ${MAX_OFFER_TAGS} 件まで(現在 ${out.length})` };
  return { ok: true, tags: out };
}

export { serializeTodoBody };

export const ARCHETYPES = [
  'text',
  'textlog',
  'todo',
  'form',
  'attachment',
  'folder',
  'generic',
  'opaque',
] as const;

export interface OfferFormState {
  /** '' = omit (host defaults the archetype). */
  archetype: string;
  title: string;
  /** Body for non-todo archetypes. */
  body: string;
  /** Todo-specific inputs (used when archetype === 'todo'). */
  todoDescription: string;
  /** YYYY-MM-DD or ''. */
  todoDate: string;
  sourceUrl: string;
  capturedNow: boolean;
  /** #805 additive: カンマ区切り tags / color_tag('' = omit)。 */
  tags: string;
  colorTag: string;
  /** SR-14 先行(host 実装中): mime_type / filename('' = omit)。 */
  mimeType: string;
  filename: string;
  /** v1.1 capture-profile optional fields (all '' = omit). */
  kind: string;
  thumbnailUrl: string;
  provider: string;
  durationSec: string;
  pages: string;
  isbn: string;
}

export function emptyOfferForm(): OfferFormState {
  return {
    archetype: 'text',
    title: '',
    body: '',
    todoDescription: '',
    todoDate: '',
    sourceUrl: '',
    capturedNow: false,
    tags: '',
    colorTag: '',
    mimeType: '',
    filename: '',
    kind: '',
    thumbnailUrl: '',
    provider: '',
    durationSec: '',
    pages: '',
    isbn: '',
  };
}

export type OfferBuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export function buildOfferPayload(f: OfferFormState, nowIso: () => string): OfferBuildResult {
  const title = f.title.trim();
  if (title === '') return { ok: false, error: 'title は必須です(spec §7.2.1)' };
  if (f.archetype !== '' && !(ARCHETYPES as readonly string[]).includes(f.archetype)) {
    return { ok: false, error: `未知の archetype: ${f.archetype}` };
  }

  let body: string;
  if (f.archetype === 'todo') {
    const desc = f.todoDescription.trim();
    if (desc === '') return { ok: false, error: 'todo は description が必須です' };
    body = serializeTodoBody(desc, f.todoDate.trim());
  } else {
    body = f.body;
  }
  const units = body.length;
  if (units > BODY_SIZE_CAP_UTF16_UNITS) {
    return {
      ok: false,
      error: `body が size cap 超過: ${units.toLocaleString()} / ${BODY_SIZE_CAP_UTF16_UNITS.toLocaleString()} UTF-16 code units(spec §7.2.2 — byte ではない)`,
    };
  }

  const payload: Record<string, unknown> = { title, body };
  if (f.archetype !== '') payload['archetype'] = f.archetype;
  if (f.sourceUrl.trim() !== '') payload['source_url'] = f.sourceUrl.trim();
  if (f.capturedNow) payload['captured_at'] = nowIso();

  // #805 additive: tags / color_tag(host 上限をミラーし、reject される
  // payload を送らない)。
  if (f.tags.trim() !== '') {
    const r = parseTagsInput(f.tags);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.tags.length > 0) payload['tags'] = r.tags;
  }
  if (f.colorTag.trim() !== '') payload['color_tag'] = f.colorTag.trim();
  // SR-14(mime_type / filename — PKC2#814 で host 着地済み)。
  if (f.mimeType.trim() !== '') payload['mime_type'] = f.mimeType.trim();
  if (f.filename.trim() !== '') payload['filename'] = f.filename.trim();

  // v1.1 additive fields — only included when present (old hosts ignore them).
  if (f.kind.trim() !== '') payload['kind'] = f.kind.trim();
  if (f.thumbnailUrl.trim() !== '') payload['thumbnail_url'] = f.thumbnailUrl.trim();
  if (f.provider.trim() !== '') payload['provider'] = f.provider.trim();
  if (f.isbn.trim() !== '') payload['isbn'] = f.isbn.trim();
  for (const [field, key] of [
    ['durationSec', 'duration_sec'],
    ['pages', 'pages'],
  ] as const) {
    const raw = f[field].trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: `${key} は 0 以上の整数で入力してください(現在: ${raw})` };
    }
    payload[key] = n;
  }

  return { ok: true, payload };
}
