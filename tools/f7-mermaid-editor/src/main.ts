/**
 * F7 mermaid-editor — Mermaid live editor + PKC2 offer (issue #65).
 *
 * Split pane: source editor (left) / live preview (right), 500ms debounce,
 * diagram templates, theme switch, SVG copy / SVG・PNG download, and
 * "Save as Text" which sends a `record:offer` whose body is the source in a
 * ```mermaid fence (round-trippable; PKC2 shows it as a code block).
 *
 * Security note — the ONE deliberate exception to the repo's
 * "textContent only" rule: the preview injects mermaid's rendered SVG via
 * innerHTML. The input is the user's *local* typing (never postMessage
 * data; v1 has no read path), and mermaid runs with
 * `securityLevel: 'strict'` which sanitizes labels. Documented in README.
 */

import '../../shared/base.css';
import './editor.css';
import mermaid from 'mermaid';
import { createHostConnection, type HostConnection } from '../../shared/host-connect';
import { button, el, selectInput, textInput } from '../../shared/ui';
import { buildMermaidOfferBody, defaultTitle } from './offer-body';
import { TEMPLATES } from './templates';

declare const __MERMAID_VERSION__: string;

const TOOL_NAME = 'pkc2-mermaid-editor';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const DRAFT_KEY = 'pkc2-f7-mermaid-editor:draft';
const DEBOUNCE_MS = 500;

type MermaidTheme = 'dark' | 'default' | 'forest' | 'neutral';

let renderSeq = 0;
let lastGoodSvg = '';

function initMermaid(theme: MermaidTheme): void {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
}

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

