/** @vitest-environment happy-dom */
/**
 * F11 premium-markdown-viewer(SR-18 借用 render の実証)。
 *  - pure: buildPreviewDoc / pickDocCss
 *  - dynamic mechanism(end-to-end): deliver → render-request → host render-result
 *    → iframe srcdoc(借用 CSS + host HTML)という consumer 観測点まで通す。
 *    描画 DOM attribute 遷移で止めず、srcdoc 文字列(実際に描かれる内容)で assert する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPreviewDoc,
  mountPremiumMarkdownViewer,
  pickDocCss,
} from '../../tools/f11-premium-markdown-viewer/src/main';
import type { ExtChannel } from '../../tools/shared/ext-channel';

const PROJECTION = {
  containerId: 'c-1',
  title: 'T',
  entries: [{ lid: 'e1', title: 'メモ', archetype: 'text', created_at: '', updated_at: '' }],
  relations: [],
  stats: { totalEntries: 1, byArchetype: { text: 1 }, totalRelations: 0, totalAssets: 0 },
};

const sent: Record<string, unknown>[] = [];
const hostWin = { postMessage: (d: unknown): void => void sent.push(d as Record<string, unknown>) } as unknown as Window;

function fromHost(msg: Record<string, unknown>): Pick<MessageEvent, 'data' | 'origin' | 'source'> {
  return {
    data: { pkc: 'pkc-ext', v: 1, ...msg },
    origin: window.location.origin,
    source: hostWin as unknown as MessageEventSource,
  };
}

function frameSrcdoc(root: HTMLElement): string {
  const frame = root.querySelector('[data-pkc-region="pmd-preview"]') as HTMLIFrameElement | null;
  return frame?.getAttribute('srcdoc') ?? '';
}

describe('pure helpers', () => {
  it('buildPreviewDoc は css と html を doc に組む', () => {
    const doc = buildPreviewDoc('<p>x</p>', 'body{color:red}');
    expect(doc).toContain('<style>body{color:red}</style>');
    expect(doc).toContain('<body><p>x</p></body>');
  });

  it('pickDocCss: host モードは借用 CSS、fallback は既定 CSS', () => {
    expect(pickDocCss('host', 'BORROWED{}', false)).toBe('BORROWED{}');
    expect(pickDocCss('fallback', 'BORROWED{}', false)).not.toContain('BORROWED{}');
  });

  it('pickDocCss: premium は overlay を後ろに足す', () => {
    const css = pickDocCss('host', 'BORROWED{}', true);
    expect(css.startsWith('BORROWED{}')).toBe(true);
    expect(css).toContain('max-width'); // premium overlay の特徴
  });

  it('pickDocCss: host モードでも借用 CSS 未着なら既定にフォールバック', () => {
    expect(pickDocCss('host', null, false)).toContain('font:'); // DEFAULT_DOC_CSS
  });
});

describe('借用 render の end-to-end(host あり)', () => {
  let root: HTMLElement;
  let channel: ExtChannel;

  beforeEach(() => {
    sent.length = 0;
    root = document.createElement('div');
    document.body.appendChild(root);
    channel = mountPremiumMarkdownViewer(root).channel;
    channel.attach(hostWin); // テスト: host を接続(standalone 検出を上書き)
    channel.handleMessage(fromHost({ nonce: 'n-1', t: 'projection', projection: PROJECTION }));
  });

  afterEach(() => {
    root.remove();
  });

  it('projection 後、索引に text 系 entry が出る', () => {
    const index = root.querySelector('[data-pkc-region="pmd-index"]')!;
    expect(index.textContent).toContain('メモ');
  });

  it('stylesheet で base.css を借用し、host render-result を借用 CSS で描く', () => {
    channel.handleMessage(fromHost({ nonce: 'n-1', t: 'stylesheet', css: 'body{--borrowed:1}', engine_version: '1.2.0' }));

    // deliver(本文)→ requestRender が render-request を送る
    channel.handleMessage(fromHost({ nonce: 'n-1', t: 'deliver', payload: { kind: 'entry', lid: 'e1', body: '# Hi' } }));
    const req = sent.find((m) => m['t'] === 'render-request');
    expect(req).toBeTruthy();
    const cid = req!['correlation_id'] as string;

    // host が render-result を返す(html は host 権威。複製していない)
    channel.handleMessage(fromHost({
      nonce: 'n-1',
      t: 'render-result',
      result: { ok: true, html: '<h1 data-host>Hi</h1>', engine_version: '1.2.0', correlation_id: cid },
    }));

    const doc = frameSrcdoc(root);
    expect(doc).toContain('<h1 data-host>Hi</h1>'); // host HTML がそのまま
    expect(doc).toContain('--borrowed:1'); // 借りた base.css が当たっている
    const engine = root.querySelector('.pmd-engine')!;
    expect(engine.getAttribute('data-pmd-mode')).toBe('host');
  });

  it('render-result が来なければ timeout でフォールバック描画に degrade', () => {
    vi.useFakeTimers();
    channel.handleMessage(fromHost({ nonce: 'n-1', t: 'deliver', payload: { kind: 'entry', lid: 'e1', body: '# Local' } }));
    expect(sent.some((m) => m['t'] === 'render-request')).toBe(true);
    vi.advanceTimersByTime(2000);
    const doc = frameSrcdoc(root);
    expect(doc).toContain('<h1>Local</h1>'); // フォールバックエンジンの出力
    const engine = root.querySelector('.pmd-engine')!;
    expect(engine.getAttribute('data-pmd-mode')).toBe('fallback');
    vi.useRealTimers();
  });

  it('古い correlation の render-result は無視される', () => {
    channel.handleMessage(fromHost({ nonce: 'n-1', t: 'deliver', payload: { kind: 'entry', lid: 'e1', body: '# A' } }));
    channel.handleMessage(fromHost({
      nonce: 'n-1',
      t: 'render-result',
      result: { ok: true, html: '<h1>STALE</h1>', engine_version: '1', correlation_id: 'WRONG' },
    }));
    expect(frameSrcdoc(root)).not.toContain('STALE');
  });
});
