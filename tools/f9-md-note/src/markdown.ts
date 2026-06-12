/**
 * F9 md-note の依存ゼロ・ミニ Markdown パーサ + DOM レンダラ (issue #67)。
 *
 * 対応: 見出し / 段落 / fenced code(```mermaid は呼び出し側 callback で描画)/
 * 箇条書き・番号リスト / 引用 / 罫線 / テーブル / インライン(`code`・
 * **bold**・*italic*・[link](http(s) のみ))。
 *
 * 非対応(明示): 生 HTML(常にテキスト扱い = 注入面なし)、ネスト
 * リスト、入れ子強調。リンクは http(s) 以外を**リンク化しない**。
 * PKC2 本体の markdown 表示とは互換範囲が異なる(本体は方言凍結中)。
 */

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; header: string[]; rows: string[][] };

const FENCE_RE = /^```([\w-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^[-*+]\s+(.*)$/;
const OL_RE = /^\d+[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/** 行ベースの block パース。Pure. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.split(/\r?\n/);
  const blocks: MdBlock[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join('\n') });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? '';
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: 'code', lang, code: code.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (line.startsWith('>')) {
      flushPara();
      const quote: string[] = [line.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1]!.startsWith('>')) {
        i++;
        quote.push(lines[i]!.replace(/^>\s?/, ''));
      }
      blocks.push({ kind: 'quote', text: quote.join('\n') });
      continue;
    }

    const ul = UL_RE.exec(line);
    const ol = OL_RE.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const items: string[] = [(ul ?? ol)![1]!];
      while (i + 1 < lines.length) {
        const next = ordered ? OL_RE.exec(lines[i + 1]!) : UL_RE.exec(lines[i + 1]!);
        if (!next) break;
        i++;
        items.push(next[1]!);
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|')) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/;

/** インライン記法 → Node 列(textContent ベース、生 HTML はテキスト扱い)。 */
export function renderInline(text: string): Node[] {
  const out: Node[] = [];
  let rest = text;
  for (;;) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      if (rest !== '') out.push(document.createTextNode(rest));
      break;
    }
    if (m.index > 0) out.push(document.createTextNode(rest.slice(0, m.index)));
    const tok = m[0];
    if (tok.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = tok.slice(1, -1);
      out.push(code);
    } else if (tok.startsWith('**')) {
      const b = document.createElement('strong');
      b.textContent = tok.slice(2, -2);
      out.push(b);
    } else if (tok.startsWith('*')) {
      const em = document.createElement('em');
      em.textContent = tok.slice(1, -1);
      out.push(em);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = link[2]!;
      if (/^https?:\/\//i.test(href)) {
        const a = document.createElement('a');
        a.textContent = link[1]!;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        out.push(a);
      } else {
        // javascript: 等はリンク化せず素のテキストに
        out.push(document.createTextNode(tok));
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

export interface RenderOptions {
  /** ```mermaid フェンスの描画 callback(未指定ならコードブロック表示)。 */
  mermaid?: (code: string, container: HTMLElement) => void;
}

/** block 列 → DOM。見出し要素の配列も返す(アウトライン用)。 */
export function renderMarkdown(blocks: MdBlock[], opts: RenderOptions = {}): { root: HTMLElement; headings: HTMLElement[] } {
  const root = document.createElement('div');
  root.className = 'pkc-md-doc';
  const headings: HTMLElement[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading') {
      const h = document.createElement(`h${Math.min(6, Math.max(1, b.level))}`);
      h.append(...renderInline(b.text));
      root.appendChild(h);
      headings.push(h);
    } else if (b.kind === 'code') {
      if (b.lang === 'mermaid' && opts.mermaid) {
        const box = document.createElement('div');
        box.className = 'pkc-md-mermaid';
        opts.mermaid(b.code, box);
        root.appendChild(box);
      } else {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = b.code;
        pre.appendChild(code);
        root.appendChild(pre);
      }
    } else if (b.kind === 'list') {
      const list = document.createElement(b.ordered ? 'ol' : 'ul');
      for (const item of b.items) {
        const li = document.createElement('li');
        li.append(...renderInline(item));
        list.appendChild(li);
      }
      root.appendChild(list);
    } else if (b.kind === 'quote') {
      const q = document.createElement('blockquote');
      q.append(...renderInline(b.text));
      root.appendChild(q);
    } else if (b.kind === 'hr') {
      root.appendChild(document.createElement('hr'));
    } else if (b.kind === 'table') {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      for (const c of b.header) {
        const th = document.createElement('th');
        th.append(...renderInline(c));
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const r of b.rows) {
        const tr = document.createElement('tr');
        for (const c of r) {
          const td = document.createElement('td');
          td.append(...renderInline(c));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      root.appendChild(table);
    } else {
      const p = document.createElement('p');
      p.append(...renderInline(b.text));
      root.appendChild(p);
    }
  }
  return { root, headings };
}

/** アウトライン(見出しのみ)。Pure. */
export function extractOutline(blocks: MdBlock[]): Array<{ level: number; text: string }> {
  return blocks.filter((b): b is Extract<MdBlock, { kind: 'heading' }> => b.kind === 'heading')
    .map((b) => ({ level: b.level, text: b.text }));
}

/** 既定タイトル = 最初の見出し(無ければ fallback)。Pure. */
export function defaultNoteTitle(blocks: MdBlock[], fallback = '無題ノート'): string {
  const h = extractOutline(blocks)[0];
  return h && h.text.trim() !== '' ? h.text.trim() : fallback;
}
