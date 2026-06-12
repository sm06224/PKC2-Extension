/**
 * .drawio(mxGraph XML)の依存ゼロパーサ + 簡易 SVG レンダラ(F8 #66)。
 *
 * 対応:
 *  - `<mxfile>` ラッパ(複数ページ)/ 生 `<mxGraphModel>` の両方
 *  - 圧縮 diagram(base64 → raw deflate → URI decode、draw.io 既定の保存形式)
 *  - 頂点 = rect / rounded / ellipse + ラベル、辺 = source/target 中心間の直線
 *
 * 非対応(明示): draw.io の全シェイプ・ルーティング・スタイル詳細。
 * プレビューは「構造の確認」用で、編集の正は XML ソース。
 * ラベルは textContent のみ(HTML ラベルはタグ除去)、色は #hex / none のみ通す。
 */

import { inflateRaw } from '../../shared/zip';

export interface MxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MxCell {
  id: string;
  value: string;
  style: Record<string, string>;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  geometry?: MxGeometry;
}

export interface DrawioPage {
  name: string;
  /** mxGraphModel XML(展開済み・編集対象)。 */
  xml: string;
}

export const MAX_CELLS = 5000;
const INFLATE_CAP = 32 * 1024 * 1024;

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** draw.io 圧縮 diagram(base64 + raw deflate + URI encode)を XML に展開。 */
export async function inflateDiagram(content: string): Promise<string | null> {
  const bytes = base64ToBytes(content);
  if (!bytes) return null;
  const inflated = await inflateRaw(bytes, INFLATE_CAP);
  if (!inflated) return null;
  try {
    return decodeURIComponent(new TextDecoder().decode(inflated));
  } catch {
    return null;
  }
}

/** ファイル内容 → ページ列。drawio でなければ null。 */
export async function extractPages(text: string): Promise<DrawioPage[] | null> {
  const trimmed = text.trim();
  if (trimmed.includes('<mxGraphModel') && !trimmed.includes('<mxfile')) {
    return [{ name: 'Page-1', xml: trimmed }];
  }
  const doc = parseXml(trimmed);
  if (!doc) return null;
  const diagrams = Array.from(doc.getElementsByTagName('diagram'));
  if (diagrams.length === 0) return null;
  const pages: DrawioPage[] = [];
  for (let i = 0; i < diagrams.length; i++) {
    const d = diagrams[i]!;
    const name = d.getAttribute('name') ?? `Page-${i + 1}`;
    // inline mxGraphModel(非圧縮)
    const inline = d.getElementsByTagName('mxGraphModel')[0];
    if (inline) {
      pages.push({ name, xml: new XMLSerializer().serializeToString(inline) });
      continue;
    }
    const content = (d.textContent ?? '').trim();
    if (content === '') {
      pages.push({ name, xml: '<mxGraphModel><root/></mxGraphModel>' });
      continue;
    }
    const xml = await inflateDiagram(content);
    if (xml === null) return null; // 圧縮形式が読めない = drawio として扱えない
    pages.push({ name, xml });
  }
  return pages;
}

/** `rounded=1;fillColor=#fff;ellipse` → map(値なしキーは '')。Pure. */
export function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    if (part === '') continue;
    const idx = part.indexOf('=');
    if (idx < 0) out[part] = '';
    else out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

/** mxGraphModel XML → セル列。Pure(DOMParser のみ)。 */
export function parseMxGraph(xml: string): MxCell[] | null {
  const doc = parseXml(xml);
  if (!doc) return null;
  if (doc.getElementsByTagName('mxGraphModel').length === 0) return null;
  const cells: MxCell[] = [];
  for (const c of Array.from(doc.getElementsByTagName('mxCell')).slice(0, MAX_CELLS)) {
    const cell: MxCell = {
      id: c.getAttribute('id') ?? '',
      value: c.getAttribute('value') ?? '',
      style: parseStyle(c.getAttribute('style') ?? ''),
      vertex: c.getAttribute('vertex') === '1',
      edge: c.getAttribute('edge') === '1',
    };
    const src = c.getAttribute('source');
    const tgt = c.getAttribute('target');
    if (src) cell.source = src;
    if (tgt) cell.target = tgt;
    const g = c.getElementsByTagName('mxGeometry')[0];
    if (g) {
      cell.geometry = {
        x: Number.parseFloat(g.getAttribute('x') ?? '0') || 0,
        y: Number.parseFloat(g.getAttribute('y') ?? '0') || 0,
        w: Number.parseFloat(g.getAttribute('width') ?? '0') || 0,
        h: Number.parseFloat(g.getAttribute('height') ?? '0') || 0,
      };
    }
    cells.push(cell);
  }
  return cells;
}

