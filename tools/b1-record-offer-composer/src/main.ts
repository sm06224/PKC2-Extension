/**
 * B1 record-offer-composer — generic record:offer sender (issue #23).
 *
 * A form for composing a `record:offer` for any archetype, with a live
 * envelope preview, send history, and inbound `record:reject` display.
 * Connects via the shared host-connection block (launcher opener / embedding
 * parent / own PKC2 iframe).
 *
 * v1 spec limits surfaced honestly in the UI:
 *  - no response means "pending or lost" (fire-and-forget, §8.3);
 *  - record:reject carries a host-generated offer_id the sender never saw,
 *    so it cannot be correlated to a specific offer (SR-02 / SR-04);
 *  - no tags / assets in the offer payload (SR-08 / §6.3).
 */

import '../../shared/base.css';
import './composer.css';
import { helpButton } from '../../shared/help';
import { buildEnvelope, makeCorrelationId } from '../../shared/envelope';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { OfferTracker, offerStatusLabel } from '../../shared/offer-track';
import { button, el, fieldRow, selectInput, textInput } from '../../shared/ui';
import { ARCHETYPES, buildOfferPayload, emptyOfferForm, type OfferFormState } from './offer-form';

const TOOL_NAME = 'pkc2-offer-composer';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const DRAFT_KEY = 'pkc2-b1-offer-composer:draft';

interface HistoryEntry {
  at: string;
  text: string;
  kind: 'sent' | 'reject' | 'note';
}

const history: HistoryEntry[] = [];
const HISTORY_CAP = 100;
/** Offer round-trip status (correlation_id ベース、PKC2#804)。 */
const tracker = new OfferTracker();
let offersHost: HTMLElement | null = null;

function renderOffers(): void {
  if (!offersHost) return;
  offersHost.replaceChildren();
  const records = tracker.all();
  if (records.length === 0) {
    offersHost.appendChild(el('div', 'pkc-hint', 'まだ送信していません'));
    return;
  }
  for (const rec of [...records].reverse()) {
    const row = el('div', `pkc-history-row pkc-offer-${rec.status}`);
    const t = new Date(rec.sentAt);
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    row.appendChild(el('span', 'pkc-history-time', hh));
    row.appendChild(el('span', 'pkc-history-text', `"${rec.title}" — ${offerStatusLabel(rec)}`));
    offersHost.appendChild(row);
  }
}

let conn: HostConnection | null = null;
let historyHost: HTMLElement | null = null;
let previewHost: HTMLElement | null = null;
let errorHost: HTMLElement | null = null;

/* ------------------------------------------------------------- helpers */

function pushHistory(kind: HistoryEntry['kind'], text: string): void {
  history.push({ at: new Date().toISOString(), kind, text });
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  renderHistory();
}

function renderHistory(): void {
  if (!historyHost) return;
  historyHost.replaceChildren();
  if (history.length === 0) {
    historyHost.appendChild(el('div', 'pkc-hint', 'まだ送信していません'));
    return;
  }
  for (const h of [...history].reverse()) {
    const row = el('div', `pkc-history-row pkc-history-${h.kind}`);
    const t = new Date(h.at);
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    row.appendChild(el('span', 'pkc-history-time', hh));
    row.appendChild(el('span', 'pkc-history-text', h.text));
    historyHost.appendChild(row);
  }
}

/* --------------------------------------------------------------- draft */

interface FormInputs {
  archetype: HTMLSelectElement;
  title: HTMLInputElement;
  body: HTMLTextAreaElement;
  todoDescription: HTMLInputElement;
  todoDate: HTMLInputElement;
  sourceUrl: HTMLInputElement;
  capturedNow: HTMLInputElement;
  tags: HTMLInputElement;
  colorTag: HTMLInputElement;
  mimeType: HTMLInputElement;
  filename: HTMLInputElement;
  kind: HTMLInputElement;
  thumbnailUrl: HTMLInputElement;
  provider: HTMLInputElement;
  durationSec: HTMLInputElement;
  pages: HTMLInputElement;
  isbn: HTMLInputElement;
}

