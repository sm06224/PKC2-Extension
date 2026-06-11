/**
 * B15 form-template — form archetype offer (issue #37).
 *
 * PKC2 の form body は **固定 3 フィールド**(name / note / checked)の
 * JSON(動的スキーマではない — form-presenter.ts で確認)。本ツールは
 * その形をテンプレ付きで素早く作る入力フォーム。
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, selectInput, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-form-template';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;

export const FORM_TEMPLATES: ReadonlyArray<{ label: string; note: string }> = [
  { label: '空', note: '' },
  { label: '申請メモ', note: '対象:\n理由:\n期限:' },
  { label: 'チェック項目', note: '確認内容:\n確認者:\n結果:' },
];

/** PKC2 form body({name, note, checked})。Pure. */
export function buildFormBody(name: string, note: string, checked: boolean): string {
  return JSON.stringify({ name, note, checked });
}

export function mountFormTemplate(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  const ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '📋 PKC2 Form Template'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — form archetype(name/note/checked)を素早く offer`));
  header.appendChild(helpButton('Form Template', {
    what: 'PKC2 の form archetype(name / note / checked の固定 3 フィールド)をテンプレから素早く作って offer します。',
    how: ['PKC2 に接続する', 'テンプレを選ぶ(note に雛形が入ります)', 'title と name / note / checked を整える', 'Send → PKC2 側 banner で accept'],
    flow: ['body は {"name":…,"note":…,"checked":…} の JSON 文字列として archetype: form で送信されます'],
    notes: ['form body は固定 3 フィールドです(動的スキーマではありません — PKC2 form-presenter の仕様)'],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const panel = el('div', 'pkc-panel');
  panel.setAttribute('data-pkc-region', 'tool-form');
  const tpl = selectInput(FORM_TEMPLATES.map((t, i) => ({ value: String(i), label: `テンプレ: ${t.label}` })));
  const title = textInput('entry title(必須)');
  const name = textInput('name(フォームの件名)');
  const note = document.createElement('textarea');
  note.rows = 5;
  note.placeholder = 'note';
  const checkedLabel = el('label', 'pkc-inline-check');
  const checked = document.createElement('input');
  checked.type = 'checkbox';
  checkedLabel.appendChild(checked);
  checkedLabel.appendChild(document.createTextNode(' checked'));
  tpl.addEventListener('change', () => {
    const t = FORM_TEMPLATES[Number(tpl.value)];
    if (t) note.value = t.note;
  });
  const err = el('div', 'pkc-form-error');
  panel.appendChild(tpl);
  panel.appendChild(title);
  panel.appendChild(name);
  panel.appendChild(note);
  panel.appendChild(checkedLabel);
  panel.appendChild(
    button('Send form offer', 'pkc-btn', () => {
      err.textContent = '';
      if (title.value.trim() === '') {
        err.textContent = 'title は必須です';
        return;
      }
      ui.sendTracked(title.value.trim(), {
        title: title.value.trim(),
        body: buildFormBody(name.value, note.value, checked.checked),
        archetype: 'form',
      });
    }),
  );
  panel.appendChild(err);
  root.appendChild(panel);
  root.appendChild(ui.offersPanel);
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountFormTemplate(mountTarget);
