/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  detectAmbientHost,
  expectedEventOrigin,
  expectedOriginForUrl,
  isEmbeddableUrl,
  isFromHost,
  targetOriginOf,
  type HostLink,
} from '../../tools/a1-message-probe/src/host-link';

describe('expectedOriginForUrl', () => {
  it('resolves http(s) URLs to their exact origin', () => {
    expect(expectedOriginForUrl('https://example.com/pkc2.html', 'https://other.test/')).toBe('https://example.com');
    expect(expectedOriginForUrl('./pkc2.html', 'https://example.com/dir/probe.html')).toBe('https://example.com');
  });

  it('treats file:/data:/about: as opaque (null origin)', () => {
    expect(expectedOriginForUrl('file:///tmp/pkc2.html', 'file:///tmp/probe.html')).toBeNull();
    expect(expectedOriginForUrl('./pkc2.html', 'file:///tmp/probe.html')).toBeNull();
    expect(expectedOriginForUrl('about:blank', 'https://example.com/')).toBeNull();
  });

  it('returns null for unparsable URLs instead of throwing', () => {
    expect(expectedOriginForUrl('http://[invalid', 'https://example.com/')).toBeNull();
  });
});

describe('isEmbeddableUrl — scheme allowlist for the embed iframe', () => {
  it('allows http(s), file and relative URLs', () => {
    expect(isEmbeddableUrl('https://example.com/pkc2.html', 'https://x.test/')).toBe(true);
    expect(isEmbeddableUrl('./pkc2.html', 'file:///tmp/probe.html')).toBe(true);
    expect(isEmbeddableUrl('file:///tmp/pkc2.html', 'file:///tmp/probe.html')).toBe(true);
  });

  it('blocks javascript:/data:/blob: (self-XSS / non-host documents)', () => {
    expect(isEmbeddableUrl('javascript:alert(1)', 'https://x.test/')).toBe(false);
    expect(isEmbeddableUrl('data:text/html,<b>x</b>', 'https://x.test/')).toBe(false);
    expect(isEmbeddableUrl('blob:https://x.test/abc', 'https://x.test/')).toBe(false);
  });
});

describe('origin pinning', () => {
  const fakeWindow = {} as Window;

  it('pins targetOrigin to the exact origin when known', () => {
    const link: HostLink = { mode: 'iframe', hostWindow: fakeWindow, expectedOrigin: 'https://example.com', label: 'x' };
    expect(targetOriginOf(link)).toBe('https://example.com');
    expect(expectedEventOrigin(link)).toBe('https://example.com');
  });

  it("falls back to '*' / 'null' only for opaque origins", () => {
    const link: HostLink = { mode: 'opener', hostWindow: fakeWindow, expectedOrigin: null, label: 'x' };
    expect(targetOriginOf(link)).toBe('*');
    expect(expectedEventOrigin(link)).toBe('null');
  });
});

describe('isFromHost — source identity + origin must both match', () => {
  const host = {} as Window;
  const stranger = {} as Window;
  const link: HostLink = { mode: 'iframe', hostWindow: host, expectedOrigin: 'https://example.com', label: 'x' };

  it('accepts only the linked window with the expected origin', () => {
    expect(isFromHost(link, { source: host, origin: 'https://example.com' } as MessageEvent)).toBe(true);
  });

  it('rejects a different window even with the right origin', () => {
    expect(isFromHost(link, { source: stranger, origin: 'https://example.com' } as MessageEvent)).toBe(false);
  });

  it('rejects the right window with a wrong origin', () => {
    expect(isFromHost(link, { source: host, origin: 'https://evil.test' } as MessageEvent)).toBe(false);
  });
});

describe('detectAmbientHost', () => {
  it('returns null when standalone (no opener, parent === self)', () => {
    expect(detectAmbientHost()).toBeNull();
  });
});
