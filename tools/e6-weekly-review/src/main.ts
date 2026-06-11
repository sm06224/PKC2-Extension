/**
 * E6 weekly-review — 週次レビュー(KPT)→ text offer (issue #57).
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-weekly-review';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

/** ISO 週番号(YYYY-Www)。Pure. */
export function isoWeekTitle(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // 木曜に寄せる(ISO 8601)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')} 週次レビュー`;
}

const DEFAULT_BODY = '## Keep(続けること)\n- \n\n## Problem(課題)\n- \n\n## Try(来週やること)\n- [ ] ';

export function mountWeeklyReview(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  const ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '🗓 PKC2 Weekly Review'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 今週の KPT を text offer`));
  header.appendChild(helpButton('Weekly Review', {
    what: '週次レビュー(KPT)を書いて、ISO 週番号付きの text entry として offer します。',
    how: ['PKC2 に接続する', 'Keep / Problem / Try を埋める', 'offer → PKC2 側で accept'],
    flow: ['title は「YYYY-Www 週次レビュー」(ISO 8601 週番号)で自動採番されます'],
    notes: [],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'tool-form');
  panel.appendChild(el('div', 'pkc-panel-heading', isoWeekTitle()));
  const body = document.createElement('textarea');
  body.rows = 12;
  body.value = DEFAULT_BODY;
  panel.appendChild(body);
  panel.appendChild(
    button('今週のレビューを offer', 'pkc-btn', () => {
      const title = isoWeekTitle();
      ui.sendTracked(title, { title, body: body.value, archetype: 'text' });
    }),
  );
  root.appendChild(panel);
  root.appendChild(ui.offersPanel);
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountWeeklyReview(mountTarget);
