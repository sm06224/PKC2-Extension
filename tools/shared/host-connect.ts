/**
 * Host connection component — the block every sender tool needs: detect the
 * host PKC2 (launcher opener / embedding parent), or let the user load a
 * `pkc2.html` into an iframe; do the ping/pong handshake with retries; expose
 * a typed `send`, the PongProfile, and validated inbound envelopes.
 *
 * Security mirrors the A1 probe: targetOrigin pinned (opaque file:// → '*'),
 * inbound tagged with `viaHost` (`event.source` identity + origin), embed
 * URLs scheme-allowlisted, and **nothing is ever executed from a message** —
 * consumers receive parsed data only.
 */

import {
  buildEnvelope,
  parsePongProfile,
  validateEnvelope,
  type Envelope,
  type MessageType,
  type PongProfile,
} from './envelope';
import {
  detectAmbientHost,
  iframeLink,
  isEmbeddableUrl,
  isFromHost,
  sendToHost,
  type HostLink,
} from './host-link';
import { button, el, textInput } from './ui';

export type ConnStatus = 'no-host' | 'probing' | 'connected' | 'silent';

export interface InboundEnvelope {
  envelope: Envelope;
  origin: string;
  /** Came from the linked host window (source identity + origin). */
  viaHost: boolean;
}

export interface HostConnectionOptions {
  /** envelope.source_id for everything this tool sends. */
  sourceId: string;
  /** Default URL for the embed input. */
  defaultEmbedUrl?: string;
  onStatus?: (status: ConnStatus, profile: PongProfile | null, latencyMs: number | null) => void;
  /** Every *valid* inbound v1 envelope (including pong). */
  onEnvelope?: (inbound: InboundEnvelope) => void;
  /** Probe-style notes the tool may want to surface. */
  onNote?: (text: string) => void;
}

export interface HostConnection {
  /** Connection panel: status row + (standalone only) embed controls. */
  readonly root: HTMLElement;
  getLink(): HostLink | null;
  getStatus(): ConnStatus;
  getProfile(): PongProfile | null;
  /** Build + send a v1 envelope. Returns it, or null when no host / send failed. */
  send(type: MessageType, payload: unknown, opts?: { correlationId?: string }): Envelope | null;
  ping(): void;
  /** Exposed for tests and for tools that manage their own link. */
  attachLink(link: HostLink): void;
  handleMessage(ev: Pick<MessageEvent, 'data' | 'origin' | 'source'>): void;
  dispose(): void;
}

const PING_RETRY_MS = 2500;
const PING_MAX_TRIES = 5;

