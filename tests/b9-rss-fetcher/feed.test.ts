/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { htmlFragmentToText, itemBody, parseFeed } from '../../tools/b9-rss-fetcher/src/feed';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>テストブログ</title>
  <item>
    <title>記事 1</title>
    <link>https://blog.test/post/1</link>
    <description>&lt;p&gt;要約 &lt;b&gt;強調&lt;/b&gt;&lt;script&gt;evil()&lt;/script&gt;&lt;/p&gt;</description>
    <pubDate>Thu, 11 Jun 2026 09:00:00 +0900</pubDate>
  </item>
  <item><title>記事 2</title><link>javascript:alert(1)</link><description>素のテキスト</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom フィード</title>
  <entry>
    <title>エントリ A</title>
    <link rel="alternate" href="https://atom.test/a"/>
    <link rel="enclosure" href="https://atom.test/a.mp3"/>
    <summary>サマリ A</summary>
    <updated>2026-06-10T00:00:00Z</updated>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('RSS 2.0: title/link/description(HTML テキスト化)/pubDate', () => {
    const f = parseFeed(RSS)!;
    expect(f.kind).toBe('rss');
    expect(f.title).toBe('テストブログ');
    expect(f.items.length).toBe(2);
    expect(f.items[0]).toEqual({
      title: '記事 1',
      link: 'https://blog.test/post/1',
      summary: '要約 強調',
      date: 'Thu, 11 Jun 2026 09:00:00 +0900',
    });
    // 非 http(s) link は落とす
    expect(f.items[1]!.link).toBe('');
  });

  it('Atom: rel=alternate 優先 + summary/updated', () => {
    const f = parseFeed(ATOM)!;
    expect(f.kind).toBe('atom');
    expect(f.items[0]).toEqual({
      title: 'エントリ A',
      link: 'https://atom.test/a',
      summary: 'サマリ A',
      date: '2026-06-10T00:00:00Z',
    });
  });

  it('フィードでない XML / 壊れた入力は null', () => {
    expect(parseFeed('<html><body/></html>')).toBeNull();
    expect(parseFeed('not xml at all')).toBeNull();
  });
});

describe('helpers', () => {
  it('htmlFragmentToText は script を実行せず除去', () => {
    expect(htmlFragmentToText('<p>A<script>window.__b9Pwned=1</script>B</p>')).toBe('AB');
    expect((window as { __b9Pwned?: number }).__b9Pwned).toBeUndefined();
    expect(htmlFragmentToText('プレーン')).toBe('プレーン');
  });

  it('itemBody は summary / published / link を結合', () => {
    expect(itemBody({ title: 't', link: 'https://x.test/', summary: '要約', date: 'D' }))
      .toBe('要約\n\n> published: D\n\nhttps://x.test/');
    expect(itemBody({ title: 't', link: '', summary: '', date: '' })).toBe('');
  });
});
