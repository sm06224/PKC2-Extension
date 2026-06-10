/**
 * Tiny DOM helpers shared by the tools. All text goes through
 * `textContent` — the repo-wide rule that runtime data is never rendered
 * as HTML.
 */

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(
  label: string,
  className: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function textInput(placeholder: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.placeholder = placeholder;
  return i;
}

export function fieldRow(labelText: string, input: HTMLElement): HTMLElement {
  const row = el('div', 'pkc-field-row');
  row.appendChild(el('label', 'pkc-field-label', labelText));
  row.appendChild(input);
  return row;
}

export function selectInput(options: ReadonlyArray<{ value: string; label: string }>): HTMLSelectElement {
  const s = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    s.appendChild(opt);
  }
  return s;
}
