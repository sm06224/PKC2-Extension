/**
 * A2 envelope-validator — paste-a-JSON envelope lint (issue #19).
 *
 * Fully offline: paste any JSON, get the spec §4.2 verdict (the same
 * validation order the host bridge applies), plus per-field annotations and
 * type-specific payload checks for the common types. No host connection at
 * all — this is the "am I building the right envelope?" desk tool that
 * complements A1 (which validates live traffic).
 */

import '../../shared/base.css';
import './validator.css';
import {
  buildEnvelope,
  validateEnvelope,
  KNOWN_TYPES,
  BODY_SIZE_CAP_BYTES,
  utf8ByteLength,
} from '../../shared/envelope';
import { button, el } from '../../shared/ui';

const TOOL_NAME = 'pkc2-envelope-validator';
const TOOL_VERSION = '0.1.0';

export interface Finding {
  level: 'error' | 'warn' | 'ok' | 'info';
  text: string;
}

/** Full lint: envelope-level verdict + advisory findings. Pure. */
export function lintEnvelope(raw: string): Finding[] {
  const findings: Finding[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (ex) {
    return [{ level: 'error', text: `JSON parse 失敗: ${ex instanceof Error ? ex.message : String(ex)}` }];
  }

  const v = validateEnvelope(data);
  if (!v.ok) {
    findings.push({ level: 'error', text: `${v.code}: ${v.detail}(spec §4.2 — host bridge はこの envelope を黙って捨てます)` });
    // Continue with advisory checks where possible.
  } else {
    findings.push({ level: 'ok', text: `有効な PKC-Message v1 envelope(type=${v.envelope.type})` });
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) return findings;
  const d = data as Record<string, unknown>;

  // Field-level advisories (spec §4.1).
  if (!('source_id' in d)) findings.push({ level: 'warn', text: 'source_id がありません(必須 field、null 可)' });
  else if (d['source_id'] !== null && typeof d['source_id'] !== 'string') {
    findings.push({ level: 'warn', text: 'source_id は string | null を推奨' });
  }
  if (!('target_id' in d)) findings.push({ level: 'warn', text: 'target_id がありません(必須 field、null = broadcast)' });
  if (!('payload' in d)) findings.push({ level: 'warn', text: 'payload がありません(空 object でも必須)' });
  if (typeof d['timestamp'] === 'string' && Number.isNaN(new Date(d['timestamp']).getTime())) {
    findings.push({ level: 'warn', text: 'timestamp が ISO 8601 として解釈できません' });
  }

  // Type-specific payload checks.
  const payload = d['payload'];
  const p = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  switch (d['type']) {
    case 'record:offer': {
      if (!p) {
        findings.push({ level: 'error', text: 'record:offer の payload は object 必須(§7.2.1)' });
        break;
      }
      if (typeof p['title'] !== 'string' || p['title'] === '') {
        findings.push({ level: 'error', text: 'record:offer は title(空でない string)が必須(§7.2.1)' });
      }
      if (typeof p['body'] !== 'string') {
        findings.push({ level: 'error', text: 'record:offer は body(string)が必須(§7.2.1)' });
      } else {
        const bytes = utf8ByteLength(p['body']);
        if (bytes > BODY_SIZE_CAP_BYTES) {
          findings.push({ level: 'error', text: `body が size cap 超過: ${bytes.toLocaleString()} / ${BODY_SIZE_CAP_BYTES.toLocaleString()} bytes(§7.2.2、handler reject)` });
        } else {
          findings.push({ level: 'info', text: `body: ${bytes.toLocaleString()} bytes(cap ${BODY_SIZE_CAP_BYTES.toLocaleString()})` });
        }
      }
      if ('assets' in p) {
        findings.push({ level: 'error', text: 'payload に assets を含めるのは禁止(§6.3)' });
      }
      if ('tags' in p) {
        findings.push({ level: 'warn', text: 'tags は v1 payload に存在せず、host は黙って無視します(SR-08)' });
      }
      break;
    }
    case 'export:request': {
      findings.push({ level: 'info', text: 'export:request は embedded-only(§7.5.3)— standalone host では capability gate で握り潰されます' });
      if (p && 'filename' in p && typeof p['filename'] !== 'string') {
        findings.push({ level: 'warn', text: 'filename は string を推奨' });
      }
      break;
    }
    case 'pong':
    case 'export:result':
    case 'record:reject': {
      findings.push({ level: 'info', text: `${String(d['type'])} は host → sender 方向の type です(sender から送るものではありません)` });
      break;
    }
    case 'record:accept': {
      findings.push({ level: 'info', text: 'record:accept は v1 では type 予約のみ・未実装(§7.3)' });
      break;
    }
    case 'custom': {
      if (p && typeof p['command'] !== 'string') {
        findings.push({ level: 'info', text: 'custom payload には sub-discriminator(例: command: string)を持たせる運用を推奨(§7.7)' });
      }
      break;
    }
    default:
      break;
  }
  return findings;
}

export function mountValidator(root: HTMLElement): void {
  root.replaceChildren();
  root.className = 'pkc-val-root';

  const header = el('div', 'pkc-val-header');
  header.setAttribute('data-pkc-region', 'val-header');
  header.appendChild(el('span', 'pkc-val-title', '🧪 PKC2 Envelope Validator'));
  header.appendChild(
    el('span', 'pkc-hint', `${TOOL_NAME} v${TOOL_VERSION} — 完全オフライン。host bridge と同順(spec §4.2)で判定`),
  );
  root.appendChild(header);

  const panel = el('div', 'pkc-panel');
  const input = document.createElement('textarea');
  input.className = 'pkc-val-input';
  input.rows = 14;
  input.setAttribute('data-pkc-field', 'val-input');
  input.placeholder = '検証したい envelope JSON を貼り付け';
  input.spellcheck = false;
  panel.appendChild(input);

  const btnRow = el('div', 'pkc-btn-row');
  btnRow.appendChild(button('検証', 'pkc-btn', () => render()));
  btnRow.appendChild(
    button('サンプル挿入', 'pkc-btn-small', () => {
      input.value = JSON.stringify(
        buildEnvelope('record:offer', { title: 'サンプル', body: '本文', archetype: 'text' }, { sourceId: 'ext:sample@1.0' }),
        null,
        2,
      );
      render();
    }),
  );
  btnRow.appendChild(el('span', 'pkc-hint', `KNOWN_TYPES: ${KNOWN_TYPES.join(' / ')}`));
  panel.appendChild(btnRow);
  root.appendChild(panel);

  const results = el('div', 'pkc-panel');
  results.appendChild(el('div', 'pkc-panel-heading', '判定'));
  const list = el('div', 'pkc-val-results');
  list.setAttribute('data-pkc-region', 'val-results');
  results.appendChild(list);
  root.appendChild(results);

  let timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(render, 300);
  });

  function render(): void {
    list.replaceChildren();
    if (input.value.trim() === '') {
      list.appendChild(el('div', 'pkc-hint', 'JSON を貼ると判定が表示されます'));
      return;
    }
    for (const f of lintEnvelope(input.value)) {
      const row = el('div', `pkc-val-row pkc-val-${f.level}`);
      const mark = { error: '✕', warn: '⚠', ok: '✓', info: 'ⓘ' }[f.level];
      row.appendChild(el('span', 'pkc-val-mark', mark));
      row.appendChild(el('span', 'pkc-val-text', f.text));
      list.appendChild(row);
    }
  }
  render();
}

const mountTarget = document.getElementById('validator-root');
if (mountTarget) mountValidator(mountTarget);
