/**
 * .docx(WordprocessingML)の依存ゼロパーサ(F3 #61)。
 *
 * shared/zip.ts で word/document.xml を展開し、DOMParser(XML)で
 * **テキスト構造のみ**抽出する: 段落 / 見出し(pStyle Heading1-6・Title)/
 * 箇条書き(numPr)/ 表 / 改行(w:br)・タブ(w:tab)。
 *
 * 非対応(明示): 文字装飾・画像・ヘッダフッタ・脚注・変更履歴の挿入表示
 * (削除テキスト w:delText とフィールドコード w:instrText は除外)。
 * mammoth 等の HTML 変換ライブラリは不採用 — 本リポジトリの規律
 * (runtime データを HTML として描画しない)と整合する構造化テキスト抽出に徹する。
 */

import { readZipFile } from '../../shared/zip';

export type DocxBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'table'; rows: string[][] };

/** 異常に長い文書の防御(ブロック数上限)。 */
export const MAX_BLOCKS = 20000;

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

/** 段落配下のテキストを順序通り連結(w:t / w:br / w:tab、delText 等は除外)。 */
function runText(node: Element): string {
  let out = '';
  for (const child of Array.from(node.children)) {
    const tag = child.tagName;
    if (tag === 'w:t') out += child.textContent ?? '';
    else if (tag === 'w:br' || tag === 'w:cr') out += '\n';
    else if (tag === 'w:tab') out += '\t';
    else if (tag === 'w:delText' || tag === 'w:instrText') continue;
    else out += runText(child); // w:r / w:hyperlink / w:ins などのコンテナ
  }
  return out;
}

function styleOf(p: Element): string {
  for (const s of Array.from(p.getElementsByTagName('w:pStyle'))) {
    return s.getAttribute('w:val') ?? '';
  }
  return '';
}

function isList(p: Element): boolean {
  return p.getElementsByTagName('w:numPr').length > 0;
}

function paragraphBlock(p: Element): DocxBlock {
  const text = runText(p);
  const style = styleOf(p);
  const m = /^Heading([1-9])$/i.exec(style);
  if (m) return { kind: 'heading', level: Math.min(6, Number.parseInt(m[1]!, 10)), text };
  if (/^Title$/i.test(style)) return { kind: 'heading', level: 1, text };
  if (isList(p)) return { kind: 'list', text };
  return { kind: 'para', text };
}

function tableBlock(tbl: Element): DocxBlock {
  const rows: string[][] = [];
  for (const tr of Array.from(tbl.children)) {
    if (tr.tagName !== 'w:tr') continue;
    const cells: string[] = [];
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue;
      const parts: string[] = [];
      for (const child of Array.from(tc.children)) {
        if (child.tagName === 'w:p') parts.push(runText(child));
      }
      cells.push(parts.join('\n').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { kind: 'table', rows };
}

/** document.xml をブロック列に。docx でなければ null。 */
export async function parseDocx(bytes: Uint8Array): Promise<DocxBlock[] | null> {
  const docBytes = await readZipFile(bytes, 'word/document.xml');
  if (!docBytes) return null;
  const doc = parseXml(dec.decode(docBytes));
  if (!doc) return null;
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return null;

  const blocks: DocxBlock[] = [];
  for (const child of Array.from(body.children)) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (child.tagName === 'w:p') blocks.push(paragraphBlock(child));
    else if (child.tagName === 'w:tbl') blocks.push(tableBlock(child));
    // sectPr などは無視
  }
  return blocks;
}

/** 概算文字数(空白除く)。Pure. */
export function charCount(blocks: DocxBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'table') {
      for (const r of b.rows) for (const c of r) n += c.replace(/\s/g, '').length;
    } else {
      n += b.text.replace(/\s/g, '').length;
    }
  }
  return n;
}
