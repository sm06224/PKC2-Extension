/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { addStroke, emptySketch, redo, safeColor, strokesToSvg, undo, type Stroke } from '../../tools/f10-canvas-sketcher/src/sketch';

const stroke = (n: number): Stroke => ({
  points: [{ x: n, y: n }, { x: n + 1, y: n + 1 }],
  color: '#123456',
  width: 3,
});

describe('undo/redo モデル', () => {
  it('addStroke → undo → redo の往復', () => {
    let s = emptySketch();
    s = addStroke(s, stroke(1));
    s = addStroke(s, stroke(2));
    expect(s.strokes.length).toBe(2);

    s = undo(s);
    expect(s.strokes.length).toBe(1);
    expect(s.redo.length).toBe(1);

    s = redo(s);
    expect(s.strokes.length).toBe(2);
    expect(s.redo.length).toBe(0);
  });

  it('新ストロークで redo スタックは破棄、空状態の undo/redo は no-op', () => {
    let s = addStroke(emptySketch(), stroke(1));
    s = undo(s);
    s = addStroke(s, stroke(2));
    expect(s.redo).toEqual([]);
    expect(undo(emptySketch())).toEqual(emptySketch());
    expect(redo(emptySketch())).toEqual(emptySketch());
    expect(addStroke(emptySketch(), { points: [], color: '#000', width: 1 }).strokes).toEqual([]);
  });
});

describe('strokesToSvg', () => {
  it('path / 背景 / 寸法が入る', () => {
    const svg = strokesToSvg([stroke(10)], 200, 100, '#ffffff');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('d="M10 10 L11 11"');
    expect(svg).toContain('stroke="#123456"');
  });

  it('不正な色・非有限数値は無害化される', () => {
    const svg = strokesToSvg(
      [{ points: [{ x: Number.NaN, y: 5 }], color: 'red"/><script>', width: Number.POSITIVE_INFINITY }],
      100, 100, 'url(javascript:x)',
    );
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('javascript:');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('stroke-width="0"');
  });

  it('safeColor は #rgb / #rrggbb のみ通す', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('#A1B2C3')).toBe('#A1B2C3');
    expect(safeColor('red')).toBe('#000000');
    expect(safeColor('#12345g')).toBe('#000000');
  });
});
