/**
 * H1 chat-journal — 純関数モデル (issue #108)。
 *
 * チャット型セルフメモ。1 メッセージ = textlog の 1 entry(本体
 * `parseTextlogBody` 互換の `{id,text,createdAt,flags}`)としてローカル蓄積し、
 * ローカル日付でグループ化する。
 *
 * create(日次 textlog を PKC2 の entry として反映)は **R5(pkc-ext
 * `t:'propose'` → 既存 PendingOffer banner、PKC2#830)** を前提に設計するが、
 * R5 は PKC2 側未実装。**R6 gap 確定**(Tier S では v1 envelope `record:offer`
 * が host に届かない)により、R5 が来るまで「送信」は degrade(ローカル保持 +
 * クリップボードへの日次ログコピー)で出荷する。
 *
 * 純関数のみ — localStorage / DOM / channel は main の責務。
 */

import { makeLogEntry, serializeTextlogEntries, type TextlogEntryDraft } from '../../shared/textlog-body';

/** 1 メッセージ = textlog の 1 entry(host parseTextlogBody 互換)。 */
export type ChatMessage = TextlogEntryDraft;

export interface ChatDay {
  date: string; // YYYY-MM-DD(ローカル)
  label: string; // YYYY-MM-DD(曜)
  messages: ChatMessage[];
}

/**
 * R5(pkc-ext `t:'propose'`)が来た時に送る「その日の textlog」create payload。
 * archetype=textlog、title=日付(曜)、body=host parseTextlogBody 互換の本文。
 * Pure — 実 transport は R5 実装後に main から配線する(現状は degrade)。
 */
export interface DailyTextlogProposal {
  archetype: 'textlog';
  title: string;
  body: string;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → ローカル日付 YYYY-MM-DD。Pure。 */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** ISO 文字列 → ローカル日付 YYYY-MM-DD(不正なら '')。Pure。 */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return todayLocal(d);
}

/** ISO 文字列 → ローカル時刻 HH:MM(不正なら '')。Pure。 */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** YYYY-MM-DD → `YYYY-MM-DD(曜)`。Pure。 */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) return date;
  const w = WEEK[new Date(y, m - 1, d).getDay()] ?? '';
  return `${date}(${w})`;
}

/** 本文から `#タグ` を抽出(重複排除、先頭 # は除く)。Pure。 */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  const re = /#([^\s#]+)/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(text)) !== null) {
    const t = mt[1];
    if (t && !tags.includes(t)) tags.push(t);
  }
  return tags;
}

/**
 * 1 メッセージを作る。`#タグ` を本文から抽出して flags に入れる
 * (textlog の flags と互換)。Pure(時刻は注入可)。
 */
export function makeMessage(text: string, at: Date = new Date()): ChatMessage {
  const entry = makeLogEntry(text, at);
  entry.flags = parseTags(text);
  return entry;
}

/** メッセージを日付昇順 → 日内昇順でグループ化。Pure。 */
export function groupByDay(messages: readonly ChatMessage[]): ChatDay[] {
  const byDate = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const date = localDateOf(m.createdAt);
    if (!date) continue;
    const arr = byDate.get(date) ?? [];
    arr.push(m);
    byDate.set(date, arr);
  }
  const days: ChatDay[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const msgs = byDate.get(date)!.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    days.push({ date, label: dayLabel(date), messages: msgs });
  }
  return days;
}

/**
 * その日の textlog create payload(R5-ready)。title は日付(曜)、body は
 * host parseTextlogBody 互換の直列化。Pure。
 */
export function dailyTextlogProposal(day: ChatDay): DailyTextlogProposal {
  return { archetype: 'textlog', title: day.label, body: serializeTextlogEntries(day.messages) };
}

/** クリップボード / 手貼り用のプレーンテキスト(degrade 出力)。Pure。 */
export function dayPlainText(day: ChatDay): string {
  const lines = [day.label];
  for (const m of day.messages) lines.push(`${timeOf(m.createdAt)}  ${m.text}`);
  return lines.join('\n');
}
