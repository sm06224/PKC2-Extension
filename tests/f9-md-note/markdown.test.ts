/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import {
  defaultNoteTitle,
  extractOutline,
  parseMarkdown,
  renderInline,
  renderMarkdown,
} from '../../tools/f9-md-note/src/markdown';

describe('parseMarkdown', () => {
  it('見出し / 段落 / hr / 引用', () => {
    const b = parseMarkdown('# H1\n\n本文 1 行目\n2 行目\n\n---\n\n> 引用 A\n> 引用 B');
    expect(b[0]).toEqual({ kind: 'heading', level: 1, text: 'H1' });
    expect(b[1]).toEqual({ kind: 'para', text: '本文 1 行目\n2 行目' });
    expect(b[2]).toEqual({ kind: 'hr' });
    expect(b[3]).toEqual({ kind: 'quote', text: '引用 A\n引用 B' });
  });

  it('fence(lang 付き)と mermaid fence', () => {
    const b = parseMarkdown('```ts\nconst x = 1;\n```\n```mermaid\ngraph LR\n  A --> B\n```');
    expect(b[0]).toEqual({ kind: 'code', lang: 'ts', code: 'const x = 1;' });
    expect(b[1]).toEqual({ kind: 'code', lang: 'mermaid', code: 'graph LR\n  A --> B' });
  });

  it('リスト(- と 1.)とテーブル', () => {
    const b = parseMarkdown('- a\n- b\n\n1. one\n2. two\n\n| 列A | 列B |\n|----|----|\n| あ | い |\n| う | え |');
    expect(b[0]).toEqual({ kind: 'list', ordered: false, items: ['a', 'b'] });
    expect(b[1]).toEqual({ kind: 'list', ordered: true, items: ['one', 'two'] });
    expect(b[2]).toEqual({ kind: 'table', header: ['列A', '列B'], rows: [['あ', 'い'], ['う', 'え']] });
  });

  it('閉じない fence は EOF まで', () => {
    const b = parseMarkdown('```\nopen ended');
    expect(b[0]).toEqual({ kind: 'code', lang: '', code: 'open ended' });
  });
});

describe('renderInline', () => {
  const text = (nodes: Node[]): string => nodes.map((n) => (n instanceof HTMLElement ? n.outerHTML : n.textContent)).join('');

  it('code / bold / italic / link(http のみ)', () => {
    const div = document.createElement('div');
    div.append(...renderInline('a `c` **b** *i* [L](https://x.test/) end'));
    expect(div.querySelector('code')?.textContent).toBe('c');
    expect(div.querySelector('strong')?.textContent).toBe('b');
    expect(div.querySelector('em')?.textContent).toBe('i');
    const a = div.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://x.test/');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('javascript: リンクはリンク化しない', () => {
    const div = document.createElement('div');
    div.append(...renderInline('[x](javascript:alert(1))'));
    expect(div.querySelector('a')).toBeNull();
    expect(div.textContent).toBe('[x](javascript:alert(1))');
  });

  it('生 HTML はテキスト扱い', () => {
    const div = document.createElement('div');
    div.append(...renderInline('<script>boom()</script>'));
    expect(div.querySelector('script')).toBeNull();
    expect(div.textContent).toContain('<script>');
    expect(text(renderInline('plain'))).toBe('plain');
  });
});

describe('renderMarkdown', () => {
  it('DOM 構造(h2 / ul / table / pre)と headings 配列', () => {
    const blocks = parseMarkdown('## 見出し\n\n- a\n\n| h |\n|---|\n| v |\n\n```\ncode\n```');
    const { root, headings } = renderMarkdown(blocks);
    expect(root.querySelector('h2')?.textContent).toBe('見出し');
    expect(root.querySelectorAll('ul li').length).toBe(1);
    expect(root.querySelector('tbody td')?.textContent).toBe('v');
    expect(root.querySelector('pre code')?.textContent).toBe('code');
    expect(headings.length).toBe(1);
  });

  it('mermaid fence は callback に委譲(他言語は pre のまま)', () => {
    const cb = vi.fn();
    const blocks = parseMarkdown('```mermaid\ngraph LR\n```\n```js\nx\n```');
    const { root } = renderMarkdown(blocks, { mermaid: cb });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toBe('graph LR');
    expect(root.querySelectorAll('pre').length).toBe(1);
  });
});

describe('outline / title', () => {
  it('extractOutline と defaultNoteTitle', () => {
    const blocks = parseMarkdown('# タイトル\n\n## 小見出し');
    expect(extractOutline(blocks)).toEqual([
      { level: 1, text: 'タイトル' },
      { level: 2, text: '小見出し' },
    ]);
    expect(defaultNoteTitle(blocks)).toBe('タイトル');
    expect(defaultNoteTitle(parseMarkdown('本文だけ'))).toBe('無題ノート');
  });
});
