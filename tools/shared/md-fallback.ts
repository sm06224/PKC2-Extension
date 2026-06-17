/**
 * md-fallback — ホストのレンダーサービス(SR-18 / `core-render`)が使えない時の
 * **ローカル簡易フォールバック**。PKC-Markdown 方言は再現せず、CommonMark の
 * 安全なサブセットだけを HTML 文字列に変換する。
 *
 * 規律:
 *  - **全テキストをエスケープ**してから組み立てる(生 HTML はテキスト扱い)。
 *  - リンクは **http(s) のみ**(それ以外は素のテキスト)。
 *  - 出力はあくまで「綺麗な描画はホスト借用が正、これは degrade」を示すための
 *    最小実装。F11 ではこの文字列を **sandboxed iframe の srcdoc**(no allow-scripts)
 *    に流すため、万一エスケープに穴があってもスクリプトは実行されない(多層防御)。
 *
 * Pure: DOM/ブラウザ API 非依存(文字列 in → 文字列 out)。テスト可能。
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** code span 以外のテキスト断片を escape → link → bold → italic で装飾。 */
function decorateText(part: string): string {
  let s = escapeHtml(part);
  // [text](url) — http(s) のみリンク化、それ以外はテキストのまま
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
    isHttpUrl(url)
      ? '<a href="' + escapeHtml(url.trim()) + '" rel="noopener noreferrer nofollow">' + text + '</a>'
      : text + '(' + escapeHtml(url) + ')',
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return s;
}

/**
 * インライン装飾。`code` span を境界で分割して別処理(中の記号を変換させない)。
 * sentinel を使わないので衝突しない。
 */
export function renderInline(raw: string): string {
  return raw
    .split(/(`[^`]+`)/g)
    .map((part) => {
      const code = /^`([^`]+)`$/.exec(part);
      return code ? '<code>' + escapeHtml(code[1]!) + '</code>' : decorateText(part);
    })
    .join('');
}

/** Markdown サブセット → HTML 文字列(block 単位)。 */
export function renderMarkdownFallback(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      out.push('<p>' + renderInline(para.join(' ')) + '</p>');
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // fenced code
    if (/^```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      out.push('<pre><code>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1]!.length;
      out.push('<h' + level + '>' + renderInline(h[2]!.trim()) + '</h' + level + '>');
      i++;
      continue;
    }

    // blockquote (consecutive)
    if (/^>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + renderInline(quote.join(' ')) + '</blockquote>');
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push('<li>' + renderInline(lines[i]!.replace(/^\s*[-*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push('<li>' + renderInline(lines[i]!.replace(/^\s*\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }

    // blank line → paragraph break
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join('\n');
}

/** ATX 見出しから簡易 TOC を作る。Pure。 */
export function extractHeadings(src: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) out.push({ level: h[1]!.length, text: h[2]!.trim() });
  }
  return out;
}
