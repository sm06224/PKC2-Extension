/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { buildBroadcastPayload, mountBroadcaster } from '../../tools/d1-multi-broadcaster/src/main';

describe('buildBroadcastPayload', () => {
  it('text / textlog は素通し', () => {
    expect(buildBroadcastPayload('text', 'T', 'B')).toEqual({ title: 'T', archetype: 'text', body: 'B' });
    expect(buildBroadcastPayload('textlog', 'T', 'B')).toEqual({ title: 'T', archetype: 'textlog', body: 'B' });
  });

  it('todo は body を JSON 化(status=open)', () => {
    const p = buildBroadcastPayload('todo', '買い物', '牛乳を買う');
    expect(p['archetype']).toBe('todo');
    expect(JSON.parse(p['body'] as string)).toEqual({ status: 'open', description: '牛乳を買う' });
  });
});

describe('mountBroadcaster', () => {
  it('初期 2 スロット + 追加・削除', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBroadcaster(root);
    expect(root.querySelectorAll('.pkc-d1-slot').length).toBe(2);

    const addBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('スロットを追加'))!;
    addBtn.click();
    expect(root.querySelectorAll('.pkc-d1-slot').length).toBe(3);

    const removeBtn = root.querySelector<HTMLButtonElement>('.pkc-d1-slot button')!;
    expect(removeBtn.textContent).toBe('スロット削除');
    removeBtn.click();
    expect(root.querySelectorAll('.pkc-d1-slot').length).toBe(2);
    root.remove();
  });

  it('未接続のみの Broadcast は全スキップ(タイトル必須)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountBroadcaster(root);
    const status = root.querySelector('[data-pkc-region="d1-status"]')!;
    const broadcast = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Broadcast'))!;

    broadcast.click();
    expect(status.textContent).toContain('タイトルが空');

    root.querySelector<HTMLInputElement>('[data-pkc-field="d1-title"]')!.value = 'テスト';
    broadcast.click();
    expect(status.textContent).toContain('送信 0 件');
    expect(status.textContent).toContain('スキップ 2 件');
    root.remove();
  });
});
