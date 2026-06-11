/** @vitest-environment happy-dom */
/**
 * Boot + end-to-end parity for B1: form input → envelope preview, fake host
 * pong → connected status, inbound record:reject → visible history row.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mountComposer } from '../../tools/b1-record-offer-composer/src/main';
import type { HostConnection } from '../../tools/shared/host-connect';
import type { HostLink } from '../../tools/shared/host-link';

let root: HTMLElement;
let conn: HostConnection;
const sentToHost: unknown[] = [];
const fakeHostWindow = {
  postMessage: (data: unknown): void => {
    sentToHost.push(data);
  },
} as unknown as Window;
const fakeLink: HostLink = {
  mode: 'iframe',
  hostWindow: fakeHostWindow,
  expectedOrigin: 'http://host.test',
  label: 'fake host',
};

function envelopeFromHost(type: string, payload: unknown): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return {
    data: {
      protocol: 'pkc-message',
      version: 1,
      type,
      source_id: null,
      target_id: 'ext:test',
      payload,
      timestamp: new Date().toISOString(),
    },
    origin: 'http://host.test',
    source: fakeHostWindow as unknown as MessageEventSource,
  };
}

beforeAll(() => {
  window.localStorage.clear();
  root = document.createElement('div');
  document.body.appendChild(root);
  conn = mountComposer(root).conn;
});

describe('composer boot', () => {
  it('renders header, connection panel, form, preview, history', () => {
    expect(root.querySelector('[data-pkc-region="composer-header"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="host-connection"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="composer-form"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="composer-preview"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="composer-history"]')).not.toBeNull();
  });

  it('live-previews the envelope as the form changes', () => {
    const title = root.querySelector<HTMLInputElement>('input[placeholder^="title"]');
    expect(title).not.toBeNull();
    title!.value = 'プレビュー確認';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    const pre = root.querySelector('[data-pkc-region="composer-preview"] pre');
    expect(pre?.textContent).toContain('"protocol": "pkc-message"');
    expect(pre?.textContent).toContain('プレビュー確認');
    expect(pre?.textContent).toContain('"type": "record:offer"');
  });

  it('shows title-required error in the preview when empty', () => {
    const title = root.querySelector<HTMLInputElement>('input[placeholder^="title"]');
    title!.value = '';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    const pre = root.querySelector('[data-pkc-region="composer-preview"] pre');
    expect(pre?.textContent).toContain('title は必須');
  });
});

describe('host interaction (end-to-end parity)', () => {
  it('pong from the linked host turns status connected with profile', () => {
    conn.attachLink(fakeLink);
    conn.handleMessage(
      envelopeFromHost('pong', {
        app_id: 'pkc2',
        version: '9.9.9',
        schema_version: 1,
        embedded: true,
        capabilities: ['record:offer', 'export:request'],
      }),
    );
    expect(conn.getStatus()).toBe('connected');
    const statusText = root.querySelector('.pkc-status-text');
    expect(statusText?.textContent).toContain('pkc2 v9.9.9');
    expect(statusText?.textContent).toContain('embedded=true');
  });

  it('send appears in the offer-status panel with a correlation id attached', () => {
    const title = root.querySelector<HTMLInputElement>('input[placeholder^="title"]');
    title!.value = '送信テスト';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    sentToHost.length = 0;
    const sendBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Send record:offer'));
    sendBtn!.click();
    const env = sentToHost[0] as { correlation_id?: string };
    expect(typeof env.correlation_id).toBe('string'); // PKC2#804: 自動付与
    const offers = root.querySelector('[data-pkc-region="composer-offers"]');
    expect(offers?.textContent).toContain('送信テスト');
    expect(offers?.textContent).toContain('送信済み');
  });

  it('ack → accept round-trip updates the offer status (end-to-end parity, PKC2#804)', () => {
    const env = sentToHost[0] as { correlation_id: string };
    conn.handleMessage(envelopeFromHost('record:ack', { offer_id: 'o-9', correlation_id: env.correlation_id }));
    const offers = root.querySelector('[data-pkc-region="composer-offers"]');
    expect(offers?.textContent).toContain('到達');
    expect(offers?.textContent).toContain('o-9');
    conn.handleMessage(envelopeFromHost('record:accept', { offer_id: 'o-9', assigned_lid: 'lid-7', correlation_id: env.correlation_id }));
    expect(offers?.textContent).toContain('受理');
    expect(offers?.textContent).toContain('lid-7');
  });

  it('uncorrelated record:reject (old host) falls back to the history note', () => {
    conn.handleMessage(envelopeFromHost('record:reject', { offer_id: 'o-123', reason: 'dismissed' }));
    const hist = root.querySelector('[data-pkc-region="composer-history"]');
    expect(hist?.textContent).toContain('record:reject 受信');
    expect(hist?.textContent).toContain('o-123');
    expect(hist?.textContent).toContain('PKC2#804');
  });

  it('messages from a non-host window are ignored for status/history', () => {
    const before = root.querySelector('[data-pkc-region="composer-history"]')?.textContent ?? '';
    conn.handleMessage({
      data: envelopeFromHost('record:reject', { offer_id: 'evil', reason: 'dismissed' }).data,
      origin: 'http://evil.test',
      source: {} as MessageEventSource,
    });
    const after = root.querySelector('[data-pkc-region="composer-history"]')?.textContent ?? '';
    expect(after).toBe(before);
    expect(after).not.toContain('evil');
  });
});

describe('draft autosave', () => {
  it('persists the form to localStorage (UI prefs contract documented in README)', async () => {
    const title = root.querySelector<HTMLInputElement>('input[placeholder^="title"]');
    title!.value = 'ドラフト保存';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const raw = window.localStorage.getItem('pkc2-b1-offer-composer:draft');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).title).toBe('ドラフト保存');
  });
});
