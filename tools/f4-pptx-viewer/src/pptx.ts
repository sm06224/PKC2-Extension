/**
 * .pptx(PresentationML)の依存ゼロパーサ(F4 #62)。
 *
 * shared/zip.ts で展開し、DOMParser(XML)で**スライドのテキストのみ**
 * 抽出する: presentation.xml + rels でスライド順を解決し、各スライドの
 * 図形(p:sp)から段落(a:p > a:r > a:t)を、表(p:graphicFrame)からセル
 * テキストを集める。タイトルはプレースホルダ(p:ph type=title/ctrTitle)。
 *
 * 非対応(明示): 図形描画・画像・レイアウト・アニメーション・
 * スピーカーノート。壊れた入力では throw せず null。
 */

import { listZip, readZipFile } from '../../shared/zip';

export interface PptxSlide {
  title: string;
  lines: string[];
}

/** 異常に大きいプレゼンの防御(スライド数上限)。 */
export const MAX_SLIDES = 500;

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

/** a:p 配下のラン(a:r > a:t / a:br / a:fld)を順に連結。 */
function paraText(p: Element): string {
  let out = '';
  for (const child of Array.from(p.children)) {
    const tag = child.tagName;
    if (tag === 'a:r') {
      for (const t of Array.from(child.children)) {
        if (t.tagName === 'a:t') out += t.textContent ?? '';
      }
    } else if (tag === 'a:br') {
      out += '\n';
    } else if (tag === 'a:fld') {
      for (const t of Array.from(child.getElementsByTagName('a:t'))) out += t.textContent ?? '';
    }
  }
  return out;
}

function slideFromDoc(doc: Document): PptxSlide {
  const slide: PptxSlide = { title: '', lines: [] };
  for (const sp of Array.from(doc.getElementsByTagName('p:sp'))) {
    const isTitle = Array.from(sp.getElementsByTagName('p:ph')).some((ph) => {
      const t = ph.getAttribute('type');
      return t === 'title' || t === 'ctrTitle';
    });
    const lines: string[] = [];
    for (const p of Array.from(sp.getElementsByTagName('a:p'))) {
      const t = paraText(p);
      if (t.trim() !== '') lines.push(t);
    }
    if (isTitle && slide.title === '') slide.title = lines.join(' ');
    else slide.lines.push(...lines);
  }
  // 表(graphicFrame)内のテキストも拾う
  for (const gf of Array.from(doc.getElementsByTagName('p:graphicFrame'))) {
    for (const p of Array.from(gf.getElementsByTagName('a:p'))) {
      const t = paraText(p);
      if (t.trim() !== '') slide.lines.push(t);
    }
  }
  return slide;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return `ppt/${target.replace(/^\.\//, '')}`;
}

/** スライドパスを presentation.xml の順序で解決(rels 不在時は番号順 fallback)。 */
async function slidePaths(bytes: Uint8Array): Promise<string[] | null> {
  const presBytes = await readZipFile(bytes, 'ppt/presentation.xml');
  if (!presBytes) return null;
  const pres = parseXml(dec.decode(presBytes));
  if (!pres) return null;

  const rels = new Map<string, string>();
  const relsBytes = await readZipFile(bytes, 'ppt/_rels/presentation.xml.rels');
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

  const paths: string[] = [];
  for (const sldId of Array.from(pres.getElementsByTagName('p:sldId'))) {
    const rid = sldId.getAttribute('r:id') ?? '';
    const p = rels.get(rid);
    if (p) paths.push(p);
  }
  if (paths.length > 0) return paths.slice(0, MAX_SLIDES);

  // fallback: zip 内の slideN.xml を番号順に
  const found = listZip(bytes)
    .map((e) => e.name)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/\d+/.exec(a.slice(11))?.[0] ?? 0) - Number(/\d+/.exec(b.slice(11))?.[0] ?? 0));
  return found.length > 0 ? found.slice(0, MAX_SLIDES) : null;
}

/** pptx をスライド列に。pptx でなければ null。 */
export async function parsePptx(bytes: Uint8Array): Promise<PptxSlide[] | null> {
  const paths = await slidePaths(bytes);
  if (!paths) return null;
  const slides: PptxSlide[] = [];
  for (const path of paths) {
    const xmlBytes = await readZipFile(bytes, path);
    if (!xmlBytes) {
      slides.push({ title: '', lines: ['(スライドを読み込めませんでした)'] });
      continue;
    }
    const doc = parseXml(dec.decode(xmlBytes));
    slides.push(doc ? slideFromDoc(doc) : { title: '', lines: ['(スライドを解析できませんでした)'] });
  }
  return slides;
}
