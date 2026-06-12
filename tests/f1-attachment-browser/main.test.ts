/** @vitest-environment happy-dom */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  filterEntries,
  formatSize,
  iconFor,
  isTextLike,
  mimeOf,
  pickAttachments,
  previewBytes,
  sortEntries,
  viewerFor,
} from '../../tools/f1-attachment-browser/src/main';
import type { ContainerProjection, ProjectionEntry } from '../../tools/shared/ext-channel';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const entry = (over: Partial<ProjectionEntry>): ProjectionEntry => ({
  lid: 'x',
  title: 't',
  archetype: 'attachment',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  ...over,
});

beforeAll(() => {
  // happy-dom に無い場合だけ補う(image プレビュー経路用)
  const u = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (s: string) => void };
  if (typeof u.createObjectURL !== 'function') u.createObjectURL = () => 'blob:fake';
  if (typeof u.revokeObjectURL !== 'function') u.revokeObjectURL = () => undefined;
});

describe('pure helpers', () => {
  it('pickAttachments は archetype=attachment のみ', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 'box',
      entries: [entry({ lid: 'a' }), entry({ lid: 'b', archetype: 'text' })],
      relations: [], stats: { totalEntries: 2, byArchetype: {}, totalRelations: 0, totalAssets: 1 },
    };
    expect(pickAttachments(p).map((e) => e.lid)).toEqual(['a']);
  });

  it('mimeOf: 明示 mime 優先(小文字化)、無ければ拡張子推定、不明は 空', () => {
    expect(mimeOf({ mime: 'Application/PDF' })).toBe('application/pdf');
    expect(mimeOf({ filename: 'a.PDF' })).toBe('application/pdf');
    expect(mimeOf({ filename: 'mail.eml' })).toBe('message/rfc822');
    expect(mimeOf({ filename: 'doc.docx' })).toBe(MIME_DOCX);
    expect(mimeOf({ filename: 'noext' })).toBe('');
    expect(mimeOf({})).toBe('');
  });

  it('viewerFor: 専用形式はビューア名、画像/テキストは内蔵、他は 空', () => {
    expect(viewerFor('message/rfc822')).toBe('F2 email-viewer');
    expect(viewerFor('application/pdf')).toBe('F6 pdf-viewer');
    expect(viewerFor(MIME_DOCX)).toBe('F3 docx-viewer');
    expect(viewerFor('image/png')).toBe('このツールで表示');
    expect(viewerFor('text/plain')).toBe('このツールで表示');
    expect(viewerFor('application/zip')).toBe('');
  });

  it('isTextLike / iconFor の代表ケース', () => {
    expect(isTextLike('text/markdown')).toBe(true);
    expect(isTextLike('application/json')).toBe(true);
    expect(isTextLike('image/svg+xml')).toBe(true); // ただし画像分岐が先に取る
    expect(isTextLike('application/pdf')).toBe(false);
    expect(iconFor('image/svg+xml')).toBe('🖼️');
    expect(iconFor('application/pdf')).toBe('📄');
    expect(iconFor('application/octet-stream')).toBe('📦');
  });

  it('sortEntries: name 昇順 / date 新しい順 / size 大きい順(非破壊)', () => {
    const a = entry({ lid: 'a', filename: 'b.txt', updated_at: '2026-06-01T00:00:00Z', asset_size: 10 });
    const b = entry({ lid: 'b', filename: 'a.txt', updated_at: '2026-06-02T00:00:00Z', asset_size: 30 });
    const c = entry({ lid: 'c', filename: 'c.pdf', updated_at: '2026-06-03T00:00:00Z' });
    const src = [a, b, c];
    expect(sortEntries(src, 'name').map((e) => e.lid)).toEqual(['b', 'a', 'c']);
    expect(sortEntries(src, 'date').map((e) => e.lid)).toEqual(['c', 'b', 'a']);
    expect(sortEntries(src, 'size').map((e) => e.lid)).toEqual(['b', 'a', 'c']);
    expect(src.map((e) => e.lid)).toEqual(['a', 'b', 'c']); // 非破壊
  });

  it('filterEntries: filename / title / mime 部分一致、空クエリは素通し', () => {
    const xs = [
      entry({ lid: 'a', filename: 'report.pdf' }),
      entry({ lid: 'b', title: '議事録', filename: 'notes.txt' }),
    ];
    expect(filterEntries(xs, '')).toEqual(xs);
    expect(filterEntries(xs, 'REPORT').map((e) => e.lid)).toEqual(['a']);
    expect(filterEntries(xs, '議事').map((e) => e.lid)).toEqual(['b']);
    expect(filterEntries(xs, 'pdf').map((e) => e.lid)).toEqual(['a']);
  });

  it('formatSize: —, B, KB, MB', () => {
    expect(formatSize(undefined)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});

describe('previewBytes', () => {
  it('テキストは textContent で表示(HTML 描画しない)', () => {
    const bytes = new TextEncoder().encode('hello <b>world</b>');
    const box = previewBytes('a.txt', 'text/plain', bytes);
    const pre = box.querySelector('pre');
    expect(pre?.textContent).toBe('hello <b>world</b>');
    expect(box.querySelector('b')).toBeNull();
  });

  it('画像は blob <img>(alt にファイル名)', () => {
    const box = previewBytes('p.png', 'image/png', new Uint8Array([1, 2, 3]));
    const img = box.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('p.png');
    expect(img?.getAttribute('src')).toContain('blob:');
  });

  it('未対応形式は案内 + 保存ボタンのみ', () => {
    const box = previewBytes('x.zip', 'application/zip', new Uint8Array([0]));
    expect(box.textContent).toContain('インラインプレビュー非対応');
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('pre')).toBeNull();
    expect(box.querySelector('button')?.textContent).toBe('💾 保存');
  });
});
