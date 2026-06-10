/** @vitest-environment happy-dom */
/**
 * B2 end-to-end parity: Enter on the description → record:offer sent
 * (observable via the fake host window) → history row + cleared input.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mountTodoSender } from '../../tools/b2-todo-quick-sender/src/main';
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
  mode: 'opener',
  hostWindow: fakeHostWindow,
  expectedOrigin: 'http://host.test',
  label: 'fake host',
};

function input(): HTMLInputElement {
  return root.querySelector<HTMLInputElement>('[data-pkc-field="todo-description"]')!;
}

function pressEnter(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

beforeAll(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  conn = mountTodoSender(root).conn;
  conn.attachLink(fakeLink);
  sentToHost.length = 0; // drop the handshake ping
});

describe('todo quick sender', () => {
  it('renders form and history regions', () => {
    expect(root.querySelector('[data-pkc-region="todo-form"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="todo-history"]')).not.toBeNull();
  });

  it('Enter sends a todo offer in PKC2 body shape and clears the input', () => {
    const desc = input();
    desc.value = '牛乳を買う';
    const date = root.querySelector<HTMLInputElement>('[data-pkc-field="todo-date"]')!;
    date.value = '2026-06-12';
    pressEnter(desc);

    expect(sentToHost.length).toBe(1);
    const env = sentToHost[0] as { type: string; payload: { title: string; body: string; archetype: string } };
    expect(env.type).toBe('record:offer');
    expect(env.payload.archetype).toBe('todo');
    expect(env.payload.title).toBe('牛乳を買う');
    expect(JSON.parse(env.payload.body)).toEqual({
      status: 'open',
      description: '牛乳を買う',
      date: '2026-06-12',
      archived: false,
    });

    expect(desc.value).toBe('');
    expect(date.value).toBe('2026-06-12'); // 期日は連投のため保持
    expect(root.querySelector('[data-pkc-region="todo-history"]')?.textContent).toContain('牛乳を買う');
  });

  it('rejects empty description with an inline error and sends nothing', () => {
    sentToHost.length = 0;
    const desc = input();
    desc.value = '   ';
    pressEnter(desc);
    expect(sentToHost.length).toBe(0);
    expect(root.querySelector('[data-pkc-region="todo-error"]')?.textContent).toContain('入力してください');
  });

  it('inbound record:reject shows in history with the correlation caveat', () => {
    conn.handleMessage({
      data: {
        protocol: 'pkc-message',
        version: 1,
        type: 'record:reject',
        source_id: null,
        target_id: null,
        payload: { offer_id: 'o-9', reason: 'dismissed' },
        timestamp: new Date().toISOString(),
      },
      origin: 'http://host.test',
      source: fakeHostWindow as unknown as MessageEventSource,
    });
    expect(root.querySelector('[data-pkc-region="todo-history"]')?.textContent).toContain('record:reject 受信');
  });
});
