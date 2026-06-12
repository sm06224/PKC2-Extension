/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { capBody, CLIP_BODY_LIMIT, extractFromHtml, isClipUrl } from '../../tools/b4-web-clipper/src/main';

describe('extractFromHtml', () => {
  it('title 抽出 + script/style/nav 除去 + 空白正規化', () => {
    const { title, text } = extractFromHtml(
      '<html><head><title>記事タイトル</title><style>x{}</style></head>'
      + '<body><nav>メニュー</nav><h1>見出し</h1><p>本文   です。</p>'
      + '<script>window.__b4Pwned=1</script><footer>フッタ</footer></body></html>',
    );
    expect(title).toBe('記事タイトル');
    expect(text).toContain('見出し');
    expect(text).toContain('本文 です。');
    expect(text).not.toContain('メニュー');
    expect(text).not.toContain('フッタ');
    expect(text).not.toContain('__b4Pwned');
    expect((window as { __b4Pwned?: number }).__b4Pwned).toBeUndefined();
  });

  it('title が無ければ h1 を使う', () => {
    expect(extractFromHtml('<body><h1>H1 だけ</h1></body>').title).toBe('H1 だけ');
  });
});

describe('capBody', () => {
  it('上限以内は素通し、超過は切り捨て + 注記', () => {
    expect(capBody('short')).toEqual({ body: 'short', truncated: false });
    const long = 'あ'.repeat(CLIP_BODY_LIMIT + 100);
    const r = capBody(long);
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThan(long.length);
    expect(r.body).toContain('切り捨て');
  });
});

describe('isClipUrl', () => {
  it('http(s) のみ許可', () => {
    expect(isClipUrl('https://example.com/a?b=c')).toBe(true);
    expect(isClipUrl('http://example.com')).toBe(true);
    expect(isClipUrl('javascript:alert(1)')).toBe(false);
    expect(isClipUrl('file:///etc/passwd')).toBe(false);
    expect(isClipUrl('ftp://x')).toBe(false);
  });
});
