/**
 * F10 canvas-sketcher — 手書きキャンバス → SVG/PNG ローカル保存 (issue #68)。
 *
 * 純 Canvas API(外部ライブラリなし)。Pointer Events で描画(筆圧で太さ可変)、
 * undo/redo、色・太さ・消しゴム(背景色ストローク)、SVG/PNG 保存。
 *
 * PKC2 への attachment offer は v1 では不可(asset 同送禁止、壁 #80)のため
 * **standalone 専用**。SR-13 が通れば offer 導線を足せる。
 */

import '../../shared/base.css';
import './sketcher.css';
import { helpButton } from '../../shared/help';
import { button, el } from '../../shared/ui';
import { addStroke, emptySketch, redo, safeColor, strokesToSvg, undo, type SketchState, type Stroke } from './sketch';

const TOOL_NAME = 'pkc2-canvas-sketcher';
const TOOL_VERSION = '0.1.0';
const BG = '#ffffff';

let state: SketchState = emptySketch();
let current: Stroke | null = null;

let canvas: HTMLCanvasElement | null = null;
let statusEl: HTMLElement | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function ctx2d(): CanvasRenderingContext2D | null {
  return canvas?.getContext('2d') ?? null;
}

function cssSize(): { w: number; h: number } {
  if (!canvas) return { w: 0, h: 0 };
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (s.points.length === 0) return;
  ctx.strokeStyle = safeColor(s.color);
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[0]!.x, s.points[0]!.y);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i]!.x, s.points[i]!.y);
  if (s.points.length === 1) ctx.lineTo(s.points[0]!.x + 0.01, s.points[0]!.y);
  ctx.stroke();
}

function redraw(): void {
  const ctx = ctx2d();
  if (!ctx || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { w, h } = cssSize();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  for (const s of state.strokes) drawStroke(ctx, s);
  if (current) drawStroke(ctx, current);
}

function resizeCanvas(): void {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = cssSize();
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  redraw();
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountSketcher(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sk-root';

  const header = el('div', 'pkc-sk-header');
  header.setAttribute('data-pkc-region', 'sk-header');
  header.appendChild(el('span', 'pkc-sk-title', '✏️ PKC2 Canvas Sketcher'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 手書きスケッチ → SVG/PNG(オフライン)`));
  header.appendChild(helpButton('Canvas Sketcher', {
    what: 'フリーハンドのスケッチを描いて SVG / PNG として保存するオフラインツールです。',
    how: [
      'ドラッグ(ペン/指/スタイラス)で描画 — 筆圧対応デバイスでは太さが変わります',
      '色・太さを変更、「消しゴム」は背景色で上書きします',
      '↩️ undo / ↪️ redo / 🗑 全消去',
      '「SVG 保存」「PNG 保存」でローカルにダウンロード',
    ],
    flow: [
      '純 Canvas API のみで動作し、外部ライブラリ・外部通信はありません',
      'SVG はストローク(点列)から生成するためベクタのまま編集可能です',
    ],
    notes: [
      'PKC2 への attachment 送信は PKC-Message v1 では不可(asset 同送禁止)のため、保存→手動取り込みになります(SR-13 で解消予定)',
      'ブラウザ幅を変えるとキャンバスはクリアされずに再描画されます(描画内容はストロークとして保持)',
    ],
    connection: false,
  }));
  root.appendChild(header);

  const toolbar = el('div', 'pkc-sk-toolbar');
  toolbar.setAttribute('data-pkc-region', 'sk-toolbar');

  const color = document.createElement('input');
  color.type = 'color';
  color.value = '#1f6f2f';
  color.setAttribute('data-pkc-field', 'sk-color');
  toolbar.appendChild(color);

  const width = document.createElement('input');
  width.type = 'range';
  width.min = '1';
  width.max = '24';
  width.value = '3';
  width.setAttribute('data-pkc-field', 'sk-width');
  toolbar.appendChild(width);

  let eraser = false;
  const eraserBtn = button('🧽 消しゴム: OFF', 'pkc-btn-small', () => {
    eraser = !eraser;
    eraserBtn.textContent = eraser ? '🧽 消しゴム: ON' : '🧽 消しゴム: OFF';
  });
  toolbar.appendChild(eraserBtn);

  toolbar.appendChild(button('↩️ 戻す', 'pkc-btn-small', () => {
    state = undo(state);
    redraw();
  }));
  toolbar.appendChild(button('↪️ やり直す', 'pkc-btn-small', () => {
    state = redo(state);
    redraw();
  }));
  toolbar.appendChild(button('🗑 全消去', 'pkc-btn-small', () => {
    state = emptySketch();
    redraw();
    setStatus('全消去しました(戻せません)');
  }));
  toolbar.appendChild(button('💾 SVG 保存', 'pkc-btn-small', () => {
    const { w, h } = cssSize();
    download('sketch.svg', new Blob([strokesToSvg(state.strokes, w, h, BG)], { type: 'image/svg+xml' }));
  }));
  toolbar.appendChild(button('💾 PNG 保存', 'pkc-btn-small', () => {
    canvas?.toBlob((blob) => {
      if (blob) download('sketch.png', blob);
    }, 'image/png');
  }));
  root.appendChild(toolbar);

  canvas = document.createElement('canvas');
  canvas.className = 'pkc-sk-canvas';
  canvas.setAttribute('data-pkc-region', 'sk-canvas');
  root.appendChild(canvas);

  statusEl = el('div', 'pkc-hint');
  statusEl.setAttribute('data-pkc-region', 'sk-status');
  statusEl.textContent = 'PKC2 への直接送信は v1 では不可(SVG/PNG を保存して PKC2 に取り込んでください)';
  root.appendChild(statusEl);

  const pointOf = (ev: PointerEvent): { x: number; y: number } => {
    const r = canvas!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas!.setPointerCapture(ev.pointerId);
    const w = Number.parseFloat(width.value) || 3;
    const pressure = ev.pressure > 0 && ev.pressure !== 0.5 ? ev.pressure * 2 : 1;
    current = {
      points: [pointOf(ev)],
      color: eraser ? BG : color.value,
      width: Math.max(1, w * pressure),
    };
    redraw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!current) return;
    current.points.push(pointOf(ev));
    redraw();
  });
  const finish = (): void => {
    if (!current) return;
    state = addStroke(state, current);
    current = null;
    redraw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

const mountTarget = document.getElementById('sk-root');
if (mountTarget) mountSketcher(mountTarget);
