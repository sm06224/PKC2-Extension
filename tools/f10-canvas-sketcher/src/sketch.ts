/**
 * F10 canvas-sketcher の純関数モデル (issue #68)。
 *
 * ストローク = 点列 + 色 + 太さ。undo/redo は配列スタックの純関数で表現し、
 * SVG エクスポートは polyline path を生成する(色は <input type=color> 由来の
 * #rrggbb、数値は有限値に丸め — 外部入力を埋め込まないため XSS 面は静的)。
 * 消しゴムは背景色ストローク(canvas と SVG で同一表現になる)。
 */

export interface SketchPoint {
  x: number;
  y: number;
}

export interface Stroke {
  points: SketchPoint[];
  color: string;
  width: number;
}

export interface SketchState {
  strokes: Stroke[];
  redo: Stroke[];
}

export const emptySketch = (): SketchState => ({ strokes: [], redo: [] });

/** ストローク追加(redo スタックは破棄)。Pure. */
export function addStroke(s: SketchState, stroke: Stroke): SketchState {
  if (stroke.points.length === 0) return s;
  return { strokes: [...s.strokes, stroke], redo: [] };
}

/** 1 手戻す。Pure. */
export function undo(s: SketchState): SketchState {
  if (s.strokes.length === 0) return s;
  const last = s.strokes[s.strokes.length - 1]!;
  return { strokes: s.strokes.slice(0, -1), redo: [...s.redo, last] };
}

/** 1 手進める。Pure. */
export function redo(s: SketchState): SketchState {
  if (s.redo.length === 0) return s;
  const last = s.redo[s.redo.length - 1]!;
  return { strokes: [...s.strokes, last], redo: s.redo.slice(0, -1) };
}

const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

/** #rrggbb / #rgb 以外は黒に正規化(SVG へ素通ししない)。Pure. */
export function safeColor(c: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : '#000000';
}

function pathD(points: SketchPoint[]): string {
  if (points.length === 0) return '';
  let d = `M${num(points[0]!.x)} ${num(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) d += ` L${num(points[i]!.x)} ${num(points[i]!.y)}`;
  if (points.length === 1) d += ` L${num(points[0]!.x)} ${num(points[0]!.y)}`; // 点 = 極短線
  return d;
}

/** ストローク列 → 自己完結 SVG 文字列。Pure. */
export function strokesToSvg(strokes: Stroke[], width: number, height: number, background: string): string {
  const body = strokes
    .map(
      (s) =>
        `<path d="${pathD(s.points)}" stroke="${safeColor(s.color)}" stroke-width="${num(s.width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">
  <rect width="100%" height="100%" fill="${safeColor(background)}"/>
  ${body}
</svg>
`;
}
