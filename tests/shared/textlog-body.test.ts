/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { dailyTitle, makeLogEntry, serializeTextlogEntries } from '../../tools/shared/textlog-body';
import { buildDailyBody, TEMPLATES } from '../../tools/b14-daily-log-starter/src/main';
import { sessionText } from '../../tools/b13-pomodoro-logger/src/main';

describe('textlog body (host parseTextlogBody 互換)', () => {
  it('serializes to { entries: [{id,text,createdAt,flags}] }', () => {
    const body = JSON.parse(serializeTextlogEntries([makeLogEntry('メモ', new Date('2026-06-11T09:00:00Z'))]));
    expect(Array.isArray(body.entries)).toBe(true);
    const e = body.entries[0];
    expect(typeof e.id).toBe('string');
    expect(e.text).toBe('メモ');
    expect(e.createdAt).toBe('2026-06-11T09:00:00.000Z');
    expect(e.flags).toEqual([]);
  });

  it('dailyTitle は YYYY-MM-DD(曜)', () => {
    expect(dailyTitle(new Date('2026-06-11T00:00:00'))).toBe('2026-06-11(木)');
  });
});

describe('B14 buildDailyBody', () => {
  it('1 行 = 1 ログ行、空行は無視、順序維持', () => {
    const body = JSON.parse(buildDailyBody(['朝:', '', '  ', '夜:'], new Date('2026-06-11T00:00:00Z')));
    expect(body.entries.map((e: { text: string }) => e.text)).toEqual(['朝:', '夜:']);
    expect(body.entries[0].createdAt < body.entries[1].createdAt).toBe(true);
  });
  it('テンプレが定義されている', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });
});

describe('B13 sessionText', () => {
  it('時刻範囲とラベルを含む', () => {
    const t = sessionText(25, 'spec 読み', new Date('2026-06-11T09:00:00'), new Date('2026-06-11T09:25:00'));
    expect(t).toContain('25分集中');
    expect(t).toContain('09:00〜09:25');
    expect(t).toContain('spec 読み');
  });
  it('ラベル無しでも成立', () => {
    expect(sessionText(5, '', new Date(), new Date())).toContain('5分集中');
  });
});
