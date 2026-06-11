/**
 * A3 capability-matrix — compare multiple PKC2 hosts (issue #20).
 *
 * Loads any number of `pkc2.html` URLs into hidden iframes, pings each, and
 * tabulates the PongProfiles side by side (app_id / version /
 * schema_version / embedded / capabilities). Useful for comparing builds —
 * e.g. "which of my PKC2 copies already advertises record:ack?".
 *
 * Each probe is identity-bound to its own iframe (`event.source ===
 * frame.contentWindow` + expected origin), so rows can never cross-talk.
 */

import '../../shared/base.css';
import './matrix.css';
import { buildEnvelope, parsePongProfile, validateEnvelope, type PongProfile } from '../../shared/envelope';
import { expectedOriginForUrl, isEmbeddableUrl } from '../../shared/host-link';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-capability-matrix';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const PING_RETRY_MS = 2500;
const PING_MAX_TRIES = 5;
const MAX_TARGETS = 8;

interface Target {
  id: number;
  url: string;
  frame: HTMLIFrameElement;
  expectedOrigin: string | null;
  status: 'loading' | 'probing' | 'connected' | 'silent';
  profile: PongProfile | null;
  latencyMs: number | null;
  tries: number;
  pingSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const targets: Target[] = [];
let nextId = 1;
let tableHost: HTMLElement | null = null;
let frameDock: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;

function note(text: string): void {
  if (noteEl) noteEl.textContent = text;
}

function pingTarget(t: Target): void {
  const w = t.frame.contentWindow;
  if (!w) return;
  t.tries += 1;
  t.pingSentAt = performance.now();
  t.status = 'probing';
  try {
    w.postMessage(
      buildEnvelope('ping', {}, { sourceId: `${TOOL_ID}#${t.id}` }),
      t.expectedOrigin ?? '*',
    );
  } catch {
    /* frame torn down */
  }
  if (t.timer !== null) clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    t.timer = null;
    if (t.status === 'connected') return;
    if (t.tries < PING_MAX_TRIES) pingTarget(t);
    else {
      t.status = 'silent';
      renderTable();
    }
  }, PING_RETRY_MS);
  renderTable();
}

function onWindowMessage(ev: MessageEvent): void {
  // Identity-bind each pong to the iframe that produced it.
  const t = targets.find((x) => x.frame.contentWindow !== null && ev.source === x.frame.contentWindow);
  if (!t) return;
  const expected = t.expectedOrigin ?? 'null';
  if (ev.origin !== expected) return;
  const v = validateEnvelope(ev.data);
  if (!v.ok || v.envelope.type !== 'pong') return;
  t.latencyMs = Math.round(performance.now() - t.pingSentAt);
  t.profile = parsePongProfile(v.envelope.payload);
  t.status = 'connected';
  if (t.timer !== null) {
    clearTimeout(t.timer);
    t.timer = null;
  }
  renderTable();
}

function addTarget(url: string): void {
  if (targets.length >= MAX_TARGETS) {
    note(`対象は最大 ${MAX_TARGETS} 件です`);
    return;
  }
  if (!isEmbeddableUrl(url)) {
    note(`読み込み拒否: http(s) / file / 相対パス以外は不可(${url})`);
    return;
  }
  const frame = document.createElement('iframe');
  frame.className = 'pkc-matrix-frame';
  frame.title = `PKC2 target ${nextId}`;
  const t: Target = {
    id: nextId++,
    url,
    frame,
    expectedOrigin: expectedOriginForUrl(url),
    status: 'loading',
    profile: null,
    latencyMs: null,
    tries: 0,
    pingSentAt: 0,
    timer: null,
  };
  frame.addEventListener('load', () => pingTarget(t));
  frame.src = url;
  frameDock?.appendChild(frame);
  targets.push(t);
  renderTable();
}

function removeTarget(id: number): void {
  const i = targets.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = targets[i]!;
  if (t.timer !== null) clearTimeout(t.timer);
  t.frame.remove();
  targets.splice(i, 1);
  renderTable();
}

