/**
 * F9 md-note — Markdown + Mermaid ノートエディタ (issue #67)。
 *
 * 3 ペイン(アウトライン / エディタ / プレビュー)。Markdown は自作ミニパーサ
 * (./markdown.ts、生 HTML はテキスト扱い)で DOM 構築し、```mermaid フェンス
 * のみ mermaid で描画する。「Save as Text」で本文(Markdown ソース)を
 * text entry として record:offer(correlation 追跡付き)。
 *
 * Security note — innerHTML は F7 と同じ唯一の例外(mermaid の SVG、入力は
 * ローカル編集テキストのみ + securityLevel: 'strict')。それ以外は textContent。
 */

import '../../shared/base.css';
import './note.css';
import mermaid from 'mermaid';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, textInput } from '../../shared/ui';
import { defaultNoteTitle, extractOutline, parseMarkdown, renderMarkdown } from './markdown';

declare const __MERMAID_VERSION__: string;

const TOOL_NAME = 'pkc2-md-note';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const DRAFT_KEY = 'pkc2-f9-md-note:draft';
const DEBOUNCE_MS = 400;

let renderSeq = 0;

function saveDraft(source: string, title: string): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ source, title }));
  } catch {
    /* best-effort */
  }
}

function loadDraft(): { source: string; title: string } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { source?: unknown; title?: unknown };
    if (typeof p.source !== 'string') return null;
    return { source: p.source, title: typeof p.title === 'string' ? p.title : '' };
  } catch {
    return null;
  }
}

const STARTER = `# 新しいノート

ここに **Markdown** で書きます。*強調*、\`code\`、[リンク](https://example.com) が使えます。

## Mermaid 図

\`\`\`mermaid
graph LR
  A[アイデア] --> B{検討}
  B -->|採用| C[実装]
  B -->|保留| D[メモ]
\`\`\`

## リスト

- 箇条書き
- 2 つ目

1. 番号付き
2. 2 番

> 引用もこの通り

| 列 A | 列 B |
|------|------|
| あ   | い   |
`;

