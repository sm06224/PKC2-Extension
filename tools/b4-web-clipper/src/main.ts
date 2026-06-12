/**
 * B4 web-clipper — 貼り付けたページ内容を text offer 化 (issue #26)。
 *
 * 計画の「URL から取得」は単一 HTML(file://)の cross-origin fetch が CORS で
 * 成立しないため、**ペーストモード**に転換: ユーザーがページ上でコピー →
 * ここに貼り付け(HTML クリップボードは inert 抽出)→ title / source_url を
 * 付けて record:offer。外部通信は一切しない。
 */

import '../../shared/base.css';
import './clipper.css';
import { BODY_SIZE_CAP_UTF16_UNITS } from '../../shared/envelope';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-web-clipper';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

/** cap の 9 割で切る(タイトル等のオーバーヘッド余地)。 */
export const CLIP_BODY_LIMIT = Math.floor(BODY_SIZE_CAP_UTF16_UNITS * 0.9);

/** HTML から inert にタイトル + 本文テキストを抽出(描画しない)。Pure-ish. */
export function extractFromHtml(html: string): { title: string; text: string } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,iframe,nav,header,footer,aside,svg').forEach((n) => n.remove());
    const title = (doc.querySelector('title')?.textContent ?? doc.querySelector('h1')?.textContent ?? '').trim();
    const text = (doc.body?.textContent ?? '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { title, text };
  } catch {
    return { title: '', text: '' };
  }
}

/** 上限で切り、切ったら注記を付ける。Pure. */
export function capBody(text: string): { body: string; truncated: boolean } {
  if (text.length <= CLIP_BODY_LIMIT) return { body: text, truncated: false };
  return {
    body: `${text.slice(0, CLIP_BODY_LIMIT)}\n\n…(本文が長いため ${text.length - CLIP_BODY_LIMIT} 文字を切り捨て)`,
    truncated: true,
  };
}

/** source_url に載せてよい URL か(http(s) のみ)。Pure. */
export function isClipUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

export function mountWebClipper(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-b4-root';

  const header = el('div', 'pkc-b4-header');
  header.setAttribute('data-pkc-region', 'b4-header');
  header.appendChild(el('span', 'pkc-b4-title', '✂️ PKC2 Web Clipper'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 貼り付け → text offer(外部通信なし)`));
  header.appendChild(helpButton('Web Clipper', {
    what: 'コピーしたウェブページの内容を貼り付けて、テキスト記事として PKC2 に保存するツールです。URL 取得はしません(完全オフライン)— 取り込みは常にあなたの貼り付け操作起点です。',
    how: [
      '保存したいページで本文を選択してコピー(Ctrl+A → Ctrl+C でも可)',
      'ここの貼り付け欄に Ctrl+V — リッチコピーなら HTML からタイトルと本文を自動抽出します',
      'URL 欄にページの URL を貼ると source_url として記録されます(http(s) のみ)',
      '「Save as Text」で offer → PKC2 側の banner で accept',
    ],
    flow: [
      '貼り付けられた HTML は inert な DOMParser で解析し、script / style / nav 等を除去してテキストだけ抽出します(スクリプト・画像・CSS は実行/取得されません)',
      `本文は ${CLIP_BODY_LIMIT.toLocaleString()} 文字(UTF-16)で打ち切ります(PKC-Message v1 の body 上限対応)`,
    ],
    notes: [
      'URL からの自動取得は単一 HTML ツールでは CORS のため実装していません(壁として記録済み)',
      '画像は保存されません(テキストのみ)',
    ],
  }));
  root.appendChild(header);

  const offerUi = createOfferUi(TOOL_ID);
  root.appendChild(offerUi.conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'b4-form');
  form.appendChild(el('div', 'pkc-panel-heading', 'クリップ'));
  const url = textInput('ページ URL(任意、source_url になります)');
  url.setAttribute('data-pkc-field', 'b4-url');
  form.appendChild(url);
  const title = textInput('タイトル(貼り付けから自動。編集可)');
  title.setAttribute('data-pkc-field', 'b4-title');
  form.appendChild(title);

  const paste = document.createElement('textarea');
  paste.rows = 12;
  paste.placeholder = 'ここに貼り付け(Ctrl+V)— リッチコピーなら HTML から本文を自動抽出します';
  paste.setAttribute('data-pkc-field', 'b4-body');
  form.appendChild(paste);

  const info = el('div', 'pkc-hint');
  info.setAttribute('data-pkc-region', 'b4-info');
  form.appendChild(info);

  paste.addEventListener('paste', (ev) => {
    const html = ev.clipboardData?.getData('text/html') ?? '';
    if (html === '') return; // プレーンテキストは既定の貼り付けに任せる
    ev.preventDefault();
    const { title: t, text } = extractFromHtml(html);
    paste.value = text;
    if (title.value.trim() === '' && t !== '') title.value = t;
    info.textContent = `HTML から抽出: ${text.length.toLocaleString()} 文字${t !== '' ? ` / タイトル「${t}」` : ''}`;
  });
  paste.addEventListener('input', () => {
    info.textContent = `${paste.value.length.toLocaleString()} 文字`;
  });

  const bar = el('div', 'pkc-btn-row');
  bar.appendChild(
    button('Save as Text (record:offer)', 'pkc-btn', () => {
      const text = paste.value.trim();
      if (text === '') {
        offerUi.note('本文が空です — ページの内容を貼り付けてください');
        return;
      }
      const t = title.value.trim() !== '' ? title.value.trim() : `クリップ ${new Date().toISOString().slice(0, 10)}`;
      const { body, truncated } = capBody(text);
      const payload: Record<string, unknown> = { title: t, body, archetype: 'text' };
      const u = url.value.trim();
      if (u !== '') {
        if (!isClipUrl(u)) {
          offerUi.note('URL は http(s) のみ source_url にできます(空にするか修正してください)');
          return;
        }
        payload['source_url'] = u;
      }
      offerUi.sendTracked(t, payload);
      if (truncated) offerUi.note('送信しました(本文は上限で切り捨てています)');
    }),
  );
  bar.appendChild(
    button('クリア', 'pkc-btn-small', () => {
      paste.value = '';
      title.value = '';
      url.value = '';
      info.textContent = '';
    }),
  );
  form.appendChild(bar);
  root.appendChild(form);
  root.appendChild(offerUi.offersPanel);
}

const mountTarget = document.getElementById('b4-root');
if (mountTarget) mountWebClipper(mountTarget);