export function createHostConnection(opts: HostConnectionOptions): HostConnection {
  let link: HostLink | null = null;
  let status: ConnStatus = 'no-host';
  let profile: PongProfile | null = null;
  let latencyMs: number | null = null;
  let pendingPing: { sentAt: number } | null = null;
  let pingTries = 0;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let embedFrame: HTMLIFrameElement | null = null;

  const root = el('div', 'pkc-conn-panel');
  root.setAttribute('data-pkc-region', 'host-connection');
  const statusRow = el('div', 'pkc-conn-status-row');
  const dot = el('span', 'pkc-status-dot');
  const text = el('span', 'pkc-status-text');
  statusRow.appendChild(dot);
  statusRow.appendChild(text);
  statusRow.appendChild(button('Ping', 'pkc-btn-small', () => ping()));
  root.appendChild(statusRow);

  const embedBox = el('div', 'pkc-conn-embed');
  const url = textInput('./pkc2.html');
  url.value = opts.defaultEmbedUrl ?? './pkc2.html';
  const framePane = el('div', 'pkc-embed-pane');
  framePane.hidden = true;
  const load = button('PKC2 を読み込み', 'pkc-btn', () => {
    const u = url.value.trim();
    if (u === '') return;
    if (!isEmbeddableUrl(u)) {
      opts.onNote?.(`読み込み拒否: http(s) / file / 相対パス以外の URL は埋め込めません(${u})`);
      return;
    }
    if (embedFrame) embedFrame.remove();
    const frame = document.createElement('iframe');
    frame.className = 'pkc-embed-frame';
    frame.title = 'PKC2 host';
    frame.addEventListener('load', () => {
      const l = iframeLink(frame, u);
      if (!l) return;
      attachLink(l);
      opts.onNote?.(`iframe 読み込み完了: ${u} — ping 開始`);
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
    link = null;
    profile = null;
    latencyMs = null;
    setStatus('no-host');
  });
  const controls = el('div', 'pkc-embed-controls');
  controls.appendChild(url);
  controls.appendChild(load);
  controls.appendChild(eject);
  embedBox.appendChild(controls);
  embedBox.appendChild(framePane);
  root.appendChild(embedBox);

  function setStatus(s: ConnStatus): void {
    status = s;
    dot.setAttribute('data-pkc-status', s);
    const label = link ? link.label : 'ホストなし';
    const texts: Record<ConnStatus, string> = {
      'no-host': `未接続 — ${label}`,
      probing: `接続確認中… — ${label}`,
      connected: `接続 — ${label}` + (profile ? `(${profile.app_id} v${profile.version}, embedded=${String(profile.embedded)})` : ''),
      silent: `応答なし — ${label}`,
    };
    text.textContent = texts[s];
    opts.onStatus?.(s, profile, latencyMs);
  }

  function attachLink(l: HostLink): void {
    link = l;
    profile = null;
    latencyMs = null;
    if (l.mode !== 'iframe') embedBox.hidden = true;
    setStatus('probing');
    ping();
  }

  function send(
    type: MessageType,
    payload: unknown,
    sendOpts?: { correlationId?: string },
  ): Envelope | null {
    if (!link) {
      opts.onNote?.(`送信失敗: ホスト未接続(${type})`);
      return null;
    }
    const envelope = buildEnvelope(type, payload, {
      sourceId: opts.sourceId,
      ...(sendOpts?.correlationId !== undefined ? { correlationId: sendOpts.correlationId } : {}),
    });
    return sendToHost(link, envelope) ? envelope : null;
  }

  function ping(): void {
    if (!link) {
      opts.onNote?.('Ping 送信失敗: ホスト未接続');
      return;
    }
    pendingPing = { sentAt: performance.now() };
    pingTries++;
    send('ping', {});
    if (pingTimer !== null) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      pingTimer = null;
      if (status === 'connected') return;
      if (pingTries < PING_MAX_TRIES) {
        ping();
      } else {
        setStatus('silent');
        opts.onNote?.(`pong 応答なし(${PING_MAX_TRIES} 回試行)。ホストの origin allowlist(same-origin のみ)/ bridge 未 mount を確認してください`);
      }
    }, PING_RETRY_MS);
  }

  function handleMessage(ev: Pick<MessageEvent, 'data' | 'origin' | 'source'>): void {
    const data: unknown = ev.data;
    if (data === null || typeof data !== 'object') return;
    if ((data as { protocol?: unknown }).protocol !== 'pkc-message') return;
    const v = validateEnvelope(data);
    if (!v.ok) return; // sender tools only consume valid envelopes (probe A1 shows invalid ones)
    const viaHost = link !== null && isFromHost(link, ev as MessageEvent);
    if (v.envelope.type === 'pong' && viaHost) {
      if (pendingPing) {
        latencyMs = Math.round(performance.now() - pendingPing.sentAt);
        pendingPing = null;
      }
      if (pingTimer !== null) {
        clearTimeout(pingTimer);
        pingTimer = null;
      }
      pingTries = 0;
      profile = parsePongProfile(v.envelope.payload);
      setStatus('connected');
    }
    opts.onEnvelope?.({ envelope: v.envelope, origin: ev.origin, viaHost });
  }

  const listener = (ev: MessageEvent): void => handleMessage(ev);
  window.addEventListener('message', listener);

  const ambient = detectAmbientHost();
  if (ambient) {
    attachLink(ambient);
  } else {
    setStatus('no-host');
  }

  return {
    root,
    getLink: () => link,
    getStatus: () => status,
    getProfile: () => profile,
    send,
    ping,
    attachLink,
    handleMessage,
    dispose: () => {
      window.removeEventListener('message', listener);
      if (pingTimer !== null) clearTimeout(pingTimer);
      if (embedFrame) embedFrame.remove();
    },
  };
}