export function mountMdNote(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-md-root';
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });

  const header = el('div', 'pkc-md-header');
  header.setAttribute('data-pkc-region', 'md-header');
  header.appendChild(el('span', 'pkc-md-title', '📝 PKC2 Markdown Note'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — Markdown + Mermaid(v${__MERMAID_VERSION__})ノート・オフライン`),
  );
  header.appendChild(helpButton('Markdown Note', {
    what: 'Markdown と Mermaid 図で書けるノートエディタです。本文を text entry として PKC2 に保存できます(往復可能 — PKC2 の text entry を貼り直せば再編集)。',
    how: [
      '中央のエディタに Markdown を書く(右にライブプレビュー、左に見出しアウトライン)',
      'ツールバー or Ctrl+B / Ctrl+I で装飾、「Mermaid ブロック」で図の雛形を挿入',
      '「Save as Text」(Ctrl+S)で offer → PKC2 側の banner で accept',
    ],
    flow: [
      'Markdown は自作ミニパーサで表示します — 生 HTML は常にテキスト扱い(実行されません)、リンクは http(s) のみ',
      '```mermaid フェンスだけ mermaid(strict)で描画します',
      'offer の body は Markdown ソースそのもの(PKC2 側では PKC2 の markdown 表示が適用されます)',
    ],
    notes: [
      'PKC2 本体の markdown とは対応範囲が異なる場合があります(本体は方言追加を凍結中)',
      '画像の貼り付け(attachment 化)は v1 では不可(asset 同送禁止)',
      '下書きは自動でローカル保存されます(このブラウザ内のみ)',
    ],
  }));
  root.appendChild(header);

  const offerUi = createOfferUi(TOOL_ID);
  root.appendChild(offerUi.conn.root);

  // ---- toolbar
  const toolbar = el('div', 'pkc-md-toolbar');
  toolbar.setAttribute('data-pkc-region', 'md-toolbar');

  const wrapSelection = (before: string, after: string, placeholder: string): void => {
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const selected = editor.value.slice(s, e) || placeholder;
    editor.value = editor.value.slice(0, s) + before + selected + after + editor.value.slice(e);
    editor.focus();
    editor.selectionStart = s + before.length;
    editor.selectionEnd = s + before.length + selected.length;
    onEdit();
  };
  const insertBlock = (block: string): void => {
    const s = editor.selectionStart;
    const prefix = s > 0 && editor.value[s - 1] !== '\n' ? '\n' : '';
    editor.value = `${editor.value.slice(0, s)}${prefix}${block}${editor.value.slice(s)}`;
    editor.focus();
    onEdit();
  };

  toolbar.appendChild(button('B', 'pkc-btn-small pkc-md-bold', () => wrapSelection('**', '**', '太字'), 'Ctrl+B'));
  toolbar.appendChild(button('I', 'pkc-btn-small pkc-md-italic', () => wrapSelection('*', '*', '斜体'), 'Ctrl+I'));
  toolbar.appendChild(button('` `', 'pkc-btn-small', () => wrapSelection('`', '`', 'code')));
  toolbar.appendChild(button('H2', 'pkc-btn-small', () => insertBlock('\n## 見出し\n')));
  toolbar.appendChild(button('リスト', 'pkc-btn-small', () => insertBlock('\n- 項目 1\n- 項目 2\n')));
  toolbar.appendChild(button('リンク', 'pkc-btn-small', () => wrapSelection('[', '](https://)', 'ラベル')));
  toolbar.appendChild(button('Mermaid ブロック', 'pkc-btn-small', () => insertBlock('\n```mermaid\ngraph LR\n  A --> B\n```\n')));
  toolbar.appendChild(button('サンプル', 'pkc-btn-small', () => {
    editor.value = STARTER;
    onEdit();
  }));
  root.appendChild(toolbar);

  // ---- 3 panes
  const split = el('div', 'pkc-md-split');
  const outline = el('div', 'pkc-md-outline');
  outline.setAttribute('data-pkc-region', 'md-outline');
  const editor = document.createElement('textarea');
  editor.className = 'pkc-md-editor';
  editor.setAttribute('data-pkc-field', 'md-source');
  editor.spellcheck = false;
  editor.placeholder = 'ここに Markdown を書く(「サンプル」から始められます)';
  const preview = el('div', 'pkc-md-preview');
  preview.setAttribute('data-pkc-region', 'md-preview');
  split.appendChild(outline);
  split.appendChild(editor);
  split.appendChild(preview);
  root.appendChild(split);

  // ---- save
  const save = el('div', 'pkc-panel');
  save.setAttribute('data-pkc-region', 'md-save');
  save.appendChild(el('div', 'pkc-panel-heading', '保存'));
  const title = textInput('entry title(空なら最初の見出し)');
  save.appendChild(title);
  const saveRow = el('div', 'pkc-btn-row');
  const doOffer = (): void => {
    const source = editor.value;
    if (source.trim() === '') {
      offerUi.note('本文が空です');
      return;
    }
    const blocks = parseMarkdown(source);
    const t = title.value.trim() !== '' ? title.value.trim() : defaultNoteTitle(blocks);
    offerUi.sendTracked(t, { title: t, body: source, archetype: 'text' });
  };
  saveRow.appendChild(button('Save as Text (record:offer)', 'pkc-btn', doOffer, 'Ctrl+S'));
  saveRow.appendChild(button('💾 .md ダウンロード', 'pkc-btn-small', () => {
    const blob = new Blob([editor.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'note.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  save.appendChild(saveRow);
  root.appendChild(save);
  root.appendChild(offerUi.offersPanel);

  // ---- rendering
  function renderMermaidInto(code: string, container: HTMLElement): void {
    const id = `md-mmd-${++renderSeq}`;
    container.textContent = '描画中…';
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        // F7 と同じ唯一の例外: ローカル入力 + strict の mermaid SVG のみ innerHTML
        container.innerHTML = svg;
      })
      .catch((ex: unknown) => {
        container.replaceChildren(
          el('div', 'pkc-form-error', `Mermaid 構文エラー: ${ex instanceof Error ? ex.message : String(ex)}`),
        );
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      });
  }

  function renderPreview(): void {
    const blocks = parseMarkdown(editor.value);
    const { root: doc, headings } = renderMarkdown(blocks, { mermaid: renderMermaidInto });
    preview.replaceChildren(doc);

    outline.replaceChildren(el('div', 'pkc-panel-heading', '目次'));
    const items = extractOutline(blocks);
    if (items.length === 0) {
      outline.appendChild(el('div', 'pkc-hint', '見出しがありません'));
      return;
    }
    items.forEach((h, idx) => {
      const row = button(h.text, 'pkc-md-tocitem', () => {
        headings[idx]?.scrollIntoView({ block: 'start' });
      });
      row.style.paddingLeft = `${(h.level - 1) * 10 + 4}px`;
      outline.appendChild(row);
    });
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  function onEdit(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(renderPreview, DEBOUNCE_MS);
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(editor.value, title.value), 600);
  }
  editor.addEventListener('input', onEdit);
  title.addEventListener('input', onEdit);

  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      editor.value = `${editor.value.slice(0, s)}  ${editor.value.slice(e)}`;
      editor.selectionStart = editor.selectionEnd = s + 2;
      onEdit();
      return;
    }
    if (!(ev.ctrlKey || ev.metaKey)) return;
    if (ev.key === 'b' || ev.key === 'B') {
      ev.preventDefault();
      wrapSelection('**', '**', '太字');
    } else if (ev.key === 'i' || ev.key === 'I') {
      ev.preventDefault();
      wrapSelection('*', '*', '斜体');
    } else if (ev.key === 's' || ev.key === 'S') {
      ev.preventDefault();
      doOffer();
    }
  });

  const draft = loadDraft();
  if (draft) {
    editor.value = draft.source;
    title.value = draft.title;
  }
  renderPreview();
}

const mountTarget = document.getElementById('mdnote-root');
if (mountTarget) mountMdNote(mountTarget);