function readForm(i: FormInputs): OfferFormState {
  return {
    archetype: i.archetype.value,
    title: i.title.value,
    body: i.body.value,
    todoDescription: i.todoDescription.value,
    todoDate: i.todoDate.value,
    sourceUrl: i.sourceUrl.value,
    capturedNow: i.capturedNow.checked,
    tags: i.tags.value,
    colorTag: i.colorTag.value,
    mimeType: i.mimeType.value,
    filename: i.filename.value,
    kind: i.kind.value,
    thumbnailUrl: i.thumbnailUrl.value,
    provider: i.provider.value,
    durationSec: i.durationSec.value,
    pages: i.pages.value,
    isbn: i.isbn.value,
  };
}

function writeForm(i: FormInputs, f: OfferFormState): void {
  i.archetype.value = f.archetype;
  i.title.value = f.title;
  i.body.value = f.body;
  i.todoDescription.value = f.todoDescription;
  i.todoDate.value = f.todoDate;
  i.sourceUrl.value = f.sourceUrl;
  i.capturedNow.checked = f.capturedNow;
  i.tags.value = f.tags;
  i.colorTag.value = f.colorTag;
  i.mimeType.value = f.mimeType;
  i.filename.value = f.filename;
  i.kind.value = f.kind;
  i.thumbnailUrl.value = f.thumbnailUrl;
  i.provider.value = f.provider;
  i.durationSec.value = f.durationSec;
  i.pages.value = f.pages;
  i.isbn.value = f.isbn;
}

function saveDraft(f: OfferFormState): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
  } catch {
    /* best-effort */
  }
}

function loadDraft(): OfferFormState | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const base = emptyOfferForm();
    const parsed = JSON.parse(raw) as Partial<Record<keyof OfferFormState, unknown>>;
    for (const key of Object.keys(base) as Array<keyof OfferFormState>) {
      const v = parsed[key];
      if (key === 'capturedNow') {
        if (typeof v === 'boolean') base[key] = v;
      } else if (typeof v === 'string') {
        (base as unknown as Record<string, unknown>)[key] = v;
      }
    }
    return base;
  } catch {
    return null;
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* best-effort */
  }
}

/* ---------------------------------------------------------------- mount */

