/**
 * Collapsible JSON tree renderer — external-library-free and **safe by
 * construction**: every runtime value is rendered through `textContent`
 * (never innerHTML), so hostile message payloads can only ever appear as
 * inert text. Bounded by depth / entry-count / string-length guards so a
 * pathological payload cannot blow up the DOM.
 */

const MAX_DEPTH = 8;
const MAX_ENTRIES_PER_LEVEL = 100;
const MAX_STRING_DISPLAY = 500;

export function renderJsonTree(value: unknown): HTMLElement {
  return renderNode(value, 0, new WeakSet());
}

function renderNode(value: unknown, depth: number, seen: WeakSet<object>): HTMLElement {
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return leaf('[circular]', 'circular');
    if (depth >= MAX_DEPTH) return leaf('(深さ上限)', 'truncated');
    seen.add(value);
    const el = Array.isArray(value)
      ? renderContainer(value.map((v, i) => [String(i), v] as const), '[]', `Array(${value.length})`, depth, seen)
      : renderContainer(Object.entries(value as Record<string, unknown>), '{}', 'Object', depth, seen);
    seen.delete(value);
    return el;
  }
  return renderPrimitive(value);
}

function renderContainer(
  entries: ReadonlyArray<readonly [string, unknown]>,
  brackets: string,
  label: string,
  depth: number,
  seen: WeakSet<object>,
): HTMLElement {
  if (entries.length === 0) return leaf(brackets, 'plain');
  const details = document.createElement('details');
  details.className = 'pkc-tree-node';
  if (depth < 1) details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = `${label} — ${entries.length} ${brackets === '[]' ? 'items' : 'keys'}`;
  details.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'pkc-tree-children';
  const shown = entries.slice(0, MAX_ENTRIES_PER_LEVEL);
  for (const [key, v] of shown) {
    const row = document.createElement('div');
    row.className = 'pkc-tree-row';
    const k = document.createElement('span');
    k.className = 'pkc-tree-key';
    k.textContent = `${key}: `;
    row.appendChild(k);
    row.appendChild(renderNode(v, depth + 1, seen));
    list.appendChild(row);
  }
  if (entries.length > shown.length) {
    list.appendChild(leaf(`… 他 ${entries.length - shown.length} 件(表示上限)`, 'truncated'));
  }
  details.appendChild(list);
  return details;
}

function renderPrimitive(value: unknown): HTMLElement {
  if (typeof value === 'string') {
    const display =
      value.length > MAX_STRING_DISPLAY
        ? `"${value.slice(0, MAX_STRING_DISPLAY)}…" (全 ${value.length} 文字)`
        : `"${value}"`;
    return leaf(display, 'string');
  }
  if (typeof value === 'number' || typeof value === 'bigint') return leaf(String(value), 'number');
  if (typeof value === 'boolean') return leaf(String(value), 'bool');
  if (value === null) return leaf('null', 'null');
  if (value === undefined) return leaf('undefined', 'null');
  // function / symbol — cannot arrive via postMessage, but render defensively.
  return leaf(`(${typeof value})`, 'plain');
}

function leaf(text: string, kind: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `pkc-tree-leaf pkc-tree-${kind}`;
  span.textContent = text;
  return span;
}
