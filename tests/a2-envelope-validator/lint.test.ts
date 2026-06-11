/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { lintEnvelope, mountValidator, type Finding } from '../../tools/a2-envelope-validator/src/main';

function levels(findings: Finding[]): string[] {
  return findings.map((f) => f.level);
}

function valid(over?: Record<string, unknown>): string {
  return JSON.stringify({
    protocol: 'pkc-message',
    version: 1,
    type: 'ping',
    source_id: 'ext:t',
    target_id: null,
    payload: {},
    timestamp: '2026-06-10T00:00:00.000Z',
    ...over,
  });
}

describe('lintEnvelope', () => {
  it('flags broken JSON', () => {
    expect(lintEnvelope('{oops')[0]?.level).toBe('error');
  });

  it('passes a valid ping', () => {
    const f = lintEnvelope(valid());
    expect(f[0]?.level).toBe('ok');
    expect(levels(f)).not.toContain('error');
  });

  it('reports the spec reject code for invalid envelopes', () => {
    const f = lintEnvelope(valid({ version: 2 }));
    expect(f[0]?.text).toContain('WRONG_VERSION');
  });

  it('reports one error per reason when multiple checks fail (host behavior)', () => {
    const f = lintEnvelope(valid({ version: 2, timestamp: 99 }));
    const errors = f.filter((x) => x.level === 'error');
    expect(errors.some((x) => x.text.includes('WRONG_VERSION'))).toBe(true);
    expect(errors.some((x) => x.text.includes('MISSING_TIMESTAMP'))).toBe(true);
  });

  it('still gives field advisories when the envelope is invalid', () => {
    const f = lintEnvelope(JSON.stringify({ protocol: 'pkc-message', version: 1, type: 'ping', timestamp: 'x' }));
    expect(f.some((x) => x.text.includes('source_id'))).toBe(true);
    expect(f.some((x) => x.text.includes('ISO 8601'))).toBe(true);
  });

  it('checks record:offer payload requirements', () => {
    const f = lintEnvelope(valid({ type: 'record:offer', payload: { body: 42 } }));
    expect(f.some((x) => x.level === 'error' && x.text.includes('title'))).toBe(true);
    expect(f.some((x) => x.level === 'error' && x.text.includes('body'))).toBe(true);
  });

  it('flags forbidden assets and ignored tags in record:offer', () => {
    const f = lintEnvelope(valid({ type: 'record:offer', payload: { title: 't', body: 'b', assets: {}, tags: ['x'] } }));
    expect(f.some((x) => x.level === 'error' && x.text.includes('assets'))).toBe(true);
    expect(f.some((x) => x.level === 'warn' && x.text.includes('tags'))).toBe(true);
  });

  it('flags oversized record:offer bodies', () => {
    const f = lintEnvelope(valid({ type: 'record:offer', payload: { title: 't', body: 'x'.repeat(262145) } }));
    // length 262145 > 262144 UTF-16 units
    expect(f.some((x) => x.level === 'error' && x.text.includes('size cap'))).toBe(true);
  });

  it('notes embedded-only for export:request and host-direction types', () => {
    expect(lintEnvelope(valid({ type: 'export:request' })).some((x) => x.text.includes('embedded-only'))).toBe(true);
    expect(lintEnvelope(valid({ type: 'pong' })).some((x) => x.text.includes('host → sender'))).toBe(true);
    expect(lintEnvelope(valid({ type: 'record:ack' })).some((x) => x.text.includes('host → sender'))).toBe(true);
  });

  it('advises on correlation_id (v1.x additive, PKC2#804)', () => {
    expect(lintEnvelope(valid({ correlation_id: 'c-1' })).some((x) => x.level === 'info' && x.text.includes('correlation_id'))).toBe(true);
    expect(lintEnvelope(valid({ correlation_id: 42 })).some((x) => x.level === 'warn' && x.text.includes('correlation_id'))).toBe(true);
  });
});

describe('mountValidator (boot + parity)', () => {
  it('renders verdict rows from pasted JSON', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountValidator(root);
    const input = root.querySelector<HTMLTextAreaElement>('[data-pkc-field="val-input"]')!;
    input.value = valid({ version: 99 });
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === '検証');
    btn!.click();
    expect(root.querySelector('[data-pkc-region="val-results"]')?.textContent).toContain('WRONG_VERSION');
  });

  it('sample button inserts a self-validating envelope', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountValidator(root);
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'サンプル挿入');
    btn!.click();
    expect(root.querySelector('[data-pkc-region="val-results"]')?.textContent).toContain('有効な PKC-Message v1 envelope');
  });
});
