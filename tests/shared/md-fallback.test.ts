/**
 * md-fallback — ローカル簡易フォールバック描画(SR-18 / F11)の純関数テスト。
 * 安全性(エスケープ・http(s) のみリンク)と最小 markdown を検証する。
 */
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  extractHeadings,
  renderInline,
  renderMarkdownFallback,
} from '../../tools/shared/md-fallback';

describe('escapeHtml', () => {
  it('HTML 特殊文字を全てエスケープ', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe('&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  });
});

describe('renderInline', () => {
  it('bold / italic / code', () => {
    expect(renderInline('**b** *i* `c`')).toBe('<strong>b</strong> <em>i</em> <code>c</code>');
  });

  it('code span 内の記号はエスケープされ装飾されない', () => {
    expect(renderInline('`<a>**x**`')).toBe('<code>&lt;a&gt;**x**</code>');
  });

  it('http(s) リンクのみ <a> 化、それ以外はテキスト', () => {
    expect(renderInline('[ok](https://example.com)')).toContain('<a href="https://example.com"');
    expect(renderInline('[no](javascript:alert(1))')).not.toContain('<a ');
    expect(renderInline('[no](javascript:alert(1))')).toContain('no(javascript:alert(1))');
  });

  it('生の山括弧はエスケープされる(XSS 防止)', () => {
    expect(renderInline('<img src=x onerror=1>')).toBe('&lt;img src=x onerror=1&gt;');
  });

  it('数字を含むテキストが code span に誤吸収されない', () => {
    expect(renderInline('apples 5 and `code`')).toBe('apples 5 and <code>code</code>');
  });
});

describe('renderMarkdownFallback', () => {
  it('見出し', () => {
    expect(renderMarkdownFallback('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdownFallback('### Sub')).toBe('<h3>Sub</h3>');
  });

  it('段落 + インライン', () => {
    expect(renderMarkdownFallback('hello **world**')).toBe('<p>hello <strong>world</strong></p>');
  });

  it('箇条書き', () => {
    expect(renderMarkdownFallback('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('番号リスト', () => {
    expect(renderMarkdownFallback('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('引用', () => {
    expect(renderMarkdownFallback('> quote')).toBe('<blockquote>quote</blockquote>');
  });

  it('fenced code はエスケープして pre/code に(描画しない)', () => {
    const out = renderMarkdownFallback('```\n<b>x</b>\n```');
    expect(out).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  });

  it('複数ブロックを順に組み立てる', () => {
    const out = renderMarkdownFallback('# H\n\npara\n\n- item');
    expect(out).toBe('<h1>H</h1>\n<p>para</p>\n<ul><li>item</li></ul>');
  });
});

describe('extractHeadings', () => {
  it('ATX 見出しを level 付きで抽出', () => {
    expect(extractHeadings('# A\ntext\n## B')).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
    ]);
  });
});
