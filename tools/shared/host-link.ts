/**
 * Host link — where is the PKC2 we talk to, and how do we address it safely.
 *
 * Three topologies (the probe supports all of them):
 *  - `opener`: the probe was launched by PKC2's extension launcher
 *    (`window.open('') + document.write`, same-origin) — host = `window.opener`.
 *  - `parent`: the probe is embedded inside a page (e.g. PKC2's autostart
 *    iframe overlay) — host = `window.parent`.
 *  - `iframe`: the probe is the parent page and embeds a `pkc2.html` in an
 *    iframe (the topology PKC-Message v1 formally covers; `export:request`
 *    is embedded-only and works here) — host = `iframe.contentWindow`.
 *
 * Security: every send pins `targetOrigin` to the expected origin. Only when
 * the origin is opaque (`file://` → the string "null", which is not a valid
 * postMessage target) we fall back to `'*'` — the same trade-off the official
 * graph extension documents; the payloads this debug tool sends contain only
 * what the user typed into it. Every receive is tagged with whether it came
 * from the linked host window (`event.source` identity, unforgeable).
 */

export type LinkMode = 'opener' | 'parent' | 'iframe' | 'none';

export interface HostLink {
  readonly mode: LinkMode;
  readonly hostWindow: Window;
  /** Exact origin to address; null = opaque origin (file:// "null"). */
  readonly expectedOrigin: string | null;
  /** Human-readable label for the status bar. */
  readonly label: string;
}

/** The expected `event.origin` string for a link (opaque → "null"). */
export function expectedEventOrigin(link: HostLink): string {
  return link.expectedOrigin ?? 'null';
}

/** The postMessage targetOrigin for a link (opaque → '*'). */
export function targetOriginOf(link: HostLink): string {
  return link.expectedOrigin ?? '*';
}

/** True when this MessageEvent comes from the linked host window. */
export function isFromHost(link: HostLink, ev: MessageEvent): boolean {
  return ev.source === link.hostWindow && ev.origin === expectedEventOrigin(link);
}

/** Map a window's own origin to the "expected origin" convention. */
function ownOrigin(): string | null {
  const o = window.location.origin;
  return o && o !== 'null' ? o : null;
}

/**
 * Detect a host reachable without any user input: the opener (launcher
 * popup) or the parent (embedded). Returns null when standalone.
 */
export function detectAmbientHost(): HostLink | null {
  let opener: Window | null = null;
  try {
    opener = window.opener as Window | null;
  } catch {
    opener = null;
  }
  if (opener) {
    return { mode: 'opener', hostWindow: opener, expectedOrigin: ownOrigin(), label: 'opener(launcher 起動)' };
  }
  if (window.parent && window.parent !== window) {
    return { mode: 'parent', hostWindow: window.parent, expectedOrigin: ownOrigin(), label: 'parent(埋め込まれて起動)' };
  }
  return null;
}

/**
 * Resolve the expected origin of an iframe-embedded PKC2 from its URL.
 * Relative URLs resolve against the probe's own location. Opaque schemes
 * (file:) yield null (the "null" origin).
 */
export function expectedOriginForUrl(url: string, base?: string): string | null {
  try {
    const u = new URL(url, base ?? window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * Scheme allowlist for the embed iframe. `javascript:` would execute in the
 * probe's own origin (self-XSS) and `data:`/`blob:` cannot host a real PKC2;
 * only documents we can actually talk to are allowed.
 */
export function isEmbeddableUrl(url: string, base?: string): boolean {
  try {
    const u = new URL(url, base ?? window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
  } catch {
    return false;
  }
}

/** Build the link for a PKC2 loaded into an iframe the probe owns. */
export function iframeLink(frame: HTMLIFrameElement, url: string): HostLink | null {
  const w = frame.contentWindow;
  if (!w) return null;
  return {
    mode: 'iframe',
    hostWindow: w,
    expectedOrigin: expectedOriginForUrl(url),
    label: `iframe(${url})`,
  };
}

/**
 * Send raw structured data to the linked host. Returns false when the
 * channel is torn down mid-send.
 */
export function sendToHost(link: HostLink, data: unknown): boolean {
  try {
    link.hostWindow.postMessage(data, targetOriginOf(link));
    return true;
  } catch {
    return false;
  }
}
