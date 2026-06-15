/** @vitest-environment happy-dom */
/**
 * H2 ai-assistant 純関数: endpoint 外部判定 / messages 構築(同意 = include のみ)/
 * OpenAI 互換 body・応答 parse / 会話の textlog 直列化 + propose payload /
 * body cap / クリップボードプロンプト。
 */
import { describe, expect, it } from 'vitest';
import {
  buildMessages,
  buildSystemContent,
  chatCompletionsBody,
  clipboardPrompt,
  conversationProposal,
  exceedsBodyCap,
  isExternalEndpoint,
  parseAssistantContent,
  serializeConversation,
  type ChatTurn,
  type ContextEntry,
} from '../../tools/h2-ai-assistant/src/assistant';

const ctx = (over: Partial<ContextEntry> & { lid: string }): ContextEntry => ({
  title: over.lid, body: 'body', include: true, ...over,
});

describe('isExternalEndpoint', () => {
  it('localhost / 127.0.0.1 は外部でない', () => {
    expect(isExternalEndpoint('http://localhost:11434/v1/chat/completions')).toBe(false);
    expect(isExternalEndpoint('http://127.0.0.1:1234/v1/chat/completions')).toBe(false);
  });
  it('外部ホストは外部', () => {
    expect(isExternalEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true);
  });
  it('壊れた URL は安全側 = 外部', () => {
    expect(isExternalEndpoint('not a url')).toBe(true);
  });
});

describe('buildSystemContent / buildMessages(同意 = include のみ)', () => {
  it('include した文脈だけが system に入る', () => {
    const c = [ctx({ lid: 'a', title: 'メモA', body: '本文A', include: true }), ctx({ lid: 'b', body: '本文B', include: false })];
    const sys = buildSystemContent(c);
    expect(sys).toContain('メモA');
    expect(sys).toContain('本文A');
    expect(sys).not.toContain('本文B');
  });
  it('include 0 件なら system 無し', () => {
    expect(buildSystemContent([ctx({ lid: 'a', include: false })])).toBe('');
  });
  it('messages は system + history の順', () => {
    const history: ChatTurn[] = [{ role: 'user', content: 'やあ' }];
    const m = buildMessages([ctx({ lid: 'a', title: 'T', body: 'B', include: true })], history);
    expect(m[0]!.role).toBe('system');
    expect(m[1]).toEqual({ role: 'user', content: 'やあ' });
  });
});

describe('OpenAI 互換 body / 応答 parse', () => {
  it('body は {model, messages, stream:false}', () => {
    expect(chatCompletionsBody('gpt-x', [{ role: 'user', content: 'hi' }])).toEqual({
      model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], stream: false,
    });
  });
  it('choices[0].message.content を取り出す', () => {
    expect(parseAssistantContent({ choices: [{ message: { content: 'こんにちは' } }] })).toBe('こんにちは');
  });
  it('壊れた応答は null', () => {
    expect(parseAssistantContent({})).toBeNull();
    expect(parseAssistantContent({ choices: [] })).toBeNull();
    expect(parseAssistantContent('x')).toBeNull();
  });
});

describe('会話の保存(textlog 直列化 / propose payload)', () => {
  const history: ChatTurn[] = [{ role: 'user', content: '質問' }, { role: 'assistant', content: '回答' }];
  it('話者プレフィックス + ai-chat flag で textlog 直列化', () => {
    const body = serializeConversation(history, new Date(2026, 5, 15, 10, 0));
    const parsed = JSON.parse(body) as { entries: Array<{ text: string; flags: string[] }> };
    expect(parsed.entries[0]!.text).toBe('[user] 質問');
    expect(parsed.entries[1]!.text).toBe('[ai] 回答');
    expect(parsed.entries[0]!.flags).toEqual(['ai-chat']);
  });
  it('propose payload は textlog + タイトルに AI チャット', () => {
    const p = conversationProposal(history, new Date(2026, 5, 15, 10, 5));
    expect(p.archetype).toBe('textlog');
    expect(p.title).toContain('AI チャット');
    expect(p.title).toContain('10:05');
  });
});

describe('body cap / クリップボードプロンプト', () => {
  it('cap 超過判定', () => {
    expect(exceedsBodyCap('x'.repeat(10))).toBe(false);
    expect(exceedsBodyCap('x'.repeat(262145))).toBe(true);
  });
  it('clipboardPrompt は文脈 + 会話を含む', () => {
    const text = clipboardPrompt(
      [ctx({ lid: 'a', title: 'T', body: '文脈本文', include: true })],
      [{ role: 'user', content: 'お願い' }],
    );
    expect(text).toContain('文脈本文');
    expect(text).toContain('あなた: お願い');
  });
});