/** Union of all capabilities across connected targets (table columns). */
export function capabilityUnion(profiles: ReadonlyArray<PongProfile | null>): string[] {
  const set = new Set<string>();
  for (const p of profiles) for (const c of p?.capabilities ?? []) set.add(c);
  return [...set].sort();
}

function renderTable(): void {
  if (!tableHost) return;
  tableHost.replaceChildren();
  if (targets.length === 0) {
    tableHost.appendChild(el('div', 'pkc-hint', 'URL を追加すると各 PKC2 の profile を並べて比較できます'));
    return;
  }
  const caps = capabilityUnion(targets.map((t) => t.profile));
  const table = document.createElement('table');
  table.className = 'pkc-matrix-table';
  table.setAttribute('data-pkc-region', 'matrix-table');

  const head = document.createElement('tr');
  for (const h of ['#', 'URL', '状態', 'app_id', 'version', 'schema', 'embedded', ...caps, 'latency', '']) {
    head.appendChild(el('th', undefined, h));
  }
  table.appendChild(head);

  for (const t of targets) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', undefined, String(t.id)));
    tr.appendChild(el('td', 'pkc-matrix-url', t.url));
    const statusLabel = { loading: '読込中', probing: 'ping 中', connected: '✓ 接続', silent: '✕ 応答なし' }[t.status];
    tr.appendChild(el('td', `pkc-matrix-${t.status}`, statusLabel));
    tr.appendChild(el('td', undefined, t.profile?.app_id ?? '—'));
    tr.appendChild(el('td', undefined, t.profile?.version ?? '—'));
    tr.appendChild(el('td', undefined, t.profile ? String(t.profile.schema_version) : '—'));
    tr.appendChild(el('td', undefined, t.profile ? String(t.profile.embedded) : '—'));
    for (const c of caps) {
      tr.appendChild(el('td', 'pkc-matrix-cap', t.profile ? (t.profile.capabilities.includes(c) ? '✓' : '—') : ''));
    }
    tr.appendChild(el('td', undefined, t.latencyMs !== null ? `${t.latencyMs}ms` : '—'));
    const act = document.createElement('td');
    act.appendChild(button('✕', 'pkc-btn-small', () => removeTarget(t.id), 'この対象を外す'));
    act.appendChild(button('再ping', 'pkc-btn-small', () => {
      t.tries = 0;
      pingTarget(t);
    }));
    tr.appendChild(act);
    table.appendChild(tr);
  }
  tableHost.appendChild(table);
}

export function mountMatrix(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-matrix-root';

  const header = el('div', 'pkc-matrix-header');
  header.setAttribute('data-pkc-region', 'matrix-header');
  header.appendChild(el('span', 'pkc-matrix-title', '🧮 PKC2 Capability Matrix'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 複数 PKC2 の PongProfile を比較(各行は iframe identity に束縛)`),
  );
  root.appendChild(header);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'matrix-add');
  const url = textInput('./pkc2.html(比較したい PKC2 の URL)');
  const row = el('div', 'pkc-btn-row');
  row.appendChild(url);
  row.appendChild(
    button('追加して ping', 'pkc-btn', () => {
      const u = url.value.trim();
      if (u !== '') addTarget(u);
    }),
  );
  panel.appendChild(row);
  noteEl = el('div', 'pkc-hint');
  noteEl.setAttribute('data-pkc-region', 'matrix-note');
  panel.appendChild(noteEl);
  root.appendChild(panel);

  const result = el('div', 'pkc-panel');
  tableHost = el('div', 'pkc-matrix-tablehost');
  result.appendChild(tableHost);
  root.appendChild(result);

  frameDock = el('div', 'pkc-matrix-dock');
  frameDock.setAttribute('data-pkc-region', 'matrix-dock');
  root.appendChild(frameDock);

  window.addEventListener('message', onWindowMessage);
  renderTable();
}

const mountTarget = document.getElementById('matrix-root');
if (mountTarget) mountMatrix(mountTarget);
