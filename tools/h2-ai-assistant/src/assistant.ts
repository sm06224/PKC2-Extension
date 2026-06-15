/**
 * H2 ai-assistant — 純関数モデル (issue #109、設計 doc
 * ideas/H-communication/H2-ai-assistant.md)。
 *
 * 方式 A(外部 API)/ B(localhost LLM)は **OpenAI 互換 Chat Completions** に
 * 収斂(`{model, messages:[{role,content}]}` → `choices[0].message.content`)。
 * 差は endpoint URL と API キーの有無だけ。方式 C(クリップボード)は fetch なし。
 *
 * 規律: API キーは localStorage に置かない(main で in-memory)。AI 応答は外部由来の
 * untrusted データなので描画は textContent(main の責務)。文脈はユーザーが送付
 * ジェスチャ(deliver)で渡した entry のみ。
 *
 * 純関数のみ — fetch / DOM / localStorage は main の責務。
 */

import { dailyTitle, makeLogEntry, serializeTextlogEntries } from '../../shared/textlog-body';
import { BODY_SIZE_CAP_UTF16_UNITS } from '../../shared/envelope';

export type ProviderMode = 'none' | 'http' | 'clipboard';

export interface ProviderConfig {
  mode: ProviderMode;
  endpoint: string;
  model: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextEntry {
  lid: string;
  title: string;
  body: string;
  include: boolean;
}

export interface Preset {
  label: string;
  endpoint: string;
  external: boolean;
}

/** endpoint プリセット(B=localhost / A=外部)。 */
export const PRESETS: Preset[] = [
  { label: 'ollama (localhost)', endpoint: 'http://localhost:11434/v1/chat/completions', external: false },
  { label: 'LM Studio (localhost)', endpoint: 'http://localhost:1234/v1/chat/completions', external: false },
  { label: 'OpenAI (外部)', endpoint: 'https://api.openai.com/v1/chat/completions', external: true },
];

/**
 * endpoint が外部(= localhost 以外)か。URL parse 失敗時は安全側 = true
 * (外部とみなして警告)。Pure。
 */
export function isExternalEndpoint(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '[::1]');
}

/** include 済み文脈 entry から system プロンプト本文を作る('' なら system 無し)。Pure。 */
export function buildSystemContent(context: readonly ContextEntry[]): string {
  const parts = context.filter((c) => c.include).map((c) => `# ${c.title}\n${c.body}`);
  if (parts.length === 0) return '';
  return `次の PKC2 のメモを文脈として参照してください。\n\n${parts.join('\n\n')}`;
}

/**
 * OpenAI 互換 messages 配列を組む。history は最新の user ターンまで含む。
 * include した文脈があれば先頭に system を置く。Pure。
 */
export function buildMessages(
  context: readonly ContextEntry[],
  history: readonly ChatTurn[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  const sys = buildSystemContent(context);
  if (sys !== '') messages.push({ role: 'system', content: sys });
  for (const t of history) messages.push({ role: t.role, content: t.content });
  return messages;
}

/** Chat Completions リクエスト body。stream は使わない(一括受信)。Pure。 */
export function chatCompletionsBody(
  model: string,
  messages: Array<{ role: string; content: string }>,
): { model: string; messages: Array<{ role: string; content: string }>; stream: false } {
  return { model, messages, stream: false };
}

/** OpenAI 互換応答から assistant テキストを防御的に取り出す(取れなければ null)。Pure。 */
export function parseAssistantContent(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const choices = (json as Record<string, unknown>)['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (first === null || typeof first !== 'object') return null;
  const message = (first as Record<string, unknown>)['message'];
  if (message === null || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : null;
}

/** 会話を textlog body(互換)に直列化。各ターン = 1 entry、話者プレフィックス付き。Pure。 */
export function serializeConversation(history: readonly ChatTurn[], at: Date = new Date()): string {
  const entries = history.map((t, i) => {
    const e = makeLogEntry(`[${t.role === 'user' ? 'user' : 'ai'}] ${t.content}`, new Date(at.getTime() + i));
    e.flags = ['ai-chat'];
    return e;
  });
  return serializeTextlogEntries(entries);
}

export interface ConversationProposal {
  archetype: 'textlog';
  title: string;
  body: string;
}

/** 会話保存用の propose payload(R5)。Pure。 */
export function conversationProposal(history: readonly ChatTurn[], at: Date = new Date()): ConversationProposal {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return {
    archetype: 'textlog',
    title: `AI チャット ${dailyTitle(at)} ${hh}:${mm}`,
    body: serializeConversation(history, at),
  };
}

/** body cap(262,144 UTF-16 code units)超過か。Pure。 */
export function exceedsBodyCap(body: string): boolean {
  return body.length > BODY_SIZE_CAP_UTF16_UNITS;
}

/** クリップボード手動ブリッジ用のプレーンプロンプト(方式 C)。Pure。 */
export function clipboardPrompt(context: readonly ContextEntry[], history: readonly ChatTurn[]): string {
  const lines: string[] = [];
  const sys = buildSystemContent(context);
  if (sys !== '') {
    lines.push(sys, '');
  }
  for (const t of history) lines.push(`${t.role === 'user' ? 'あなた' : 'AI'}: ${t.content}`);
  return lines.join('\n');
}
