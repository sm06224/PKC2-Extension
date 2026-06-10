import { describe, expect, it } from 'vitest';
import { MessageLog, safeStringify, type LogEntry } from '../../tools/a1-message-probe/src/log-model';

function entry(over: Partial<Omit<LogEntry, 'seq'>>): Omit<LogEntry, 'seq'> {
  return {
    at: '2026-06-10T00:00:00.000Z',
    direction: 'in',
    kind: 'pkc',
    type: 'ping',
    sourceId: null,
    targetId: null,
    origin: 'null',
    viaHost: true,
    data: {},
    ...over,
  };
}

describe('MessageLog', () => {
  it('caps entries and counts drops (flood resistance)', () => {
    const log = new MessageLog(3);
    for (let i = 0; i < 5; i++) log.push(entry({ type: `t${i}` }));
    expect(log.all().length).toBe(3);
    expect(log.all().map((e) => e.type)).toEqual(['t2', 't3', 't4']);
    expect(log.dropped).toBe(2);
  });

  it('assigns increasing seq', () => {
    const log = new MessageLog();
    const a = log.push(entry({}));
    const b = log.push(entry({}));
    expect(b.seq).toBe(a.seq + 1);
  });

  it('filters by type set', () => {
    const log = new MessageLog();
    log.push(entry({ type: 'ping' }));
    log.push(entry({ type: 'pong' }));
    const out = log.filtered({ types: new Set(['pong']), search: '', showForeign: true });
    expect(out.map((e) => e.type)).toEqual(['pong']);
  });

  it('hides foreign rows unless enabled', () => {
    const log = new MessageLog();
    log.push(entry({ kind: 'foreign', type: '(non-pkc)' }));
    log.push(entry({ type: 'ping' }));
    expect(log.filtered({ types: null, search: '', showForeign: false }).length).toBe(1);
    expect(log.filtered({ types: null, search: '', showForeign: true }).length).toBe(2);
  });

  it('searches case-insensitively across data', () => {
    const log = new MessageLog();
    log.push(entry({ data: { payload: { title: 'Hello World' } } }));
    log.push(entry({ data: { payload: { title: 'other' } } }));
    const out = log.filtered({ types: null, search: 'hello', showForeign: true });
    expect(out.length).toBe(1);
  });

  it('clear() resets entries and drop counter', () => {
    const log = new MessageLog(1);
    log.push(entry({}));
    log.push(entry({}));
    log.clear();
    expect(log.all().length).toBe(0);
    expect(log.dropped).toBe(0);
  });

  it('seenTypes() returns sorted distinct types', () => {
    const log = new MessageLog();
    log.push(entry({ type: 'pong' }));
    log.push(entry({ type: 'ping' }));
    log.push(entry({ type: 'ping' }));
    expect(log.seenTypes()).toEqual(['ping', 'pong']);
  });
});

describe('safeStringify', () => {
  it('handles circular structures (postMessage allows them)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    const s = safeStringify(a);
    expect(s).toContain('[circular]');
  });

  it('handles bigint and undefined without throwing', () => {
    expect(safeStringify(10n)).toBe('"10n"');
    expect(safeStringify(undefined)).toBe('undefined');
  });
});
