/**
 * E4 meeting-notes — 議事録テンプレ → text offer (issue #55).
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-meeting-notes';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

/** 議事録 markdown を組み立てる。Pure. */
export function buildMinutes(meeting: string, attendees: string, body: string, at: Date = new Date()): { title: string; md: string } {
  const d = at.toISOString().slice(0, 10);
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const title = `${d} ${meeting !== '' ? meeting : '会議メモ'}`;
  const md = [
    `# ${title}`,
    '',
    `- 日時: ${d} ${hm}`,
    `- 参加者: ${attendees !== '' ? attendees : '-'}`,
    '',
    body,
  ].join('\n');
  return { title, md };
}

const DEFAULT_BODY = '## アジェンダ\n- \n\n## 決定事項\n- \n\n## TODO\n- [ ] ';

export function mountMeetingNotes(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  const ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '📝 PKC2 Meeting Notes'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — テンプレ議事録を text offer`));
  header.appendChild(helpButton('Meeting Notes', {
    what: '議事録テンプレ(日時・参加者・アジェンダ / 決定事項 / TODO)を埋めて text entry として offer します。',
    how: ['PKC2 に接続する', '会議名と参加者を入れる(日時は自動)', '本文テンプレを編集', 'Send → PKC2 側で accept'],
    flow: ['title は「YYYY-MM-DD 会議名」、body は markdown(- [ ] の TODO は PKC2 のタスク表記)'],
    notes: [],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'tool-form');
  const meeting = textInput('会議名');
  const attendees = textInput('参加者(カンマ区切り)');
  const body = document.createElement('textarea');
  body.rows = 10;
  body.value = DEFAULT_BODY;
  panel.appendChild(meeting);
  panel.appendChild(attendees);
  panel.appendChild(body);
  panel.appendChild(
    button('議事録を offer', 'pkc-btn', () => {
      const m = buildMinutes(meeting.value.trim(), attendees.value.trim(), body.value);
      ui.sendTracked(m.title, { title: m.title, body: m.md, archetype: 'text' });
    }),
  );
  root.appendChild(panel);
  root.appendChild(ui.offersPanel);
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountMeetingNotes(mountTarget);
