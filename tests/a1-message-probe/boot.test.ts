/** @vitest-environment happy-dom */
/**
 * Boot smoke + end-to-end parity: a window message must end up as an
 * observable DOM row (not just internal state), mirroring PKC2's
 * "state mutation → consumer observation point" testing discipline.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mountProbe } from '../../tools/a1-message-probe/src/main';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function dispatchMessage(data: unknown, origin = 'http://host.test'): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

let root: HTMLElement;

beforeAll(async () => {
  root = document.createElement('div');
  document.body.appendChild(root);
  mountProbe(root);
  await nextFrame();
});

describe('probe boot (standalone)', () => {
  it('renders header with no-host status', () => {
    const header = root.querySelector('[data-pkc-region="probe-header"]');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('未接続');
  });

  it('renders profile panel and log regions', () => {
    expect(root.querySelector('[data-pkc-region="probe-profile"]')?.textContent).toContain('pong 未受信');
    expect(root.querySelector('[data-pkc-region="probe-log"]')).not.toBeNull();
  });
});

describe('incoming message → visible log row (end-to-end parity)', () => {
  it('shows a valid envelope as a pkc row with its type', async () => {
    dispatchMessage({
      protocol: 'pkc-message',
      version: 1,
      type: 'record:reject',
      source_id: null,
      target_id: 'ext:probe',
      payload: { offer_id: 'o1', reason: 'dismissed' },
      timestamp: new Date().toISOString(),
    });
    await nextFrame();
    const rows = [...root.querySelectorAll('.pkc-log-row[data-pkc-kind="pkc"]')];
    expect(rows.some((r) => r.textContent?.includes('record:reject'))).toBe(true);
  });

  it('shows an invalid envelope with its spec reject code', async () => {
    dispatchMessage({ protocol: 'pkc-message', version: 99, type: 'ping', timestamp: 'x' });
    await nextFrame();
    const rows = [...root.querySelectorAll('.pkc-log-row[data-pkc-kind="pkc-invalid"]')];
    expect(rows.some((r) => r.textContent?.includes('WRONG_VERSION'))).toBe(true);
  });

  it('hides non-PKC messages by default (foreign toggle off)', async () => {
    dispatchMessage({ totally: 'unrelated' });
    await nextFrame();
    const foreign = root.querySelectorAll('.pkc-log-row[data-pkc-kind="foreign"]');
    expect(foreign.length).toBe(0);
  });

  it('renders hostile payload strings as inert text once expanded', async () => {
    dispatchMessage({
      protocol: 'pkc-message',
      version: 1,
      type: 'custom',
      source_id: null,
      target_id: null,
      payload: { html: '<img src=x onerror=window.__pwned=1>' },
      timestamp: new Date().toISOString(),
    });
    await nextFrame();
    const rows = [...root.querySelectorAll('.pkc-log-row[data-pkc-kind="pkc"]')];
    const row = rows.find((r) => r.textContent?.includes('custom'));
    expect(row).toBeDefined();
    const details = row?.querySelector('details.pkc-log-payload') as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    }
    expect(row?.querySelector('img')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(row?.textContent).toContain('<img src=x onerror=window.__pwned=1>');
  });
});
