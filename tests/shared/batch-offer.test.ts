/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { parseCsv, splitFrontMatter } from '../../tools/shared/batch-offer';
import { buildRows } from '../../tools/b6-csv-importer/src/main';
import { mdToRow } from '../../tools/b7-markdown-batch/src/main';
import { parseBookmarksHtml, bookmarkToRow } from '../../tools/b8-bookmark-importer/src/main';

describe('parseCsv', () => {
  it('quotes / escaped quotes / CRLF / 改行入りセルを扱う', () => {
    const rows = parseCsv('a,b\r\n"x,1","say ""hi""\nnext"\r\n');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'say "hi"\nnext']]);
  });
  it('空行を落とす', () => {
    expect(parseCsv('a,b\n\n1,2\n').length).toBe(2);
  });
});

describe('splitFrontMatter', () => {
  it('--- fence の key: value を解釈し body から剥がす', () => {
    const r = splitFrontMatter('---\ntitle: メモ\narchetype: text\n---\n# 本文');
    expect(r.meta['title']).toBe('メモ');
    expect(r.meta['archetype']).toBe('text');
    expect(r.body).toBe('# 本文');
  });
  it('fence が無ければ素通し', () => {
    expect(splitFrontMatter('# t').meta).toEqual({});
  });
});

describe('B6 buildRows', () => {
  const head = ['名前', '説明', '優先度'];
  const rows = [['買い物', '牛乳', '高'], ['', 'skip', ''], ['掃除', '', '低']];
  it('title 空行スキップ + 残り列の畳み込み', () => {
    const out = buildRows(head, rows, 0, 1, true, 'todo');
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ title: '買い物', body: '牛乳\n\n- 優先度: 高', archetype: 'todo' });
    expect(out[1]?.body).toBe('- 優先度: 低');
  });
  it('archetype 未指定は field を持たない', () => {
    expect('archetype' in buildRows(head, rows, 0, 1, false, '')[0]!).toBe(false);
  });
});

describe('B7 mdToRow', () => {
  it('front-matter title > # 見出し > ファイル名 の優先順', () => {
    expect(mdToRow('a.md', '---\ntitle: FM\n---\n# H1\nbody').title).toBe('FM');
    expect(mdToRow('a.md', '# H1\nbody').title).toBe('H1');
    expect(mdToRow('note.md', 'plain').title).toBe('note');
  });
  it('未知 archetype と非 http source_url は捨てる', () => {
    const r = mdToRow('a.md', '---\narchetype: hack\nsource_url: javascript:x\n---\nb');
    expect('archetype' in r).toBe(false);
    expect('source_url' in r).toBe(false);
  });
});

describe('B8 bookmarks', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><H3>開発</H3><DL><p>
      <DT><A HREF="https://example.com/a">PKC2</A>
      <DT><A HREF="javascript:alert(1)">evil</A>
    </DL><p>
    <DT><A HREF="http://example.com/b">トップ直下</A>
  </DL>`;
  it('フォルダ階層を辿り http(s) のみ拾う', () => {
    const bms = parseBookmarksHtml(html);
    expect(bms).toEqual([
      { title: 'PKC2', url: 'https://example.com/a', folder: '開発' },
      { title: 'トップ直下', url: 'http://example.com/b', folder: '' },
    ]);
  });
  it('row 変換は markdown リンク + source_url 付き text', () => {
    const r = bookmarkToRow({ title: 'PKC2', url: 'https://example.com/a', folder: '開発' });
    expect(r.body).toContain('[PKC2](https://example.com/a)');
    expect(r.body).toContain('folder: 開発');
    expect(r.archetype).toBe('text');
    expect(r.source_url).toBe('https://example.com/a');
  });
});
