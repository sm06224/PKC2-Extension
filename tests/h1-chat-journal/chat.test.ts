/** @vitest-environment happy-dom */
/**
 * H1 chat-journal 純関数モデル: タグ抽出 / 日付グループ化 / textlog 互換の
 * create payload(R5-ready)/ degrade コピーテキスト。
 */
import { describe, expect, it } from 'vitest';
import {
  dailyTextlogProposal,
  dayLabel,
  dayPlainText,
  groupByDay,
  localDateOf,
  makeMessage,
  parseTags,
  timeOf,
  type ChatMessage,
} from '../../tools/h1-chat-journal/src/chat';

const msg = (text: string, iso: string, flags: string[] = []): ChatMessage => ({
  id: `m-${iso}`,
  text,
  createdAt: iso,
  flags,
});

describe('parseTags', () => {
  it('#タグを抽出し重複を排除する', () => {
    expect(parseTags('買い物 #todo メモ #idea #todo')).toEqual(['todo', 'idea']);
  });
  it('タグが無ければ空配列', () => {
    expect(parseTags('ただのメモ')).toEqual([]);
  });
});

describe('makeMessage', () => {
  it('本文の #タグ を flags に入れる', () => {
    const m = makeMessage('進捗ヨシ #log #mood', new Date('2026-06-14T09:30:00'));
    expect(m.text).toBe('進捗ヨシ #log #mood');
    expect(m.flags).toEqual(['log', 'mood']);
    expect(typeof m.id).toBe('string');
  });
});

describe('localDateOf / timeOf / dayLabel', () => {
  it('ローカル日付と時刻を取り出す', () => {
    const iso = new Date(2026, 5, 14, 9, 5).toISOString(); // 2026-06-14 09:05 local
    expect(localDateOf(iso)).toBe('2026-06-14');
    expect(timeOf(iso)).toBe('09:05');
  });
  it('曜日付きラベル', () => {
    expect(dayLabel('2026-06-14')).toBe('2026-06-14(日)');
  });
  it('不正な値は空文字', () => {
    expect(localDateOf('nonsense')).toBe('');
    expect(timeOf('nonsense')).toBe('');
  });
});

describe('groupByDay', () => {
  it('日付昇順・日内昇順でまとめる', () => {
    const a = new Date(2026, 5, 14, 8, 0).toISOString();
    const b = new Date(2026, 5, 14, 12, 0).toISOString();
    const c = new Date(2026, 5, 13, 23, 0).toISOString();
    const days = groupByDay([msg('昼', b), msg('前日', c), msg('朝', a)]);
    expect(days.map((d) => d.date)).toEqual(['2026-06-13', '2026-06-14']);
    expect(days[1]!.messages.map((m) => m.text)).toEqual(['朝', '昼']);
  });
});

describe('dailyTextlogProposal (R5-ready)', () => {
  it('title=日付(曜)、body=textlog 互換 JSON', () => {
    const day = groupByDay([
      msg('一件目', new Date(2026, 5, 14, 8, 0).toISOString(), ['log']),
    ])[0]!;
    const p = dailyTextlogProposal(day);
    expect(p.archetype).toBe('textlog');
    expect(p.title).toBe('2026-06-14(日)');
    const parsed = JSON.parse(p.body) as { entries: Array<{ text: string; flags: string[] }> };
    expect(parsed.entries[0]!.text).toBe('一件目');
    expect(parsed.entries[0]!.flags).toEqual(['log']);
  });
});

describe('dayPlainText (degrade コピー)', () => {
  it('日付ラベル + 時刻つき各行', () => {
    const day = groupByDay([
      msg('朝の記録', new Date(2026, 5, 14, 8, 30).toISOString()),
      msg('夜の記録', new Date(2026, 5, 14, 22, 15).toISOString()),
    ])[0]!;
    expect(dayPlainText(day)).toBe('2026-06-14(日)\n08:30  朝の記録\n22:15  夜の記録');
  });
});
