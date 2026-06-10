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

import { BODY_SIZE_CAP_BYTES, utf8ByteLength } from '../../shared/envelope';
import { serializeTodoBody } from '../../shared/todo-body';

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
  const bytes = utf8ByteLength(body);
  if (bytes > BODY_SIZE_CAP_BYTES) {
    return {
      ok: false,
      error: `body が size cap 超過: ${bytes.toLocaleString()} / ${BODY_SIZE_CAP_BYTES.toLocaleString()} bytes(spec §7.2.2)`,
    };
  }

  const payload: Record<string, unknown> = { title, body };
  if (f.archetype !== '') payload['archetype'] = f.archetype;
  if (f.sourceUrl.trim() !== '') payload['source_url'] = f.sourceUrl.trim();
  if (f.capturedNow) payload['captured_at'] = nowIso();

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
