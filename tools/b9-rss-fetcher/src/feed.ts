/**
 * RSS 2.0 / Atom フィードの依存ゼロパーサ(B9 #31)。
 *
 * 入力は貼り付け / ファイルの XML 文字列(ネットワーク取得はしない)。
 * description / content の HTML は inert にテキスト化して返す(描画しない)。
 * link は http(s) のみ採用。壊れた入力では throw せず null。
 */

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  date: string;
}

export interface ParsedFeed {
  kind: 'rss' | 'atom';
  title: string;
  items: FeedItem[];
}

export const MAX_FEED_ITEMS = 200;

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/** HTML 断片 → テキスト(inert、スクリプト等は除去)。Pure-ish. */
export function htmlFragmentToText(html: string): string {
  if (!html.includes('<')) return html.trim();
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,iframe').forEach((n) => n.remove());
    return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function httpOnly(url: string): string {
  return /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : '';
}

function childText(parent: Element, tag: string): string {
  for (const c of Array.from(parent.children)) {
    if (c.tagName === tag || c.tagName.toLowerCase() === tag.toLowerCase()) return (c.textContent ?? '').trim();
  }
  return '';
}

function parseRss(doc: Document): ParsedFeed {
  const channel = doc.getElementsByTagName('channel')[0];
  const items: FeedItem[] = [];
  for (const item of Array.from(doc.getElementsByTagName('item')).slice(0, MAX_FEED_ITEMS)) {
    items.push({
      title: childText(item, 'title') || '(no title)',
      link: httpOnly(childText(item, 'link')),
      summary: htmlFragmentToText(childText(item, 'description')),
      date: childText(item, 'pubDate'),
    });
  }
  return { kind: 'rss', title: channel ? childText(channel, 'title') : '', items };
}

function atomLink(entry: Element): string {
  let fallback = '';
  for (const l of Array.from(entry.children)) {
    if (l.tagName !== 'link') continue;
    const href = httpOnly(l.getAttribute('href') ?? '');
    if (href === '') continue;
    const rel = l.getAttribute('rel') ?? 'alternate';
    if (rel === 'alternate') return href;
    if (fallback === '') fallback = href;
  }
  return fallback;
}

function parseAtom(doc: Document): ParsedFeed {
  const feed = doc.documentElement;
  const items: FeedItem[] = [];
  for (const entry of Array.from(doc.getElementsByTagName('entry')).slice(0, MAX_FEED_ITEMS)) {
    items.push({
      title: childText(entry, 'title') || '(no title)',
      link: atomLink(entry),
      summary: htmlFragmentToText(childText(entry, 'summary') || childText(entry, 'content')),
      date: childText(entry, 'updated') || childText(entry, 'published'),
    });
  }
  return { kind: 'atom', title: childText(feed, 'title'), items };
}

/** フィード XML をパース。RSS/Atom でなければ null。 */
export function parseFeed(text: string): ParsedFeed | null {
  const doc = parseXml(text.trim());
  if (!doc) return null;
  const rootTag = doc.documentElement?.tagName.toLowerCase() ?? '';
  if (rootTag === 'rss' || rootTag === 'rdf:rdf') return parseRss(doc);
  if (rootTag === 'feed') return parseAtom(doc);
  return null;
}

/** item → offer body(summary + 出典 link)。Pure. */
export function itemBody(item: FeedItem): string {
  const parts: string[] = [];
  if (item.summary !== '') parts.push(item.summary);
  if (item.date !== '') parts.push(`> published: ${item.date}`);
  if (item.link !== '') parts.push(item.link);
  return parts.join('\n\n');
}
