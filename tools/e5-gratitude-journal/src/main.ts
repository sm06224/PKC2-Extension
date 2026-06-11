/**
 * E5 gratitude-journal — 毎日の感謝 3 行を textlog で offer (issue #56).
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { dailyTitle, makeLogEntry, serializeTextlogEntries } from '../../shared/textlog-body';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-gratitude-journal';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

export function mountGratitude(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  const ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '🙏 PKC2 Gratitude Journal'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 今日の感謝 3 つを textlog で offer`));
  header.appendChild(helpButton('Gratitude Journal', {
    what: '今日感謝したこと 3 つを書き、日付タイトルの textlog として offer します。',
    how: ['PKC2 に接続する', '3 つの欄を埋める(全部でなくても可)', 'offer → PKC2 側で accept'],
    flow: ['各行が 1 ログ行(タイムスタンプ付き)の textlog body になります'],
    notes: [],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'tool-form');
  const inputs = [1, 2, 3].map((n) => {
    const i = textInput(`感謝 ${n}`);
    panel.appendChild(i);
    return i;
  });
  const err = el('div', 'pkc-form-error');
  panel.appendChild(
    button('今日の感謝を offer', 'pkc-btn', () => {
      err.textContent = '';
      const lines = inputs.map((i) => i.value.trim()).filter((v) => v !== '');
      if (lines.length === 0) {
        err.textContent = '1 つ以上書いてください';
        return;
      }
      const title = `感謝 ${dailyTitle()}`;
      const entries = lines.map((l, idx) => makeLogEntry(`🙏 ${l}`, new Date(Date.now() + idx)));
      if (ui.sendTracked(title, { title, body: serializeTextlogEntries(entries), archetype: 'textlog' })) {
        for (const i of inputs) i.value = '';
      }
    }),
  );
  panel.appendChild(err);
  root.appendChild(panel);
  root.appendChild(ui.offersPanel);
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountGratitude(mountTarget);
