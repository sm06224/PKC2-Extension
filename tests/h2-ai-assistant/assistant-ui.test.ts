/** @vitest-environment happy-dom */
/**
 * H2 end-to-end parity: http 送信(fetch mock)→ 応答吹き出し / 外部 endpoint 警告 /
 * deliver → 文脈候補 / クリップボード方式(copy + 貼り付け取り込み)/ 会話保存 propose /
 * API キーを localStorage に出さない。pkc-ext 実 wire を fake host で駆動。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAiAssistant } from '../../tools/h2-ai-assistant/src/main';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const sentToHost: Array<Record<string, unknown>> = [];
const hostWin = { postMessage: (d: unknown): void => { sentToHost.push(d as Record<string, unknown>); } } as unknown as Window;
function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return { data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg }, origin: window.location.origin, source: hostWin as unknown as MessageEventSource };
}
const PROJECTION = {
  containerId: 'c', title: 't',
  entries: [{ lid: 'memo1', title: '会議メモ', archetype: 'text', created_at: '', updated_at: '' }],
  relations: [], stats: { totalEntries: 1, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
};

let root: HTMLElement;
let channel: ExtChannel;

beforeEach(() => {
  sentToHost.length = 0;
  window.localStorage.clear();
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountAiAssistant(root).channel;
  channel.attach(hostWin);
  channel.handleMessage(fromHost({ t: 'projection', projection: PROJECTION }));
});
afterEach(() => {
  root.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const region = (n: string): HTMLElement => root.querySelector(`[data-pkc-region="${n}"]`)!;
const field = (n: string): HTMLInputElement => root.querySelector(`[data-pkc-field="${n}"]`) as HTMLInputElement;
function setMode(mode: string): void {
  const sel = field('ai-mode') as unknown as HTMLSelectElement;
  sel.value = mode;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function typeAndSend(text: string): void {
  const i = field('ai-input') as unknown as HTMLTextAreaElement;
  i.value = text;
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('http 送信(fetch mock)', () => {
  it('送信 → fetch → 応答が assistant 吹き出しに(textContent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'やあ、何でしょう' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    setMode('http');
    field('ai-endpoint').value = 'http://localhost:11434/v1/chat/completions';
    field('ai-endpoint').dispatchEvent(new Event('input', { bubbles: true }));
    field('ai-model').value = 'llama3.1';
    field('ai-model').dispatchEvent(new Event('input', { bubbles: true }));

    typeAndSend('こんにちは');
    expect(region('ai-log').textContent).toContain('こんにちは'); // user 即時表示
    await vi.waitFor(() => expect(region('ai-log').textContent).toContain('やあ、何でしょう'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as { model: string };
    expect(body.model).toBe('llama3.1');
  });
});

describe('外部 endpoint 警告', () => {
  it('外部 URL を入れると警告が出る', () => {
    setMode('http');
    field('ai-endpoint').value = 'https://api.openai.com/v1/chat/completions';
    field('ai-endpoint').dispatchEvent(new Event('input', { bubbles: true }));
    expect(region('ai-warn').textContent).toContain('外部送信');
    expect(region('ai-warn').style.display).not.toBe('none');
  });
  it('localhost では警告なし', () => {
    setMode('http');
    field('ai-endpoint').value = 'http://localhost:11434/v1/chat/completions';
    field('ai-endpoint').dispatchEvent(new Event('input', { bubbles: true }));
    expect(region('ai-warn').style.display).toBe('none');
  });
});

describe('文脈(deliver → 同意 include)', () => {
  it('送付された entry が文脈候補に出る', () => {
    channel.handleMessage(fromHost({ t: 'deliver', payload: { kind: 'entry', lid: 'memo1', body: '議事の本文' } }));
    const ctxRow = region('ai-context').querySelector('[data-pkc-ctx="memo1"]');
    expect(ctxRow).not.toBeNull();
    expect(ctxRow!.textContent).toContain('会議メモ'); // projection からタイトル解決
  });
});

describe('クリップボード方式', () => {
  it('送信でプロンプトをコピー、貼り付け取り込みで assistant 追加', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setMode('clipboard');
    typeAndSend('手動で聞く');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0]![0] as string)).toContain('手動で聞く');
    const paste = field('ai-paste') as unknown as HTMLTextAreaElement;
    paste.value = '外部からの応答';
    (root.querySelector('[data-pkc-action="take-paste"]') as HTMLElement).click();
    expect(region('ai-log').textContent).toContain('外部からの応答');
  });
});

describe('会話保存(propose)/ キー非永続', () => {
  it('📤 保存 → propose で textlog offer', () => {
    setMode('clipboard');
    typeAndSend('保存対象');
    (root.querySelector('[data-pkc-action="take-paste"]') as HTMLElement); // no-op guard
    (root.querySelector('[data-pkc-action="save"]') as HTMLElement).click();
    const proposes = sentToHost.filter((m) => m['t'] === 'propose');
    expect(proposes).toHaveLength(1);
    expect((proposes[0]!['offer'] as Record<string, unknown>)['archetype']).toBe('textlog');
  });

  it('API キーは localStorage に書かれない', () => {
    setMode('http');
    field('ai-key').value = 'sk-secret-123';
    field('ai-key').dispatchEvent(new Event('input', { bubbles: true }));
    const dump = JSON.stringify(window.localStorage);
    expect(dump).not.toContain('sk-secret-123');
  });
});
