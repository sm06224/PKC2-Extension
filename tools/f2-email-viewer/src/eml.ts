/**
 * .eml(RFC 5322 + MIME)の依存ゼロ・純関数パーサ(F2 #60)。
 *
 * 対応: ヘッダ unfold / RFC 2047(B・Q)/ multipart 再帰 / base64・
 * quoted-printable / charset(TextDecoder、不明は utf-8 fallback)/
 * 添付抽出。**HTML パートは文字列として返すだけ**(描画・サニタイズは
 * 呼び出し側の責務 — 本リポジトリの規律ではテキスト抽出表示のみ)。
 *
 * 非対応(明示): .msg(CFB バイナリ)/ message/rfc822 の入れ子展開 /
 * S/MIME 復号。壊れた入力では throw せず best-effort で返す。
 */

export interface EmlAttachment {
  filename: string;
  mime: string;
  data: Uint8Array;
}

export interface ParsedEml {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  /** 表示用の全ヘッダ(unfold + RFC2047 デコード済み、出現順)。 */
  headers: Array<[string, string]>;
  /** 本文(text/plain 優先)。HTML しか無い場合は空で htmlSource を参照。 */
  text: string;
  /** text/html パートの生 HTML(テキスト抽出表示用 — 描画はしない)。 */
  htmlSource: string;
  attachments: EmlAttachment[];
}

/* ------------------------------------------------------------- bytes */

function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return bytesToLatin1(bytes);
    }
  }
}

function decodeBase64ToBytes(s: string): Uint8Array {
  try {
    return latin1ToBytes(atob(s.replace(/\s+/g, '')));
  } catch {
    return new Uint8Array(0);
  }
}

/** quoted-printable → bytes(soft line break `=\n` 対応)。 */
export function decodeQuotedPrintable(s: string): Uint8Array {
  const cleaned = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    if (c === '=' && i + 2 < cleaned.length + 1) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/* ------------------------------------------------------------ headers */

/** 折り返し(継続行)を unfold して [name, rawValue] の列に。 */
export function unfoldHeaders(headerBlock: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of headerBlock.split(/\r?\n/)) {
    if (line === '') continue;
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1]![1] += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
  }
  return out;
}

/** RFC 2047 encoded-word(=?charset?B/Q?...?=)をデコード。 */
export function decodeRfc2047(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_m, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toUpperCase() === 'B'
          ? decodeBase64ToBytes(text)
          // Q 形式は '_' = SP(RFC 2047 §4.2)
          : decodeQuotedPrintable(text.replace(/_/g, ' '));
      return decodeCharset(bytes, charset.split('*')[0]!);
    },
  ).replace(/\?=\s+=\?/g, '?==?'); // 連続 encoded-word 間の空白(後段で再走しないため軽処理)
}

/** `text/plain; charset=utf-8; name="x"` → { value, params }。 */
export function parseParamHeader(raw: string): { value: string; params: Record<string, string> } {
  const parts = raw.split(';');
  const value = (parts[0] ?? '').trim().toLowerCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim().toLowerCase().replace(/\*$/, '');
    let v = p.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  return { value, params };
}

/* --------------------------------------------------------------- MIME */

interface RawPart {
  headers: Array<[string, string]>;
  bodyLatin1: string;
}

function splitHeadBody(latin1: string): RawPart {
  const m = /\r?\n\r?\n/.exec(latin1);
  if (!m) return { headers: unfoldHeaders(latin1), bodyLatin1: '' };
  return {
    headers: unfoldHeaders(latin1.slice(0, m.index)),
    bodyLatin1: latin1.slice(m.index + m[0].length),
  };
}

function header(part: RawPart, name: string): string {
  const lower = name.toLowerCase();
  return part.headers.find(([k]) => k.toLowerCase() === lower)?.[1] ?? '';
}

function decodeBody(part: RawPart): Uint8Array {
  const cte = header(part, 'Content-Transfer-Encoding').trim().toLowerCase();
  if (cte === 'base64') return decodeBase64ToBytes(part.bodyLatin1);
  if (cte === 'quoted-printable') return decodeQuotedPrintable(part.bodyLatin1);
  return latin1ToBytes(part.bodyLatin1);
}

function splitMultipart(bodyLatin1: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const out: string[] = [];
  const segments = bodyLatin1.split(new RegExp(`(?:^|\\r?\\n)${escapeRe(marker)}`));
  for (const seg of segments.slice(1)) {
    if (seg.startsWith('--')) break; // 終端
    out.push(seg.replace(/^[^\r\n]*\r?\n/, '')); // boundary 行の残り(transport padding)を除去
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Collected {
  text: string;
  htmlSource: string;
  attachments: EmlAttachment[];
}

function walkPart(part: RawPart, acc: Collected, depth: number): void {
  if (depth > 8) return; // 防御: 異常なネスト
  const ct = parseParamHeader(header(part, 'Content-Type') || 'text/plain');
  const disp = parseParamHeader(header(part, 'Content-Disposition'));

  if (ct.value.startsWith('multipart/')) {
    const boundary = ct.params['boundary'];
    if (!boundary) return;
    for (const seg of splitMultipart(part.bodyLatin1, boundary)) {
      walkPart(splitHeadBody(seg), acc, depth + 1);
    }
    return;
  }

  const filenameRaw = disp.params['filename'] ?? ct.params['name'] ?? '';
  const isAttachment = disp.value === 'attachment' || (filenameRaw !== '' && !ct.value.startsWith('text/'));

  if (isAttachment) {
    acc.attachments.push({
      filename: decodeRfc2047(filenameRaw) || `attachment-${acc.attachments.length + 1}`,
      mime: ct.value || 'application/octet-stream',
      data: decodeBody(part),
    });
    return;
  }

  const charset = ct.params['charset'] ?? 'utf-8';
  if (ct.value === 'text/plain' || ct.value === '') {
    const t = decodeCharset(decodeBody(part), charset);
    acc.text += (acc.text !== '' ? '\n\n' : '') + t;
  } else if (ct.value === 'text/html') {
    acc.htmlSource += decodeCharset(decodeBody(part), charset);
  } else {
    // 不明 type で filename 無し → inline 添付として保全
    acc.attachments.push({
      filename: `part-${acc.attachments.length + 1}`,
      mime: ct.value,
      data: decodeBody(part),
    });
  }
}

/* ---------------------------------------------------------------- main */

export function parseEml(bytes: Uint8Array): ParsedEml {
  const root = splitHeadBody(bytesToLatin1(bytes));
  const acc: Collected = { text: '', htmlSource: '', attachments: [] };
  walkPart(root, acc, 0);

  const headers: Array<[string, string]> = root.headers.map(([k, v]) => [k, decodeRfc2047(v)]);
  const h = (name: string): string => decodeRfc2047(header(root, name));

  return {
    subject: h('Subject'),
    from: h('From'),
    to: h('To'),
    cc: h('Cc'),
    date: h('Date'),
    headers,
    text: acc.text.trim(),
    htmlSource: acc.htmlSource,
    attachments: acc.attachments,
  };
}
