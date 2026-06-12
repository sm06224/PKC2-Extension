/** @vitest-environment happy-dom */
/**
 * F6 boot + T1 受動モデルの parity(pdf.js は mock — 実描画はブラウザ要、
 * 手動チェックリストは wall issue 側)。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__PDFJS_VERSION__', 'mock');
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 100, height: 140 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  })),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?raw', () => ({ default: '/* worker */' }));

import { base64ToBytes, mountPdfViewer, pickPdfEntries } from '../../tools/f6-pdf-viewer/src/main';
import type { ExtChannel, ContainerProjection } from '../../tools/shared/ext-channel';

const PROJECTION: ContainerProjection = {
  containerId: 'c-1',
  title: '書庫',
  entries: [
    { lid: 'p1', title: '請求書', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/pdf', filename: 'invoice.pdf', asset_size: 4000 },
    { lid: 'p2', title: '画像', archetype: 'attachment', created_at: '', updated_at: '', mime: 'image/png', filename: 'a.png' },
    { lid: 'p3', title: 'レポート', archetype: 'attachment', created_at: '', updated_at: '', filename: 'report.PDF' },
    { lid: 't1', title: 'メモ', archetype: 'text', created_at: '', updated_at: '' },
  ],
  relations: [],
  stats: { totalEntries: 4, byArchetype: {}, totalRelations: 0, totalAssets: 2 },
};

const hostWin = { postMessage: vi.fn() } as unknown as Window;

let root: HTMLElement;
let channel: ExtChannel;

beforeAll(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  channel = mountPdfViewer(root).channel;
  channel.attach(hostWin);
});

describe('pure helpers', () => {
  it('pickPdfEntries は mime / 拡張子で PDF 添付のみ抽出', () => {
    expect(pickPdfEntries(PROJECTION).map((e) => e.lid)).toEqual(['p1', 'p3']);
  });
  it('base64ToBytes は不正入力で null', () => {
    expect(Array.from(base64ToBytes('QUJD')!)).toEqual([65, 66, 67]);
    expect(base64ToBytes('!!!not-base64!!!')).toBeNull();
  });
});

describe('T1 受動モデル(end-to-end parity)', () => {
  function fromHost(msg: Record<string, unknown>): void {
    channel.handleMessage({
      data: { pkc: 'pkc-ext', v: 1, nonce: 'n-1', ...msg },
      origin: window.location.origin,
      source: hostWin as unknown as MessageEventSource,
    });
  }

  it('projection → PDF 索引が表示される', () => {
    fromHost({ t: 'projection', projection: PROJECTION });
    const index = root.querySelector('[data-pkc-region="pdf-index"]');
    expect(index?.textContent).toContain('書庫');
    expect(index?.textContent).toContain('invoice.pdf');
    expect(index?.textContent).toContain('report.PDF');
    expect(index?.textContent).not.toContain('a.png');
  });

  it('「開いてほしい」は hint を送る(pull ではない)', () => {
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === '開いてほしい');
    btn!.click();
    const sent = (hostWin.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m['t'] === 'hint');
    expect(sent).toBeDefined();
    expect(sent!['nonce']).toBe('n-1');
    expect(sent!['lid']).toBe('p1');
  });

  it('deliver(PDF asset)→ 描画パイプラインへ', async () => {
    fromHost({ t: 'deliver', payload: { kind: 'asset', lid: 'p1', asset_key: 'a1', mime: 'application/pdf', filename: 'invoice.pdf', data_base64: 'QUJD' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector('[data-pkc-region="pdf-status"]')?.textContent).toContain('invoice.pdf');
  });

  it('PDF でない deliver は丁寧に拒否(クラッシュしない)', () => {
    fromHost({ t: 'deliver', payload: { kind: 'asset', mime: 'image/png', data_base64: 'QUJD' } });
    expect(root.querySelector('[data-pkc-region="pdf-status"]')?.textContent).toContain('PDF ではありません');
    fromHost({ t: 'deliver', payload: { kind: 'entry', lid: 't1', body: 'メモ本文' } });
    expect(root.querySelector('[data-pkc-region="pdf-status"]')?.textContent).toContain('対象外');
  });
});