export function mountComposer(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-composer-root';

  const header = el('div', 'pkc-composer-header');
  header.setAttribute('data-pkc-region', 'composer-header');
  header.appendChild(el('span', 'pkc-composer-title', '✉️ PKC2 Record Offer Composer'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — record:offer を組み立てて送信(accept はホスト側 UI で行われます)`),
  );
  header.appendChild(helpButton('Record Offer Composer', {
    what: "任意 archetype の record:offer を組み立てて送る汎用フォームです。送信前に envelope 全体をプレビューできます。",
    how: [
      "PKC2 に接続する",
      "archetype と title / body を入力(todo を選ぶと description + 期日の専用フィールドに切替)",
      "下のプレビューで実際に送られる envelope を確認",
      "Send record:offer → PKC2 側の banner で accept",
      "「オファー状況」で 送信済み → 到達 → 受理 / 却下 を追跡",
    ],
    flow: [
      "record:offer は提案であり、host 側で人が accept して初めて entry が作られます(spec §6.2)",
      "correlation_id を自動付与 — 対応 host(PKC2#804)は ack / accept / reject に echo を返し、状況がライブ更新されます。旧 host では従来どおり相関不能の注記になります",
    ],
    notes: [
      "tags / color_tag は v1.x で送信可能(PKC2#805 — 件数 ≤20・各 ≤64 文字)。assets の同送は引き続き禁止",
      "body cap 262,144 UTF-16 units",
      "入力はドラフトとして localStorage に自動保存(「フォームをクリア」で削除)",
    ],
  }));
  root.appendChild(header);

  conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (text) => pushHistory('note', text),
    onEnvelope: (inbound) => {
      if (!inbound.viaHost) return;
      const { type, payload } = inbound.envelope;
      // PKC2#804(v1.x): ack / accept / reject を correlation_id で相関。
      if (type === 'record:ack') {
        if (tracker.resolveAck(payload)) renderOffers();
        else pushHistory('note', 'record:ack 受信(相関先なし — 別ツールの offer か、追跡上限超過)');
        return;
      }
      if (type === 'record:accept') {
        if (tracker.resolveAccept(payload)) renderOffers();
        else pushHistory('note', 'record:accept 受信(相関先なし)');
        return;
      }
      if (type === 'record:reject') {
        if (tracker.resolveReject(payload)) {
          renderOffers();
          return;
        }
        // 旧 host(correlation echo なし・ack なし)へのフォールバック表示。
        const p = payload as { offer_id?: unknown; reason?: unknown } | null;
        const offerId = p && typeof p.offer_id === 'string' ? p.offer_id : '?';
        const reason = p && typeof p.reason === 'string' ? p.reason : '?';
        pushHistory(
          'reject',
          `record:reject 受信(offer_id=${offerId}, reason=${reason})— 旧 host は correlation echo が無いため、どの offer かは特定できません(PKC2#804 対応 host で解消)`,
        );
      }
    },
  });
  root.appendChild(conn.root);

  // ---- form
  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'composer-form');
  form.appendChild(el('div', 'pkc-panel-heading', 'record:offer'));

  const inputs: FormInputs = {
    archetype: selectInput([
      { value: '', label: '(指定なし)' },
      ...ARCHETYPES.map((a) => ({ value: a, label: a })),
    ]),
    title: textInput('title(必須)'),
    body: document.createElement('textarea'),
    todoDescription: textInput('やること(必須)'),
    todoDate: document.createElement('input'),
    sourceUrl: textInput('https://…(任意、body 先頭に provenance 注入)'),
    capturedNow: document.createElement('input'),
    tags: textInput('カンマ区切り(≤20 件・各 ≤64 文字、PKC2#805)'),
    colorTag: textInput('色 ID(未知 ID は host 側で null 化、offer は生きる)'),
    mimeType: textInput('MIME(SR-14 — host 実装中、現行は無視)'),
    filename: textInput('ファイル名(SR-14 — 同上)'),
    kind: textInput('video / audio / book など'),
    thumbnailUrl: textInput('https://…'),
    provider: textInput('YouTube / Kindle など'),
    durationSec: textInput('秒数(整数)'),
    pages: textInput('ページ数(整数)'),
    isbn: textInput('ISBN'),
  };
  inputs.archetype.value = 'text';
  inputs.body.rows = 6;
  inputs.body.placeholder = 'body(markdown 可)';
  inputs.todoDate.type = 'date';
  inputs.capturedNow.type = 'checkbox';

  const todoRows = el('div', 'pkc-todo-rows');
  todoRows.appendChild(fieldRow('description', inputs.todoDescription));
  todoRows.appendChild(fieldRow('date', inputs.todoDate));
  todoRows.appendChild(
    el('div', 'pkc-hint', 'body は {"status":"open","description":…,"date":…,"archived":false} の JSON 文字列として送信されます'),
  );
  const bodyRow = fieldRow('body', inputs.body);

  const capturedLabel = el('label', 'pkc-inline-check');
  capturedLabel.appendChild(inputs.capturedNow);
  capturedLabel.appendChild(document.createTextNode(' captured_at = 送信時刻'));

  const v11 = el('details', 'pkc-v11-details');
  v11.appendChild(el('summary', 'pkc-hint', 'v1.1 capture フィールド(任意 — 古い host では無視されます)'));
  v11.appendChild(fieldRow('kind', inputs.kind));
  v11.appendChild(fieldRow('thumbnail_url', inputs.thumbnailUrl));
  v11.appendChild(fieldRow('provider', inputs.provider));
  v11.appendChild(fieldRow('duration_sec', inputs.durationSec));
  v11.appendChild(fieldRow('pages', inputs.pages));
  v11.appendChild(fieldRow('isbn', inputs.isbn));

  form.appendChild(fieldRow('archetype', inputs.archetype));
  form.appendChild(fieldRow('title', inputs.title));
  form.appendChild(bodyRow);
  form.appendChild(todoRows);
  form.appendChild(fieldRow('source_url', inputs.sourceUrl));
  form.appendChild(capturedLabel);
  form.appendChild(fieldRow('tags', inputs.tags));
  form.appendChild(fieldRow('color_tag', inputs.colorTag));
  const sr14 = el('details', 'pkc-v11-details');
  sr14.appendChild(el('summary', 'pkc-hint', 'SR-14 フィールド(mime_type / filename — host 実装中)'));
  sr14.appendChild(fieldRow('mime_type', inputs.mimeType));
  sr14.appendChild(fieldRow('filename', inputs.filename));
  form.appendChild(sr14);
  form.appendChild(v11);

  errorHost = el('div', 'pkc-form-error');
  errorHost.setAttribute('data-pkc-region', 'composer-error');
  const btnRow = el('div', 'pkc-btn-row');
  btnRow.appendChild(
    button('Send record:offer', 'pkc-btn', () => {
      if (!errorHost || !conn) return;
      errorHost.textContent = '';
      const r = buildOfferPayload(readForm(inputs), () => new Date().toISOString());
      if (!r.ok) {
        errorHost.textContent = r.error;
        return;
      }
      const correlationId = makeCorrelationId();
      const sent = conn.send('record:offer', r.payload, { correlationId });
      if (sent) {
        tracker.begin(correlationId, String(r.payload['title']));
        renderOffers();
      }
    }),
  );
  btnRow.appendChild(
    button('フォームをクリア', 'pkc-btn-small', () => {
      writeForm(inputs, emptyOfferForm());
      clearDraft();
      syncArchetype();
      updatePreview();
    }, 'ドラフト保存も削除します'),
  );
  form.appendChild(btnRow);
  form.appendChild(errorHost);
  form.appendChild(
    el('div', 'pkc-hint', 'tags / color_tag は v1.x で受理されます(PKC2#805、同意 banner に表示)。assets の同送は引き続き禁止 — 実体の受け渡しは host-push(pkc:deliver、PKC2#806)へ。入力はドラフトとして localStorage に自動保存'),
  );
  root.appendChild(form);

  // ---- preview
  const preview = el('div', 'pkc-panel');
  preview.setAttribute('data-pkc-region', 'composer-preview');
  preview.appendChild(el('div', 'pkc-panel-heading', '送信 envelope プレビュー'));
  previewHost = el('pre', 'pkc-preview-pre');
  preview.appendChild(previewHost);
  root.appendChild(preview);

  // ---- offer status (correlation_id round-trip, PKC2#804)
  const offers = el('div', 'pkc-panel');
  offers.setAttribute('data-pkc-region', 'composer-offers');
  offers.appendChild(el('div', 'pkc-panel-heading', 'オファー状況(correlation_id で host の ack/accept/reject と相関)'));
  offersHost = el('div', 'pkc-history-list');
  offers.appendChild(offersHost);
  root.appendChild(offers);

  // ---- history
  const hist = el('div', 'pkc-panel');
  hist.setAttribute('data-pkc-region', 'composer-history');
  hist.appendChild(el('div', 'pkc-panel-heading', '履歴(このセッションのみ)'));
  historyHost = el('div', 'pkc-history-list');
  hist.appendChild(historyHost);
  root.appendChild(hist);

  function syncArchetype(): void {
    const isTodo = inputs.archetype.value === 'todo';
    todoRows.hidden = !isTodo;
    bodyRow.hidden = isTodo;
  }

  function updatePreview(): void {
    if (!previewHost) return;
    const r = buildOfferPayload(readForm(inputs), () => '(送信時に確定)');
    if (!r.ok) {
      previewHost.textContent = `— ${r.error}`;
      return;
    }
    const envelope = buildEnvelope('record:offer', r.payload, { sourceId: TOOL_ID });
    previewHost.textContent = JSON.stringify({ ...envelope, timestamp: '(送信時に確定)' }, null, 2);
  }

  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  form.addEventListener('input', () => {
    syncArchetype();
    updatePreview();
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(readForm(inputs)), 400);
  });

  const draft = loadDraft();
  if (draft) {
    writeForm(inputs, draft);
    pushHistory('note', 'ドラフトを復元しました');
  }
  syncArchetype();
  updatePreview();
  renderOffers();
  renderHistory();
  return { conn };
}

const mountTarget = document.getElementById('composer-root');
if (mountTarget) mountComposer(mountTarget);