function downloadBlob(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountMermaidEditor(root: HTMLElement): { conn: HostConnection } {
  root.replaceChildren();
  root.className = 'pkc-mmd-root';
  initMermaid('dark');

  const header = el('div', 'pkc-mmd-header');
  header.setAttribute('data-pkc-region', 'mmd-header');
  header.appendChild(el('span', 'pkc-mmd-title', '📈 PKC2 Mermaid Editor'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — mermaid v${__MERMAID_VERSION__} (MIT) 同梱・オフライン動作`),
  );
  root.appendChild(header);

  const status = el('div', 'pkc-mmd-status');
  const conn = createHostConnection({
    sourceId: TOOL_ID,
    onNote: (text) => {
      status.textContent = text;
    },
  });
  root.appendChild(conn.root);

  // ---- toolbar
  const toolbar = el('div', 'pkc-mmd-toolbar');
  toolbar.setAttribute('data-pkc-region', 'mmd-toolbar');
  for (const t of TEMPLATES) {
    toolbar.appendChild(
      button(t.label, 'pkc-btn-small', () => {
        editor.value = t.code;
        scheduleRender();
        persist();
      }, `${t.label} のスターターを挿入`),
    );
  }
  const theme = selectInput([
    { value: 'dark', label: 'theme: dark' },
    { value: 'default', label: 'theme: default' },
    { value: 'forest', label: 'theme: forest' },
    { value: 'neutral', label: 'theme: neutral' },
  ]);
  theme.classList.add('pkc-mmd-theme');
  theme.addEventListener('change', () => {
    initMermaid(theme.value as MermaidTheme);
    void renderNow();
  });
  toolbar.appendChild(theme);
  root.appendChild(toolbar);

  // ---- split pane
  const split = el('div', 'pkc-mmd-split');
  const editor = document.createElement('textarea');
  editor.className = 'pkc-mmd-editor';
  editor.setAttribute('data-pkc-field', 'mmd-source');
  editor.spellcheck = false;
  editor.placeholder = '左にコードを書くと右にライブプレビュー(テンプレボタンから始められます)';
  // Tab inserts spaces instead of leaving the editor.
  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      editor.value = `${editor.value.slice(0, s)}  ${editor.value.slice(e)}`;
      editor.selectionStart = editor.selectionEnd = s + 2;
      scheduleRender();
    }
  });
  const preview = el('div', 'pkc-mmd-preview');
  preview.setAttribute('data-pkc-region', 'mmd-preview');
  split.appendChild(editor);
  split.appendChild(preview);
  root.appendChild(split);

  const errorBar = el('div', 'pkc-form-error');
  errorBar.setAttribute('data-pkc-region', 'mmd-error');
  root.appendChild(errorBar);

  // ---- export / save
  const save = el('div', 'pkc-panel pkc-mmd-save');
  save.setAttribute('data-pkc-region', 'mmd-save');
  const title = textInput('entry title(空なら自動)');
  const saveRow = el('div', 'pkc-btn-row');
  saveRow.appendChild(
    button('Save as Text (record:offer)', 'pkc-btn', () => {
      const source = editor.value;
      if (source.trim() === '') {
        status.textContent = 'コードが空です';
        return;
      }
      const payload = {
        title: title.value.trim() !== '' ? title.value.trim() : defaultTitle(source),
        body: buildMermaidOfferBody(source),
        archetype: 'text',
      };
      const sent = conn.send('record:offer', payload);
      if (sent) status.textContent = `record:offer 送信: "${payload.title}" — ホスト側 banner で accept してください`;
    }),
  );
  saveRow.appendChild(
    button('Copy SVG', 'pkc-btn-small', () => {
      if (lastGoodSvg === '') {
        status.textContent = 'まだ有効なレンダリング結果がありません';
        return;
      }
      void navigator.clipboard
        .writeText(lastGoodSvg)
        .then(() => {
          status.textContent = 'SVG をコピーしました';
        })
        .catch(() => {
          status.textContent = 'clipboard API が使えない環境です(Download SVG を使ってください)';
        });
    }),
  );
  saveRow.appendChild(
    button('Download SVG', 'pkc-btn-small', () => {
      if (lastGoodSvg === '') {
        status.textContent = 'まだ有効なレンダリング結果がありません';
        return;
      }
      downloadBlob(new Blob([lastGoodSvg], { type: 'image/svg+xml' }), 'diagram.svg');
    }),
  );
  saveRow.appendChild(
    button('Download PNG', 'pkc-btn-small', () => {
      if (lastGoodSvg === '') {
        status.textContent = 'まだ有効なレンダリング結果がありません';
        return;
      }
      svgToPng(lastGoodSvg)
        .then((blob) => downloadBlob(blob, 'diagram.png'))
        .catch(() => {
          status.textContent = 'PNG 変換に失敗しました(SVG でダウンロードしてください)';
        });
    }),
  );
  save.appendChild(el('div', 'pkc-panel-heading', '保存'));
  save.appendChild(title);
  save.appendChild(saveRow);
  save.appendChild(
    el('div', 'pkc-hint', 'text entry(```mermaid fence)として offer します。SVG の attachment 化は v1 では不可(asset 同送禁止、spec §6.3 / SR-13・SR-14・SR-15)— SVG/PNG はローカル保存で代替'),
  );
  save.appendChild(status);
  root.appendChild(save);

  // ---- rendering
  let timer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRender(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void renderNow();
    }, DEBOUNCE_MS);
  }

  async function renderNow(): Promise<void> {
    const code = editor.value;
    if (code.trim() === '') {
      preview.replaceChildren(el('div', 'pkc-hint', 'プレビューはここに表示されます'));
      errorBar.textContent = '';
      return;
    }
    const id = `mmd-render-${++renderSeq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      lastGoodSvg = svg;
      // Deliberate innerHTML (see file header): local input + mermaid strict sanitization.
      preview.innerHTML = svg;
      errorBar.textContent = '';
    } catch (ex) {
      // Keep the last good diagram; surface the parse error.
      errorBar.textContent = `構文エラー: ${ex instanceof Error ? ex.message : String(ex)}`;
      // mermaid can leave an orphan error element behind — clean it up.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }

  function persist(): void {
    saveDraft(editor.value, title.value);
  }
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  editor.addEventListener('input', () => {
    scheduleRender();
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(persist, 400);
  });
  title.addEventListener('input', () => {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(persist, 400);
  });

  const draft = loadDraft();
  if (draft) {
    editor.value = draft.source;
    title.value = draft.title;
  }
  scheduleRender();
  return { conn };
}

async function svgToPng(svg: string): Promise<Blob> {
  const img = new Image();
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('svg load failed'));
    img.src = svgUrl;
  });
  const canvas = document.createElement('canvas');
  const scale = 2; // crisp on hi-dpi
  canvas.width = Math.max(1, img.naturalWidth || 800) * scale;
  canvas.height = Math.max(1, img.naturalHeight || 600) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

const mountTarget = document.getElementById('mermaid-root');
if (mountTarget) mountMermaidEditor(mountTarget);
