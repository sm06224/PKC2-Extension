/**
 * .xlsx(SpreadsheetML)の依存ゼロパーサ(F5 #63)。
 *
 * shared/zip.ts で展開し、DOMParser(XML)で**セル値のみ**抽出する。
 * 数式はキャッシュ値を表示。shared strings はリッチラン(r > t)連結、
 * ふりがな(rPh / phoneticPr)は除外。
 *
 * 非対応(明示): セル書式(色・罫線)/ 数値フォーマット(日付はシリアル値の
 * まま)/ 数式再計算 / xlsb・xls。壊れた入力では throw せず null を返す。
 */

import { readZipFile } from '../../shared/zip';

export interface XlsxSheet {
  name: string;
  path: string;
}

export interface XlsxFile {
  bytes: Uint8Array;
  sheets: XlsxSheet[];
  shared: string[];
}

export interface SheetGrid {
  /** dense な values[row][col]('' 埋め)。 */
  rows: string[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export const MAX_ROWS = 2000;
export const MAX_COLS = 256;

const dec = new TextDecoder('utf-8', { fatal: false });

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/** "BC12" → 0-based 列番号(54)。英大文字以外で打ち切り。Pure. */
export function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** 0-based 列番号 → "A".."Z","AA"… Pure. */
export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return `xl/${target.replace(/^\.\//, '')}`;
}

async function parseWorkbook(bytes: Uint8Array): Promise<XlsxSheet[] | null> {
  const wbBytes = await readZipFile(bytes, 'xl/workbook.xml');
  if (!wbBytes) return null;
  const wb = parseXml(dec.decode(wbBytes));
  if (!wb) return null;

  const rels = new Map<string, string>();
  const relsBytes = await readZipFile(bytes, 'xl/_rels/workbook.xml.rels');
  if (relsBytes) {
    const relsDoc = parseXml(dec.decode(relsBytes));
    if (relsDoc) {
      for (const r of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
        const id = r.getAttribute('Id');
        const target = r.getAttribute('Target');
        if (id && target) rels.set(id, resolveTarget(target));
      }
    }
  }

  const sheets: XlsxSheet[] = [];
  const sheetEls = Array.from(wb.getElementsByTagName('sheet'));
  for (let i = 0; i < sheetEls.length; i++) {
    const s = sheetEls[i]!;
    const rid = s.getAttribute('r:id') ?? '';
    sheets.push({
      name: s.getAttribute('name') ?? `Sheet${i + 1}`,
      path: rels.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`,
    });
  }
  return sheets.length > 0 ? sheets : null;
}

/** si 配下の t を連結(リッチラン r > t 対応、rPh / phoneticPr は除外)。 */
function siText(si: Element): string {
  let out = '';
  for (const child of Array.from(si.children)) {
    if (child.tagName === 't') out += child.textContent ?? '';
    else if (child.tagName === 'r') {
      for (const t of Array.from(child.children)) {
        if (t.tagName === 't') out += t.textContent ?? '';
      }
    }
    // rPh / phoneticPr は無視(ふりがなを本文に混ぜない)
  }
  return out;
}

async function parseSharedStrings(bytes: Uint8Array): Promise<string[]> {
  const ssBytes = await readZipFile(bytes, 'xl/sharedStrings.xml');
  if (!ssBytes) return [];
  const doc = parseXml(dec.decode(ssBytes));
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('si')).map(siText);
}

/** workbook を開く(シート一覧 + shared strings)。xlsx でなければ null。 */
export async function openXlsx(bytes: Uint8Array): Promise<XlsxFile | null> {
  const sheets = await parseWorkbook(bytes);
  if (!sheets) return null;
  const shared = await parseSharedStrings(bytes);
  return { bytes, sheets, shared };
}

function cellValue(c: Element, shared: string[]): string {
  const t = c.getAttribute('t') ?? 'n';
  if (t === 'inlineStr') {
    let out = '';
    for (const tEl of Array.from(c.getElementsByTagName('t'))) out += tEl.textContent ?? '';
    return out;
  }
  let v = '';
  for (const child of Array.from(c.children)) {
    if (child.tagName === 'v') {
      v = child.textContent ?? '';
      break;
    }
  }
  if (t === 's') {
    const idx = Number.parseInt(v, 10);
    return Number.isInteger(idx) ? (shared[idx] ?? '') : '';
  }
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  return v; // n / str / e — 数値・数式キャッシュ値・エラー文字列をそのまま
}

/** シートを dense grid に展開(MAX_ROWS × MAX_COLS で打ち切り)。 */
export async function sheetGrid(file: XlsxFile, index: number): Promise<SheetGrid | null> {
  const sheet = file.sheets[index];
  if (!sheet) return null;
  const xmlBytes = await readZipFile(file.bytes, sheet.path);
  if (!xmlBytes) return null;
  const doc = parseXml(dec.decode(xmlBytes));
  if (!doc) return null;

  const grid: string[][] = [];
  let truncatedRows = false;
  let truncatedCols = false;
  let maxCol = 0;
  let autoRow = 0; // r 属性が無い row 用の連番(0-based)

  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    const rAttr = Number.parseInt(rowEl.getAttribute('r') ?? '', 10);
    const rowIdx = Number.isInteger(rAttr) && rAttr >= 1 ? rAttr - 1 : autoRow;
    autoRow = rowIdx + 1;
    if (rowIdx >= MAX_ROWS) {
      truncatedRows = true;
      break;
    }
    let autoCol = 0;
    const cells: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? '';
      const colIdx = ref !== '' ? colIndex(ref) : autoCol;
      autoCol = colIdx + 1;
      if (colIdx < 0) continue;
      if (colIdx >= MAX_COLS) {
        truncatedCols = true;
        continue;
      }
      cells[colIdx] = cellValue(c, file.shared);
      if (colIdx + 1 > maxCol) maxCol = colIdx + 1;
    }
    grid[rowIdx] = cells;
  }

  const rowCount = grid.length;
  const rows: string[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const src = grid[r] ?? [];
    const row: string[] = new Array<string>(maxCol).fill('');
    for (let c = 0; c < maxCol; c++) row[c] = src[c] ?? '';
    rows.push(row);
  }
  return { rows, truncatedRows, truncatedCols };
}

/** grid → CSV(RFC 4180 風 quoting)。Pure. */
export function gridToCsv(rows: string[][]): string {
  const cell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
