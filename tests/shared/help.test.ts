/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHelpPanel, helpButton } from '../../tools/shared/help';

beforeEach(() => {
  document.body.replaceChildren();
  document.querySelectorAll('[data-pkc-region="tool-help"]').forEach((n) => n.remove());
});

const SPEC = {
  what: 'テストツールです。',
  how: ['手順 1', '手順 2'],
  flow: ['通信の説明'],
  notes: ['注意 <img src=x onerror=window.__helpPwned=1>'],
};

describe('help component', () => {
  it('panel renders all sections incl. the shared connection guide', () => {
    const panel = buildHelpPanel('Test Tool', SPEC);
    expect(panel.textContent).toContain('Test Tool の使い方');
    expect(panel.textContent).toContain('手順 1');
    expect(panel.textContent).toContain('通信の説明');
    expect(panel.textContent).toContain('launcher 起動');
    expect(panel.textContent).toContain('注意');
  });

  it('connection: false omits the connection guide', () => {
    const panel = buildHelpPanel('T', { ...SPEC, connection: false });
    expect(panel.textContent).not.toContain('launcher 起動');
  });

  it('hostile strings stay inert text (textContent discipline)', () => {
    const panel = buildHelpPanel('T', SPEC);
    document.body.appendChild(panel);
    expect(panel.querySelector('img')).toBeNull();
    expect((window as { __helpPwned?: number }).__helpPwned).toBeUndefined();
  });

  it('button toggles the panel and injects its style once', () => {
    const btn1 = helpButton('T', SPEC);
    const btn2 = helpButton('T2', SPEC);
    document.body.appendChild(btn1);
    document.body.appendChild(btn2);
    expect(document.querySelectorAll('#pkc-help-style').length).toBe(1);
    btn1.click();
    expect(document.querySelector('[data-pkc-region="tool-help"]')).not.toBeNull();
    btn1.click();
    expect(document.querySelector('[data-pkc-region="tool-help"]')).toBeNull();
  });

  it('✕ closes the panel', () => {
    const btn = helpButton('T', SPEC);
    document.body.appendChild(btn);
    btn.click();
    const close = document.querySelector<HTMLButtonElement>('.pkc-help-close');
    close!.click();
    expect(document.querySelector('[data-pkc-region="tool-help"]')).toBeNull();
  });
});
