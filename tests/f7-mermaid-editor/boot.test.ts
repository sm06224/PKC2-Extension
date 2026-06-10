/** @vitest-environment happy-dom */
/**
 * F7 boot + end-to-end parity with mermaid mocked (real mermaid needs a real
 * browser layout engine — covered by the manual checklist in the wall issue).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__MERMAID_VERSION__', 'mock');
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn((_id: string, code: string) => {
      if (code.includes('BROKEN')) return Promise.reject(new Error('Parse error on line 2'));
      return Promise.resolve({ svg: '<svg data-mock="1"><text>ok</text></svg>' });
    }),
  },
}));

import { mountMermaidEditor } from '../../tools/f7-mermaid-editor/src/main';
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

function editor(): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>('[data-pkc-field="mmd-source"]')!;
}

function setSource(code: string): void {
  const e = editor();
  e.value = code;
  e.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitRender(): Promise<void> {
  await new Promise((r) => setTimeout(r, 700)); // > debounce 500ms
}

beforeAll(() => {
  window.localStorage.clear();
  root = document.createElement('div');
  document.body.appendChild(root);
  conn = mountMermaidEditor(root).conn;
  conn.attachLink(fakeLink);
  sentToHost.length = 0;
});

describe('mermaid editor', () => {
  it('renders toolbar templates, editor and preview', () => {
    expect(root.querySelector('[data-pkc-region="mmd-toolbar"]')?.textContent).toContain('Flowchart');
    expect(editor()).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="mmd-preview"]')).not.toBeNull();
  });

  it('debounced live preview renders SVG into the preview pane', async () => {
    setSource('graph TD\n A-->B');
    await waitRender();
    expect(root.querySelector('[data-pkc-region="mmd-preview"] svg[data-mock="1"]')).not.toBeNull();
    expect(root.querySelector('[data-pkc-region="mmd-error"]')?.textContent).toBe('');
  });

  it('parse errors show in the error bar and keep the last good diagram', async () => {
    setSource('BROKEN diagram');
    await waitRender();
    expect(root.querySelector('[data-pkc-region="mmd-error"]')?.textContent).toContain('Parse error');
    expect(root.querySelector('[data-pkc-region="mmd-preview"] svg[data-mock="1"]')).not.toBeNull();
  });

  it('template button inserts starter code and re-renders', async () => {
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Pie');
    btn!.click();
    expect(editor().value).toContain('pie title');
    await waitRender();
    expect(root.querySelector('[data-pkc-region="mmd-error"]')?.textContent).toBe('');
  });

  it('Save as Text sends a record:offer with a fenced body (end-to-end parity)', () => {
    setSource('graph TD\n A-->B');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save as Text'));
    btn!.click();
    expect(sentToHost.length).toBe(1);
    const env = sentToHost[0] as { type: string; payload: { title: string; body: string; archetype: string } };
    expect(env.type).toBe('record:offer');
    expect(env.payload.archetype).toBe('text');
    expect(env.payload.title).toBe('Mermaid: graph');
    expect(env.payload.body).toContain('```mermaid\ngraph TD\n A-->B\n```');
  });

  it('empty source is not offered', () => {
    sentToHost.length = 0;
    setSource('   ');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Save as Text'));
    btn!.click();
    expect(sentToHost.length).toBe(0);
  });
});
