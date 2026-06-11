/**
 * In-tool help — a self-contained 「📖 使い方」 button + panel every tool
 * mounts in its header. Single-file HTML tools travel without their repo
 * README, so the manual has to live inside the tool itself.
 *
 * Self-contained on purpose: the component injects its own <style> once
 * (id-guarded), so it works in every tool regardless of which CSS file
 * that tool bundles (A1/F7 do not import base.css). All text is rendered
 * via textContent (repo discipline) — specs are static strings, but the
 * rule is kept uniform anyway.
 */

export interface HelpSpec {
  /** これは何(1〜2 文)。 */
  what: string;
  /** 使い方(番号付き手順)。 */
  how: string[];
  /** どう動くのか(通信の仕組み)。 */
  flow: string[];
  /** 制約・注意。 */
  notes: string[];
  /** 共通の「PKC2 への接続方法」節を付けるか(既定 true)。 */
  connection?: boolean;
}

const CONNECTION_GUIDE: string[] = [
  '① launcher 起動: PKC2 にこの HTML を attachment として取り込み、「PKC-Extension として扱う」を ON にして開く(window.opener 経由で接続)',
  '② iframe 埋め込み: この HTML を pkc2.html と同じ場所に置いて開き、「PKC2 を読み込み」で接続(embedded ホストには export:request も通る)',
  '③ standalone: 接続なしでも UI は動作(送信は不可)',
  '接続インジケータ: 🟢 = pong 受信済み / 🟡 = 確認中 / 🔴 = 応答なし(ホストの origin allowlist は same-origin のみ。別オリジンには接続できません)',
];

const STYLE_ID = 'pkc-help-style';
const PANEL_REGION = 'tool-help';

const HELP_CSS = `
.pkc-help-panel {
  position: fixed; top: 46px; right: 12px; z-index: 120;
  width: min(480px, calc(100vw - 32px)); max-height: calc(100vh - 70px); overflow-y: auto;
  background: var(--c-surface, #111510); color: var(--c-fg, #c8d8b0);
  border: 1px solid var(--c-border, #1e2a16); border-radius: 4px;
  padding: 12px 14px; font-size: 12.5px; line-height: 1.65;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.pkc-help-panel h3 { margin: 10px 0 4px; font-size: 12.5px; color: var(--c-accent, #7fbf3f); }
.pkc-help-panel h3:first-of-type { margin-top: 0; }
.pkc-help-panel p { margin: 0 0 4px; }
.pkc-help-panel ol, .pkc-help-panel ul { margin: 0 0 4px; padding-left: 20px; }
.pkc-help-panel li { margin: 2px 0; }
.pkc-help-close {
  float: right; background: none; border: none; color: inherit;
  cursor: pointer; font-size: 14px; padding: 0 2px;
}
.pkc-help-btn {
  background: var(--c-surface-2, #161c12); color: var(--c-fg, #c8d8b0);
  border: 1px solid var(--c-border, #1e2a16); border-radius: 3px;
  padding: 2px 8px; font-size: 12px; cursor: pointer; flex: 0 0 auto;
}
.pkc-help-btn:hover { border-color: var(--c-accent, #7fbf3f); }
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HELP_CSS;
  document.head.appendChild(style);
}

function section(panel: HTMLElement, title: string, items: string[], ordered: boolean): void {
  if (items.length === 0) return;
  const h = document.createElement('h3');
  h.textContent = title;
  panel.appendChild(h);
  const list = document.createElement(ordered ? 'ol' : 'ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  panel.appendChild(list);
}

export function buildHelpPanel(toolTitle: string, spec: HelpSpec): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'pkc-help-panel';
  panel.setAttribute('data-pkc-region', PANEL_REGION);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pkc-help-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '閉じる');
  close.addEventListener('click', () => panel.remove());
  panel.appendChild(close);

  const h = document.createElement('h3');
  h.textContent = `📖 ${toolTitle} の使い方`;
  panel.appendChild(h);
  const what = document.createElement('p');
  what.textContent = spec.what;
  panel.appendChild(what);

  section(panel, '手順', spec.how, true);
  section(panel, 'どう動くのか(通信)', spec.flow, false);
  if (spec.connection !== false) section(panel, 'PKC2 への接続方法', CONNECTION_GUIDE, false);
  section(panel, '制約・注意', spec.notes, false);
  return panel;
}

/**
 * The 「📖 使い方」 header button. Click toggles the panel (one at a time).
 */
export function helpButton(toolTitle: string, spec: HelpSpec): HTMLButtonElement {
  ensureStyle();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pkc-help-btn';
  btn.textContent = '📖 使い方';
  btn.setAttribute('data-pkc-action', 'toggle-help');
  btn.addEventListener('click', () => {
    const existing = document.querySelector(`[data-pkc-region="${PANEL_REGION}"]`);
    if (existing) {
      existing.remove();
      return;
    }
    document.body.appendChild(buildHelpPanel(toolTitle, spec));
  });
  return btn;
}
