/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { buildFormBody, FORM_TEMPLATES } from '../../tools/b15-form-template/src/main';
import { itemToPayload } from '../../tools/e1-reading-list/src/main';
import { expenseLine, totalOf } from '../../tools/e2-expense-tracker/src/main';
import { habitsToRows, todayStr } from '../../tools/e3-habit-tracker/src/main';
import { buildMinutes } from '../../tools/e4-meeting-notes/src/main';
import { isoWeekTitle } from '../../tools/e6-weekly-review/src/main';
import { deckToMarkdown, markdownToDeck } from '../../tools/e7-learning-cards/src/main';

describe('B15 form body(host form-presenter 互換)', () => {
  it('{name, note, checked} の JSON を出す', () => {
    expect(JSON.parse(buildFormBody('件名', 'メモ', true))).toEqual({ name: '件名', note: 'メモ', checked: true });
    expect(FORM_TEMPLATES.length).toBeGreaterThanOrEqual(2);
  });
});

describe('E1 itemToPayload', () => {
  it('markdown リンク + 状態 + source_url', () => {
    const p = itemToPayload({ id: 'x', url: 'https://ex.test/a', title: '本', memo: 'メモ', status: '積読', addedAt: '2026-06-12T00:00:00.000Z' });
    expect(p['title']).toBe('📖 本');
    expect(String(p['body'])).toContain('[本](https://ex.test/a)');
    expect(String(p['body'])).toContain('状態: 積読');
    expect(p['source_url']).toBe('https://ex.test/a');
  });
});

describe('E2 expense', () => {
  it('行書式と合計', () => {
    const items = [
      { amount: 480, label: 'コーヒー', category: '食費', at: '' },
      { amount: 1200, label: '本', category: '趣味', at: '' },
    ];
    expect(expenseLine(items[0]!)).toBe('¥480 コーヒー #食費');
    expect(totalOf(items)).toBe(1680);
  });
});

describe('E3 habits', () => {
  it('習慣 → 期日 = 今日の todo 行(空はスキップ)', () => {
    const rows = habitsToRows(['ストレッチ', ' ', '英語'], new Date('2026-06-12T09:00:00'));
    expect(rows.length).toBe(2);
    expect(rows[0]?.title).toBe('🔁 ストレッチ');
    expect(JSON.parse(rows[0]!.body)).toMatchObject({ status: 'open', description: 'ストレッチ', date: '2026-06-12' });
    expect(todayStr(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
  });
});

describe('E4 buildMinutes', () => {
  it('日付タイトル + メタ行', () => {
    const m = buildMinutes('定例', 'A, B', '## アジェンダ', new Date('2026-06-12T10:30:00'));
    expect(m.title).toBe('2026-06-12 定例');
    expect(m.md).toContain('- 参加者: A, B');
    expect(m.md).toContain('10:30');
  });
});

describe('E6 isoWeekTitle', () => {
  it('ISO 8601 週番号(年跨ぎ含む)', () => {
    expect(isoWeekTitle(new Date('2026-06-11T00:00:00'))).toBe('2026-W24 週次レビュー');
    expect(isoWeekTitle(new Date('2026-01-01T00:00:00'))).toBe('2026-W01 週次レビュー');
    expect(isoWeekTitle(new Date('2027-01-01T00:00:00'))).toBe('2026-W53 週次レビュー'); // 2027-01-01 は ISO では 2026 年第 53 週
  });
});

describe('E7 deck roundtrip', () => {
  it('markdown ↔ デッキが往復する', () => {
    const cards = [{ q: '首都は?', a: '東京' }, { q: '2+2', a: '4' }];
    const md = deckToMarkdown('テスト', cards);
    expect(markdownToDeck(md)).toEqual(cards);
  });
  it('無関係な markdown からは 0 枚', () => {
    expect(markdownToDeck('# ただのメモ\n本文')).toEqual([]);
  });
});
