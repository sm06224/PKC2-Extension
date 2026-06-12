/**
 * A1 message-probe — PKC-Message v1 debugging probe (issue #18).
 *
 * Connects to a host PKC2 over `postMessage` and shows everything that
 * flows: ping/pong + PongProfile, every envelope (valid or rejected, with
 * the spec §4.2 reject code), plus optional non-PKC traffic. Includes composers for record:offer /
 * export:request / navigate / custom and a raw-envelope sender for
 * deliberately exercising host-side validation.
 *
 * Topologies: launcher popup (opener) / embedded (parent) / probe-as-parent
 * with a PKC2 iframe (the embedded-only export:request works there).
 *
 * Security posture (debug tool, but hardened):
 *  - all runtime data rendered via textContent — never innerHTML;
 *  - targetOrigin pinned to the expected origin ('*' only for opaque file://);
 *  - received messages are displayed, never acted on (except parsing the
 *    pong profile into plain strings);
 *  - log is capped; long strings truncated at display time;
 *  - localStorage holds UI prefs only, never message content.
 */

import './probe.css';
import { helpButton } from '../../shared/help';
import {
  BODY_SIZE_CAP_UTF16_UNITS,
  buildEnvelope,
  formatReasons,
  makeCorrelationId,
  parsePongProfile,
  validateEnvelope,
  type MessageType,
  type PongProfile,
} from '../../shared/envelope';
import {
  detectAmbientHost,
  iframeLink,
  isEmbeddableUrl,
  isFromHost,
  sendToHost,
  type HostLink,
} from '../../shared/host-link';
import { MessageLog, safeStringify, type EntryKind, type LogEntry } from './log-model';
import { renderJsonTree } from './json-tree';

const TOOL_NAME = 'pkc2-message-probe';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const PREFS_KEY = 'pkc2-a1-message-probe:prefs';
const PING_RETRY_MS = 2500;
const PING_MAX_TRIES = 5;

type Status = 'no-host' | 'probing' | 'connected' | 'silent';

interface ProbeState {
  link: HostLink | null;
  status: Status;
  profile: PongProfile | null;
  latencyMs: number | null;
  showForeign: boolean;
  /** null = show all types. */
  typeFilter: Set<string> | null;
  search: string;
  iframeUrl: string;
}

const log = new MessageLog(500);
const state: ProbeState = {
  link: null,
  status: 'no-host',
  profile: null,
  latencyMs: null,
  showForeign: false,
  typeFilter: null,
  search: '',
  iframeUrl: './pkc2.html',
};

let statusDot: HTMLElement | null = null;
let statusText: HTMLElement | null = null;
let profileHost: HTMLElement | null = null;
let logBody: HTMLElement | null = null;
let logMeta: HTMLElement | null = null;
let typeFilterHost: HTMLElement | null = null;
let embedSection: HTMLElement | null = null;
let embedFrame: HTMLIFrameElement | null = null;
let pendingPing: { sentAt: number } | null = null;
let pingTries = 0;
let pingTimer: ReturnType<typeof setTimeout> | null = null;
let renderQueued = false;
let knownTypeKeys = '';

/* ---------------------------------------------------------------- utils */

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function loadPrefs(): void {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { showForeign?: unknown; iframeUrl?: unknown };
    if (typeof p.showForeign === 'boolean') state.showForeign = p.showForeign;
    if (typeof p.iframeUrl === 'string' && p.iframeUrl.length < 2048) state.iframeUrl = p.iframeUrl;
  } catch {
    /* prefs are best-effort */
  }
}

function savePrefs(): void {
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ showForeign: state.showForeign, iframeUrl: state.iframeUrl }),
    );
  } catch {
    /* prefs are best-effort */
  }
}

function note(text: string, data?: unknown): void {
  log.push({
    at: new Date().toISOString(),
    direction: 'info',
    kind: 'note',
    type: '(note)',
    sourceId: null,
    targetId: null,
    origin: '-',
    viaHost: false,
    detail: text,
    data: data ?? text,
  });
  scheduleLogRender();
}

/* ------------------------------------------------------------ messaging */