/** #hex / none のみ通す(style 由来の色を SVG へ素通ししない)。Pure. */
export function safeSvgColor(c: string | undefined, fallback: string): string {
  if (c === undefined) return fallback;
  if (c === 'none') return 'none';
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

/** value の HTML ラベルをテキスト化(描画はしない)。 */
export function labelText(value: string): string {
  if (!value.includes('<')) return value;
  try {
    const doc = new DOMParser().parseFromString(value, 'text/html');
    return doc.body?.textContent ?? '';
  } catch {
    return value;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function center(g: MxGeometry): { cx: number; cy: number } {
  return { cx: g.x + g.w / 2, cy: g.y + g.h / 2 };
}

/** セル列 → SVG プレビュー(DOM 構築のみ、textContent ラベル)。 */
export function cellsToSvg(cells: MxCell[]): SVGElement {
  const vertices = cells.filter((c) => c.vertex && c.geometry);
  const byId = new Map(vertices.map((c) => [c.id, c]));

  let minX = 0;
  let minY = 0;
  let maxX = 100;
  let maxY = 100;
  for (const v of vertices) {
    const g = v.geometry!;
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w);
    maxY = Math.max(maxY, g.y + g.h);
  }
  const pad = 20;
  const svg = svgEl('svg', {
    xmlns: SVG_NS,
    viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
  });

  // 辺(頂点の下に描く)
  for (const c of cells) {
    if (!c.edge) continue;
    const s = c.source !== undefined ? byId.get(c.source) : undefined;
    const t = c.target !== undefined ? byId.get(c.target) : undefined;
    if (!s?.geometry || !t?.geometry) continue;
    const p1 = center(s.geometry);
    const p2 = center(t.geometry);
    svg.appendChild(svgEl('line', {
      x1: String(p1.cx), y1: String(p1.cy), x2: String(p2.cx), y2: String(p2.cy),
      stroke: safeSvgColor(c.style['strokeColor'], '#8aa07a'),
      'stroke-width': '1.5',
    }));
    const label = labelText(c.value);
    if (label !== '') {
      const text = svgEl('text', {
        x: String((p1.cx + p2.cx) / 2),
        y: String((p1.cy + p2.cy) / 2 - 4),
        'text-anchor': 'middle',
        'font-size': '11',
        fill: '#c8d8b0',
      });
      text.textContent = label;
      svg.appendChild(text);
    }
  }

  // 頂点
  for (const v of vertices) {
    const g = v.geometry!;
    const fill = safeSvgColor(v.style['fillColor'], '#161c12');
    const stroke = safeSvgColor(v.style['strokeColor'], '#7fbf3f');
    const isEllipse = 'ellipse' in v.style;
    if (isEllipse) {
      const { cx, cy } = center(g);
      svg.appendChild(svgEl('ellipse', {
        cx: String(cx), cy: String(cy), rx: String(g.w / 2), ry: String(g.h / 2),
        fill, stroke,
      }));
    } else {
      svg.appendChild(svgEl('rect', {
        x: String(g.x), y: String(g.y), width: String(g.w), height: String(g.h),
        rx: v.style['rounded'] === '1' ? '8' : '0',
        fill, stroke,
      }));
    }
    const label = labelText(v.value);
    if (label !== '') {
      const { cx, cy } = center(g);
      const text = svgEl('text', {
        x: String(cx), y: String(cy + 4),
        'text-anchor': 'middle',
        'font-size': '12',
        fill: '#c8d8b0',
      });
      text.textContent = label;
      svg.appendChild(text);
    }
  }
  return svg;
}

/** 保存用: mxGraphModel XML を非圧縮 mxfile に包む。Pure. */
export function wrapMxfile(pages: DrawioPage[]): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = pages
    .map((p, i) => `  <diagram id="page-${i + 1}" name="${esc(p.name)}">\n    ${p.xml}\n  </diagram>`)
    .join('\n');
  return `<mxfile host="pkc2-drawio-editor" modified="${new Date().toISOString()}" agent="pkc2-extension" version="1.0" type="device">\n${body}\n</mxfile>\n`;
}
