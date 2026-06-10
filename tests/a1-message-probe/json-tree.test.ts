/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { renderJsonTree } from '../../tools/a1-message-probe/src/json-tree';

describe('renderJsonTree — safety', () => {
  it('renders hostile HTML strings as inert text (no element injection)', () => {
    const tree = renderJsonTree({
      attack: '<img src=x onerror=alert(1)>',
      nested: ['<script>alert(2)</script>'],
    });
    expect(tree.querySelector('img')).toBeNull();
    expect(tree.querySelector('script')).toBeNull();
    expect(tree.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(tree.textContent).toContain('<script>alert(2)</script>');
  });

  it('renders primitives with type classes', () => {
    expect(renderJsonTree('s').className).toContain('pkc-tree-string');
    expect(renderJsonTree(42).className).toContain('pkc-tree-number');
    expect(renderJsonTree(true).className).toContain('pkc-tree-bool');
    expect(renderJsonTree(null).className).toContain('pkc-tree-null');
  });

  it('survives circular structures', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    const tree = renderJsonTree(a);
    expect(tree.textContent).toContain('[circular]');
  });

  it('truncates long strings at display time', () => {
    const tree = renderJsonTree('x'.repeat(2000));
    expect(tree.textContent).toContain('全 2000 文字');
    expect((tree.textContent ?? '').length).toBeLessThan(700);
  });

  it('bounds entries per level', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 250; i++) big[`k${i}`] = i;
    const tree = renderJsonTree(big);
    expect(tree.textContent).toContain('表示上限');
  });

  it('bounds depth', () => {
    let v: unknown = 'leaf';
    for (let i = 0; i < 20; i++) v = { child: v };
    const tree = renderJsonTree(v);
    expect(tree.textContent).toContain('深さ上限');
  });
});