function sendEnvelope(type: MessageType, payload: unknown, opts?: { correlationId?: string }): void {
  if (!state.link) {
    note(`送信失敗: ホスト未接続(${type})`);
    return;
  }
  const envelope = buildEnvelope(type, payload, {
    sourceId: TOOL_ID,
    ...(opts?.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
  });
  const ok = sendToHost(state.link, envelope);
  log.push({
    at: envelope.timestamp,
    direction: 'out',
    kind: 'pkc',
    type: envelope.type,
    sourceId: envelope.source_id,
    targetId: envelope.target_id,
    origin: '-',
    viaHost: true,
    data: envelope,
    ...(ok ? {} : { detail: '送信時に例外(チャネル断)' }),
  });
  scheduleLogRender();
}

function sendRaw(data: unknown, label: string): void {
  if (!state.link) {
    note(`送信失敗: ホスト未接続(${label})`);
    return;
  }
  const ok = sendToHost(state.link, data);
  const v = validateEnvelope(data);
  log.push({
    at: new Date().toISOString(),
    direction: 'out',
    kind: v.ok ? 'pkc' : 'pkc-invalid',
    type: v.ok ? v.envelope.type : label,
    sourceId: null,
    targetId: null,
    origin: '-',
    viaHost: true,
    data,
    ...(v.ok ? {} : { rejectCode: v.reasons[0]!.code, detail: `ローカル検証: ${formatReasons(v.reasons)}` }),
    ...(ok ? {} : { detail: '送信時に例外(チャネル断)' }),
  });
  scheduleLogRender();
}

function sendPing(manual: boolean): void {
  if (!state.link) {
    note('Ping 送信失敗: ホスト未接続');
    return;
  }
  if (manual) pingTries = 0;
  pendingPing = { sentAt: performance.now() };
  pingTries++;
  setStatus(state.status === 'connected' ? 'connected' : 'probing');
  sendEnvelope('ping', {});
  if (pingTimer !== null) clearTimeout(pingTimer);
  pingTimer = setTimeout(() => {
    pingTimer = null;
    if (state.status === 'connected') return;
    if (pingTries < PING_MAX_TRIES) {
      sendPing(false);
    } else {
      setStatus('silent');
      note(`pong 応答なし(${PING_MAX_TRIES} 回試行)。ホスト側の origin allowlist(same-origin のみ)/ bridge 未 mount / URL を確認してください`);
    }
  }, PING_RETRY_MS);
}

function classifyForeign(data: unknown): string {
  // host-push 体系の pkc-ext v1 チャネル(PKC2#816)は別 wire — foreign
  // 扱いだが type ラベルで識別できるようにする。
  if (data !== null && typeof data === 'object') {
    const d = data as { pkc?: unknown; t?: unknown };
    if (d.pkc === 'pkc-ext' && typeof d.t === 'string') return `ext:${d.t}`;
  }
  return '(non-pkc)';
}

function onWindowMessage(ev: MessageEvent): void {
  // The probe only ever *displays* what arrives — it never acts on message
  // content, so logging unsolicited traffic is safe by design.
  const data: unknown = ev.data;
  const viaHost = state.link !== null && isFromHost(state.link, ev);
  const isPkcShaped =
    data !== null && typeof data === 'object' && (data as { protocol?: unknown }).protocol === 'pkc-message';

  if (!isPkcShaped) {
    log.push({
      at: new Date().toISOString(),
      direction: 'in',
      kind: 'foreign',
      type: classifyForeign(data),
      sourceId: null,
      targetId: null,
      origin: ev.origin,
      viaHost,
      data,
    });
    scheduleLogRender();
    return;
  }

  const v = validateEnvelope(data);
  const kind: EntryKind = v.ok ? 'pkc' : 'pkc-invalid';
  const d = data as Record<string, unknown>;
  const rawType = d['type'];
  log.push({
    at: new Date().toISOString(),
    direction: 'in',
    kind,
    type: typeof rawType === 'string' && rawType !== '' ? rawType : '(?)',
    sourceId: typeof d['source_id'] === 'string' ? d['source_id'] : null,
    targetId: typeof d['target_id'] === 'string' ? d['target_id'] : null,
    origin: ev.origin,
    viaHost,
    data,
    ...(v.ok ? {} : { rejectCode: v.reasons[0]!.code, detail: formatReasons(v.reasons) }),
  });

  if (v.ok && v.envelope.type === 'pong' && viaHost) {
    if (pendingPing) {
      state.latencyMs = Math.round(performance.now() - pendingPing.sentAt);
      pendingPing = null;
    }
    if (pingTimer !== null) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
    state.profile = parsePongProfile(v.envelope.payload);
    setStatus('connected');
    renderProfile();
  }
  scheduleLogRender();
}

/* ------------------------------------------------------------ rendering */

function setStatus(s: Status): void {
  state.status = s;
  if (!statusDot || !statusText) return;
  statusDot.setAttribute('data-pkc-status', s);
  const linkLabel = state.link ? state.link.label : 'ホストなし';
  const texts: Record<Status, string> = {
    'no-host': `未接続 — ${linkLabel}`,
    probing: `接続確認中… — ${linkLabel}`,
    connected: `接続 — ${linkLabel}`,
    silent: `応答なし — ${linkLabel}`,
  };
  statusText.textContent = texts[s];
}

function renderProfile(): void {
  if (!profileHost) return;
  profileHost.replaceChildren();
  const heading = el('div', 'pkc-panel-heading', 'ホスト PongProfile');
  profileHost.appendChild(heading);
  if (!state.profile) {
    profileHost.appendChild(el('div', 'pkc-profile-empty', 'pong 未受信(Send Ping で確認)'));
    return;
  }
  const p = state.profile;
  const rows: Array<[string, string]> = [
    ['app_id', p.app_id],
    ['version', p.version],
    ['schema_version', p.schema_version >= 0 ? String(p.schema_version) : '(不明)'],
    ['embedded', String(p.embedded)],
  ];
  if (state.latencyMs !== null) rows.push(['latency', `${state.latencyMs} ms`]);
  const table = el('div', 'pkc-profile-table');
  for (const [k, vText] of rows) {
    const row = el('div', 'pkc-profile-row');
    row.appendChild(el('span', 'pkc-profile-key', k));
    row.appendChild(el('span', 'pkc-profile-value', vText));
    table.appendChild(row);
  }
  profileHost.appendChild(table);
  const capRow = el('div', 'pkc-profile-caps');
  capRow.appendChild(el('span', 'pkc-profile-key', 'capabilities'));
  if (p.capabilities.length === 0) {
    capRow.appendChild(el('span', 'pkc-profile-value', '(なし)'));
  } else {
    for (const c of p.capabilities) capRow.appendChild(el('span', 'pkc-cap-chip', c));
  }
  profileHost.appendChild(capRow);
  if (!p.embedded) {
    profileHost.appendChild(
      el('div', 'pkc-profile-hint', 'embedded=false: export:request は capability gate で受理されません(spec §7.5.3)'),
    );
  }
}

function scheduleLogRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderLog();
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function renderLogRow(e: LogEntry): HTMLElement {
  const row = el('div', 'pkc-log-row');
  row.setAttribute('data-pkc-kind', e.kind);

  const head = el('div', 'pkc-log-head');
  head.appendChild(el('span', 'pkc-log-time', formatTime(e.at)));
  head.appendChild(el('span', `pkc-log-dir pkc-log-dir-${e.direction}`, e.direction === 'out' ? '→' : e.direction === 'in' ? '←' : '・'));
  head.appendChild(el('span', 'pkc-log-type', e.type));
  if (e.kind === 'pkc-invalid' && e.rejectCode) {
    head.appendChild(el('span', 'pkc-log-reject', e.rejectCode));
  }
  if (e.viaHost) {
    const host = el('span', 'pkc-log-via', '●host');
    host.title = 'リンク済みホスト window と source 一致';
    head.appendChild(host);
  }
  const ids = `${e.sourceId ?? 'null'} → ${e.targetId ?? 'null'}`;
  head.appendChild(el('span', 'pkc-log-ids', ids));
  if (e.direction === 'in') head.appendChild(el('span', 'pkc-log-origin', `origin=${e.origin}`));
  row.appendChild(head);

  if (e.detail) row.appendChild(el('div', 'pkc-log-detail', e.detail));

  if (e.kind !== 'note') {
    // Lazy tree: built on first expand so 500 rows stay cheap.
    const details = document.createElement('details');
    details.className = 'pkc-log-payload';
    const summary = document.createElement('summary');
    summary.textContent = 'data';
    details.appendChild(summary);
    let built = false;
    details.addEventListener('toggle', () => {
      if (details.open && !built) {
        built = true;
        details.appendChild(renderJsonTree(e.data));
      }
    });
    row.appendChild(details);
  }
  return row;
}

function renderLog(): void {
  if (!logBody || !logMeta) return;
  const entries = log.filtered({
    types: state.typeFilter,
    search: state.search,
    showForeign: state.showForeign,
  });
  const frag = document.createDocumentFragment();
  for (const e of entries) frag.appendChild(renderLogRow(e));
  logBody.replaceChildren(frag);
  logBody.scrollTop = logBody.scrollHeight;
  const total = log.all().length;
  logMeta.textContent =
    `${entries.length} / ${total} 件` + (log.dropped > 0 ? `(古い ${log.dropped} 回分は容量上限で破棄)` : '');
  renderTypeFilter();
}

function renderTypeFilter(): void {
  if (!typeFilterHost) return;
  const types = log.seenTypes();
  const key = types.join('|');
  if (key === knownTypeKeys && typeFilterHost.childElementCount > 0) return; // unchanged
  knownTypeKeys = key;
  typeFilterHost.replaceChildren();
  if (types.length === 0) return;
  typeFilterHost.appendChild(el('span', 'pkc-filter-label', 'type:'));
  for (const t of types) {
    const label = el('label', 'pkc-filter-type');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.typeFilter === null || state.typeFilter.has(t);
    cb.addEventListener('change', () => {
      const checked = new Set<string>();
      typeFilterHost?.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => {
        if (c.checked && c.dataset['type']) checked.add(c.dataset['type']);
      });
      state.typeFilter = checked.size === types.length ? null : checked;
      renderLog();
    });
    cb.dataset['type'] = t;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${t}`));
    typeFilterHost.appendChild(label);
  }
  const reset = button('全て', 'pkc-btn-small', () => {
    state.typeFilter = null;
    knownTypeKeys = '';
    renderLog();
  });
  typeFilterHost.appendChild(reset);
}

/* ------------------------------------------------------------ composers */

function fieldRow(labelText: string, input: HTMLElement): HTMLElement {
  const row = el('div', 'pkc-field-row');
  const label = el('label', 'pkc-field-label', labelText);
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function textInput(placeholder: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.placeholder = placeholder;
  return i;
}

function buildOfferComposer(): HTMLElement {
  const box = el('details', 'pkc-composer') as HTMLDetailsElement;
  box.open = true;
  const summary = el('summary', 'pkc-composer-heading', 'record:offer(entry 作成を提案)');
  box.appendChild(summary);

  const title = textInput('title(必須)');
  const body = document.createElement('textarea');
  body.placeholder = 'body';
  body.rows = 4;
  const bytes = el('div', 'pkc-byte-counter', '0 bytes');
  body.addEventListener('input', () => {
    const n = body.value.length;
    bytes.textContent = `${n.toLocaleString()} / ${BODY_SIZE_CAP_UTF16_UNITS.toLocaleString()} UTF-16 units(byte ではない)`;
    bytes.classList.toggle('pkc-over-cap', n > BODY_SIZE_CAP_UTF16_UNITS);
  });
  const archetype = document.createElement('select');
  for (const a of ['(指定なし)', 'text', 'textlog', 'todo', 'form', 'attachment', 'folder', 'generic', 'opaque']) {
    const opt = document.createElement('option');
    opt.value = a === '(指定なし)' ? '' : a;
    opt.textContent = a;
    archetype.appendChild(opt);
  }
  const sourceUrl = textInput('source_url(任意、body 先頭に provenance 注入)');
  const capturedNow = document.createElement('input');
  capturedNow.type = 'checkbox';
  const capturedLabel = el('label', 'pkc-inline-check');
  capturedLabel.appendChild(capturedNow);
  capturedLabel.appendChild(document.createTextNode(' captured_at = 送信時刻'));

  const err = el('div', 'pkc-form-error', '');
  const send = button('Send record:offer', 'pkc-btn', () => {
    err.textContent = '';
    if (title.value.trim() === '') {
      err.textContent = 'title は必須です(spec §7.2.1)';
      return;
    }
    if (body.value.length > BODY_SIZE_CAP_UTF16_UNITS) {
      err.textContent = `body が size cap(${BODY_SIZE_CAP_UTF16_UNITS.toLocaleString()} UTF-16 units)超過 — host 側で reject されます(spec §7.2.2)。送信は中止しました`;
      return;
    }
    const payload: Record<string, unknown> = { title: title.value, body: body.value };
    if (archetype.value !== '') payload['archetype'] = archetype.value;
    if (sourceUrl.value.trim() !== '') payload['source_url'] = sourceUrl.value.trim();
    if (capturedNow.checked) payload['captured_at'] = new Date().toISOString();
    // PKC2#804(v1.x): correlation_id を自動付与 — 対応 host は ack/reject/
    // accept に echo するので、ログ上で往復を突き合わせられる。
    sendEnvelope('record:offer', payload, { correlationId: makeCorrelationId() });
  });

  box.appendChild(fieldRow('title', title));
  box.appendChild(fieldRow('body', body));
  box.appendChild(bytes);
  box.appendChild(fieldRow('archetype', archetype));
  box.appendChild(fieldRow('source_url', sourceUrl));
  box.appendChild(capturedLabel);
  box.appendChild(send);
  box.appendChild(err);
  box.appendChild(
    el('div', 'pkc-composer-hint', '応答はありません(fire-and-forget、spec §8.3)。ホスト側 UI の PendingOffer banner を確認してください。dismiss されると record:reject が届きます'),
  );
  return box;
}

function buildExportComposer(): HTMLElement {
  const box = el('details', 'pkc-composer') as HTMLDetailsElement;
  box.appendChild(el('summary', 'pkc-composer-heading', 'export:request(container HTML を要求)'));
  const filename = textInput('filename(任意)');
  const send = button('Send export:request', 'pkc-btn', () => {
    const payload: Record<string, unknown> = {};
    if (filename.value.trim() !== '') payload['filename'] = filename.value.trim();
    sendEnvelope('export:request', payload);
  });
  box.appendChild(fieldRow('filename', filename));
  box.appendChild(send);
  box.appendChild(
    el('div', 'pkc-composer-hint', 'embedded-only(spec §7.5.3)。ホストが standalone のときは応答なし=capability gate の観測になります。embedded のときは export:result(数 MB になりうる)が返ります'),
  );
  return box;
}

function buildNavigateComposer(): HTMLElement {
  const box = el('details', 'pkc-composer') as HTMLDetailsElement;
  box.appendChild(el('summary', 'pkc-composer-heading', 'navigate(entry へ移動を要求)'));
  const lid = textInput('target_lid');
  const view = document.createElement('select');
  for (const vName of ['(指定なし)', 'detail', 'calendar', 'kanban']) {
    const opt = document.createElement('option');
    opt.value = vName === '(指定なし)' ? '' : vName;
    opt.textContent = vName;
    view.appendChild(opt);
  }
  const send = button('Send navigate', 'pkc-btn', () => {
    const payload: Record<string, unknown> = {};
    if (lid.value.trim() !== '') payload['target_lid'] = lid.value.trim();
    if (view.value !== '') payload['view'] = view.value;
    sendEnvelope('navigate', payload);
  });
  box.appendChild(fieldRow('target_lid', lid));
  box.appendChild(fieldRow('view', view));
  box.appendChild(send);
  box.appendChild(el('div', 'pkc-composer-hint', 'handler 任意登録(spec §7.6)— 未登録 host では握り潰されます'));
  return box;
}

function buildCustomComposer(): HTMLElement {
  const box = el('details', 'pkc-composer') as HTMLDetailsElement;
  box.appendChild(el('summary', 'pkc-composer-heading', 'custom(任意 payload)'));
  const payload = document.createElement('textarea');
  payload.rows = 3;
  payload.placeholder = '{"command": "..."}';
  const err = el('div', 'pkc-form-error', '');
  const send = button('Send custom', 'pkc-btn', () => {
    err.textContent = '';
    try {
      const parsed: unknown = payload.value.trim() === '' ? {} : JSON.parse(payload.value);
      sendEnvelope('custom', parsed);
    } catch (ex) {
      err.textContent = `payload が JSON として不正: ${ex instanceof Error ? ex.message : String(ex)}`;
    }
  });
  box.appendChild(fieldRow('payload', payload));
  box.appendChild(send);
  box.appendChild(err);
  return box;
}

function buildAdvanced(): HTMLElement {
  const box = el('details', 'pkc-composer') as HTMLDetailsElement;
  box.appendChild(el('summary', 'pkc-composer-heading', 'Advanced(raw envelope / 自己テスト)'));

  const raw = document.createElement('textarea');
  raw.rows = 6;
  raw.placeholder = safeStringify(buildEnvelope('ping', {}, { sourceId: TOOL_ID }), 2);
  const result = el('div', 'pkc-form-error', '');
  const validate = button('ローカル検証', 'pkc-btn-small', () => {
    try {
      const v = validateEnvelope(JSON.parse(raw.value));
      result.textContent = v.ok ? `OK: 有効な v1 envelope(type=${v.envelope.type})` : formatReasons(v.reasons);
      result.classList.toggle('pkc-form-ok', v.ok);
    } catch (ex) {
      result.classList.remove('pkc-form-ok');
      result.textContent = `JSON parse 失敗: ${ex instanceof Error ? ex.message : String(ex)}`;
    }
  });
  const send = button('そのまま送信', 'pkc-btn-small', () => {
    result.classList.remove('pkc-form-ok');
    try {
      sendRaw(JSON.parse(raw.value), '(raw)');
      result.textContent = '送信しました(ホスト側 reject は console.warn のみ — 応答は返りません)';
    } catch (ex) {
      result.textContent = `JSON parse 失敗: ${ex instanceof Error ? ex.message : String(ex)}`;
    }
  }, '不正 envelope の送信でホスト側 validation を観測できます');

  const selfTest = button('ローカル自己テスト', 'pkc-btn-small', () => {
    const samples: Array<[string, unknown]> = [
      ['有効な ping', buildEnvelope('ping', {}, { sourceId: TOOL_ID })],
      ['WRONG_VERSION の例', { protocol: 'pkc-message', version: 2, type: 'ping', source_id: null, target_id: null, payload: {}, timestamp: new Date().toISOString() }],
      ['INVALID_TYPE の例', { protocol: 'pkc-message', version: 1, type: 'hack:me', source_id: null, target_id: null, payload: {}, timestamp: new Date().toISOString() }],
    ];
    for (const [label, sample] of samples) {
      const v = validateEnvelope(sample);
      note(`自己テスト ${label} → ${v.ok ? 'OK' : formatReasons(v.reasons)}`, sample);
    }
  }, 'ホストなしで envelope validation の挙動を確認');

  box.appendChild(fieldRow('envelope', raw));
  const btnRow = el('div', 'pkc-btn-row');
  btnRow.appendChild(validate);
  btnRow.appendChild(send);
  btnRow.appendChild(selfTest);
  box.appendChild(btnRow);
  box.appendChild(result);
  return box;
}

/* --------------------------------------------------------- iframe embed */

function buildEmbedSection(): HTMLElement {
  const box = el('div', 'pkc-embed-section');
  box.appendChild(el('div', 'pkc-panel-heading', 'PKC2 を iframe で読み込む(standalone 時)'));
  const url = textInput('./pkc2.html');
  url.value = state.iframeUrl;
  const framePane = el('div', 'pkc-embed-pane');
  framePane.hidden = true;

  const load = button('読み込み', 'pkc-btn', () => {
    const u = url.value.trim();
    if (u === '') return;
    if (!isEmbeddableUrl(u)) {
      note(`読み込み拒否: http(s) / file / 相対パス以外の URL は埋め込めません(${u})`);
      return;
    }
    state.iframeUrl = u;
    savePrefs();
    if (embedFrame) embedFrame.remove();
    const frame = document.createElement('iframe');
    frame.className = 'pkc-embed-frame';
    frame.title = 'PKC2 host';
    frame.addEventListener('load', () => {
      const link = iframeLink(frame, u);
      if (!link) return;
      state.link = link;
      state.profile = null;
      state.latencyMs = null;
      renderProfile();
      note(`iframe 読み込み完了: ${u} — ping 開始(PKC2 の bridge は ready 後に mount されるため数回 retry します)`);
      sendPing(true);
    });
    frame.src = u;
    framePane.appendChild(frame);
    framePane.hidden = false;
    embedFrame = frame;
    setStatus('probing');
  });
  const eject = button('切断', 'pkc-btn-small', () => {
    if (embedFrame) {
      embedFrame.remove();
      embedFrame = null;
    }
    framePane.hidden = true;
    state.link = null;
    state.profile = null;
    renderProfile();
    setStatus('no-host');
  });

  const row = el('div', 'pkc-embed-controls');
  row.appendChild(url);
  row.appendChild(load);
  row.appendChild(eject);
  box.appendChild(row);
  box.appendChild(
    el('div', 'pkc-composer-hint', 'ホストの origin allowlist は same-origin のみ(+ file:// の "null" opt-in)。この HTML と pkc2.html を同じ場所に置いて開くのが確実です。embedded ホストには export:request も通ります'),
  );
  box.appendChild(framePane);
  return box;
}

/* ----------------------------------------------------------- info panel */

function toggleInfoPanel(): void {
  const existing = document.querySelector('[data-pkc-region="probe-info"]');
  if (existing) {
    existing.remove();
    return;
  }
  const panel = el('div', 'pkc-info-panel');
  panel.setAttribute('data-pkc-region', 'probe-info');
  panel.appendChild(button('✕', 'pkc-info-close', () => panel.remove(), '閉じる'));
  panel.appendChild(el('div', 'pkc-panel-heading', `${TOOL_NAME} v${TOOL_VERSION}`));
  const lines = [
    'PKC-Message v1(pkc-message-api-v1.md)のデバッグプローブ。',
    'ランタイム依存: なし(外部ライブラリ・外部通信なし)。',
    'license: AGPL-3.0 / PKC2-Extension repo issue #18',
    '受信メッセージは表示のみで、内容に基づく動作は一切しません。',
    'ログは画面上のみ(最大 500 件)。localStorage には UI 設定のみ保存。',
  ];
  for (const l of lines) panel.appendChild(el('div', 'pkc-info-line', l));
  document.body.appendChild(panel);
}

/* ---------------------------------------------------------------- mount */

export function mountProbe(root: HTMLElement): void {
  loadPrefs();
  root.replaceChildren();
  root.className = 'pkc-probe-root';

  // Header
  const header = el('div', 'pkc-probe-header');
  header.setAttribute('data-pkc-region', 'probe-header');
  header.appendChild(el('span', 'pkc-probe-title', '🔍 PKC2 Message Probe'));
  statusDot = el('span', 'pkc-status-dot');
  statusText = el('span', 'pkc-status-text');
  header.appendChild(statusDot);
  header.appendChild(statusText);
  header.appendChild(button('Send Ping', 'pkc-btn', () => sendPing(true)));
  header.appendChild(button('ⓘ', 'pkc-btn-small', toggleInfoPanel, 'バージョン・方針'));
  header.appendChild(helpButton('Message Probe', {
    what: "PKC-Message v1 の全トラフィックを観測し、各種メッセージを手動送信できるデバッグプローブです。",
    how: [
      "PKC2 に接続する(下の「接続方法」参照)",
      "Send Ping で疎通確認 — 左に PongProfile(version / capabilities)が出ます",
      "左のフォームから record:offer / export:request / navigate / custom を送信",
      "右のログで往復を確認(type フィルタ・検索・Copy All — Copy All の JSON は A5 replay-player で再生できます)",
      "Advanced: 不正な envelope を意図的に送って host 側 validation の挙動を観測",
    ],
    flow: [
      "ping → pong は host の bridge が自動応答します",
      "record:offer → host に PendingOffer banner が出て、accept は人が押します(自動では書き込まれません)",
      "受信は event.source の同一性 + origin で host を判定し、表示するだけ(内容で動作は変わりません)",
    ],
    notes: [
      "非 PKC メッセージ(pkc-ext チャネル等)は既定で非表示 — トグルで表示(ext:projection / ext:deliver として識別表示)",
      "ログは最大 500 件(古い順に破棄)",
      "export:request は embedded ホスト限定 — launcher 起動の standalone ホストでは無応答になります(それ自体が capability gate の観測)",
    ],
  }));
  root.appendChild(header);

  // Main split: left controls / right log
  const main = el('div', 'pkc-probe-main');
  const left = el('div', 'pkc-probe-left');
  profileHost = el('div', 'pkc-profile-panel');
  profileHost.setAttribute('data-pkc-region', 'probe-profile');
  left.appendChild(profileHost);
  embedSection = buildEmbedSection();
  left.appendChild(embedSection);
  left.appendChild(buildOfferComposer());
  left.appendChild(buildExportComposer());
  left.appendChild(buildNavigateComposer());
  left.appendChild(buildCustomComposer());
  left.appendChild(buildAdvanced());
  main.appendChild(left);

  const right = el('div', 'pkc-probe-right');
  right.setAttribute('data-pkc-region', 'probe-log');
  const filters = el('div', 'pkc-log-filters');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '🔍 ログ検索(type / id / data)';
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = search.value;
      renderLog();
    }, 150);
  });
  filters.appendChild(search);

  const foreignLabel = el('label', 'pkc-inline-check');
  const foreignToggle = document.createElement('input');
  foreignToggle.type = 'checkbox';
  foreignToggle.checked = state.showForeign;
  foreignToggle.setAttribute('data-pkc-field', 'show-foreign');
  foreignToggle.addEventListener('change', () => {
    state.showForeign = foreignToggle.checked;
    savePrefs();
    renderLog();
  });
  foreignLabel.appendChild(foreignToggle);
  foreignLabel.appendChild(document.createTextNode(' 非 PKC メッセージも表示'));
  filters.appendChild(foreignLabel);

  filters.appendChild(
    button('Copy All', 'pkc-btn-small', () => {
      const entries = log.filtered({ types: state.typeFilter, search: state.search, showForeign: state.showForeign });
      const text = safeStringify(entries, 2);
      void copyText(text);
    }, '表示中のログを JSON でコピー'),
  );
  filters.appendChild(
    button('Clear', 'pkc-btn-small', () => {
      log.clear();
      knownTypeKeys = '';
      renderLog();
    }),
  );
  right.appendChild(filters);

  typeFilterHost = el('div', 'pkc-log-typefilter');
  right.appendChild(typeFilterHost);

  logBody = el('div', 'pkc-log-body');
  right.appendChild(logBody);
  logMeta = el('div', 'pkc-log-meta');
  right.appendChild(logMeta);
  main.appendChild(right);
  root.appendChild(main);

  // Listen + connect
  window.addEventListener('message', onWindowMessage);
  const ambient = detectAmbientHost();
  if (ambient) {
    state.link = ambient;
    embedSection.hidden = true;
    setStatus('probing');
    note(`ホスト検出: ${ambient.label} — ping 開始`);
    sendPing(true);
  } else {
    setStatus('no-host');
    note('standalone 起動 — 下の「PKC2 を iframe で読み込む」からホストに接続するか、PKC2 の launcher から開いてください');
  }
  renderProfile();
  renderLog();
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    note(`コピーしました(${text.length.toLocaleString()} 文字)`);
  } catch {
    // file:// など clipboard API が使えない環境では選択用ダイアログに出す
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.className = 'pkc-copy-fallback';
    document.body.appendChild(ta);
    ta.select();
    note('clipboard API 不可 — 右下に選択済みテキストを表示しました(Ctrl+C 後、クリックで閉じる)');
    ta.addEventListener('click', () => ta.remove());
  }
}

const mountTarget = document.getElementById('probe-root');
if (mountTarget) mountProbe(mountTarget);
