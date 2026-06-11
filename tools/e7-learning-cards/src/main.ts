/**
 * E7 learning-cards — フラッシュカード作成・学習・デッキ offer (issue #58).
 *
 * カードはローカル(localStorage)。デッキは再取り込み可能な markdown
 * 書式(## Q: / A:)の text entry として offer できる。
 */

import '../../shared/base.css';
import './tool.css';
import { helpButton } from '../../shared/help';
import { createOfferUi } from '../../shared/offer-ui';
import { button, el, textInput } from '../../shared/ui';

const TOOL_NAME = 'pkc2-learning-cards';
const TOOL_VERSION = '0.1.0';
const TOOL_ID = `ext:${TOOL_NAME}@${TOOL_VERSION}`;
const STORE_KEY = 'pkc2-e7-cards:deck';

export interface Card {
  q: string;
  a: string;
}

/** デッキ → markdown(再取り込み可能な書式)。Pure. */
export function deckToMarkdown(name: string, cards: readonly Card[]): string {
  const lines = [`# ${name}`, ''];
  for (const c of cards) {
    lines.push(`## Q: ${c.q}`, `A: ${c.a}`, '');
  }
  return lines.join('\n');
}

/** markdown → デッキ(deckToMarkdown の逆)。Pure. */
export function markdownToDeck(md: string): Card[] {
  const cards: Card[] = [];
  const re = /^## Q:[ \t]*(.+)\r?\nA:[ \t]*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    cards.push({ q: m[1]!.trim(), a: m[2]!.trim() });
  }
  return cards;
}

let cards: Card[] = [];
let studyIdx = -1;
let revealed = false;
let listEl: HTMLElement | null = null;
let studyEl: HTMLElement | null = null;
let ui: ReturnType<typeof createOfferUi> | null = null;

function persist(): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cards));
  } catch { /* best-effort */ }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    cards = parsed.filter(
      (x): x is Card => x !== null && typeof x === 'object' && typeof (x as Card).q === 'string' && typeof (x as Card).a === 'string',
    );
  } catch { /* best-effort */ }
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  if (cards.length === 0) {
    listEl.appendChild(el('div', 'pkc-hint', 'Q と A を追加してください'));
    return;
  }
  for (const [i, c] of cards.entries()) {
    const row = el('div', 'pkc-sot-listrow');
    row.appendChild(el('span', 'pkc-sot-grow', `Q: ${c.q}`));
    row.appendChild(button('✕', 'pkc-btn-small', () => {
      cards.splice(i, 1);
      persist();
      renderList();
    }));
    listEl.appendChild(row);
  }
}

function renderStudy(): void {
  if (!studyEl) return;
  studyEl.replaceChildren();
  if (studyIdx < 0 || cards.length === 0) {
    studyEl.appendChild(el('div', 'pkc-hint', '「学習開始」でカードをめくれます'));
    return;
  }
  const c = cards[studyIdx % cards.length]!;
  studyEl.appendChild(el('div', 'pkc-card-q', `Q ${(studyIdx % cards.length) + 1}/${cards.length}: ${c.q}`));
  studyEl.appendChild(el('div', 'pkc-card-a', revealed ? `A: ${c.a}` : 'A: ???'));
  const row = el('div', 'pkc-btn-row');
  row.appendChild(button(revealed ? '次のカード →' : '答えを見る', 'pkc-btn', () => {
    if (revealed) {
      studyIdx += 1;
      revealed = false;
    } else {
      revealed = true;
    }
    renderStudy();
  }));
  row.appendChild(button('終了', 'pkc-btn-small', () => {
    studyIdx = -1;
    renderStudy();
  }));
  studyEl.appendChild(row);
}

export function mountCards(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-sot-root';
  ui = createOfferUi(TOOL_ID);

  const header = el('div', 'pkc-sot-header');
  header.setAttribute('data-pkc-region', 'tool-header');
  header.appendChild(el('span', 'pkc-sot-title', '🎴 PKC2 Learning Cards'));
  header.appendChild(el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — フラッシュカード + デッキを text offer`));
  header.appendChild(helpButton('Learning Cards', {
    what: 'Q&A のフラッシュカードをローカルで作成・学習し、デッキを再取り込み可能な markdown として PKC2 に offer します。',
    how: ['Q と A を入れて「追加」', '「学習開始」→ 答えを見る → 次へ、で周回', '「デッキを offer」で PKC2 に保存(## Q: / A: 書式)', 'PKC2 の entry 本文を「デッキを貼り付けて取り込み」に貼れば復元できます'],
    flow: ['デッキは text entry(markdown)として送られます。書式が決まっているのでこのツールに往復できます'],
    notes: ['カードはこのブラウザの localStorage にあります', '習熟度管理(SRS)はありません — 学習はシンプルな周回です'],
  }));
  root.appendChild(header);
  root.appendChild(ui.conn.root);

  const form = el('div', 'pkc-panel');
  form.setAttribute('data-pkc-region', 'tool-form');
  const q = textInput('Q(問題)');
  const a = textInput('A(答え)');
  const addRow = el('div', 'pkc-btn-row');
  addRow.appendChild(q);
  addRow.appendChild(a);
  addRow.appendChild(button('追加', 'pkc-btn-small', () => {
    if (q.value.trim() === '' || a.value.trim() === '') return;
    cards.push({ q: q.value.trim(), a: a.value.trim() });
    persist();
    renderList();
    q.value = '';
    a.value = '';
    q.focus();
  }));
  form.appendChild(addRow);

  const deckName = textInput('デッキ名(offer 時の title)');
  const actRow = el('div', 'pkc-btn-row');
  actRow.appendChild(deckName);
  actRow.appendChild(button('学習開始', 'pkc-btn', () => {
    if (cards.length === 0) return;
    studyIdx = 0;
    revealed = false;
    renderStudy();
  }));
  actRow.appendChild(button('デッキを offer', 'pkc-btn', () => {
    if (cards.length === 0) {
      ui?.note('カードがありません');
      return;
    }
    const name = deckName.value.trim() !== '' ? deckName.value.trim() : 'フラッシュカード';
    ui?.sendTracked(`🎴 ${name}`, { title: `🎴 ${name}`, body: deckToMarkdown(name, cards), archetype: 'text' });
  }));
  form.appendChild(actRow);

  const importArea = document.createElement('textarea');
  importArea.rows = 2;
  importArea.placeholder = 'デッキを貼り付けて取り込み(## Q: / A: 書式)';
  importArea.addEventListener('change', () => {
    const imported = markdownToDeck(importArea.value);
    if (imported.length > 0) {
      cards = [...cards, ...imported];
      persist();
      renderList();
      ui?.note(`${imported.length} 枚を取り込みました`);
      importArea.value = '';
    }
  });
  form.appendChild(importArea);
  root.appendChild(form);

  const studyPanel = el('div', 'pkc-panel');
  studyPanel.setAttribute('data-pkc-region', 'tool-study');
  studyEl = el('div', 'pkc-card-study');
  studyPanel.appendChild(studyEl);
  root.appendChild(studyPanel);

  const listPanel = el('div', 'pkc-panel');
  listPanel.setAttribute('data-pkc-region', 'tool-list');
  listPanel.appendChild(el('div', 'pkc-panel-heading', 'カード(ローカル)'));
  listEl = el('div', 'pkc-sot-list');
  listPanel.appendChild(listEl);
  root.appendChild(listPanel);
  root.appendChild(ui.offersPanel);

  restore();
  renderList();
  renderStudy();
}

const mountTarget = document.getElementById('tool-root');
if (mountTarget) mountCards(mountTarget);
