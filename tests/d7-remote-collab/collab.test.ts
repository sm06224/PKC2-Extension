/** @vitest-environment happy-dom */
/**
 * D7 remote-collab 純関数: メッセージ encode/parse(防御)/ SharedItem 生成 /
 * import propose payload / upsert。
 */
import { describe, expect, it } from 'vitest';
import {
  encodeMsg,
  importProposal,
  makeSharedItem,
  parseMsg,
  upsertById,
  type SharedItem,
} from '../../tools/d7-remote-collab/src/collab';

const item = (id: string, over: Partial<SharedItem> = {}): SharedItem => ({
  id, title: `t-${id}`, archetype: 'text', body: `body-${id}`, ...over,
});

describe('encode / parse', () => {
  it('hello / share / unshare / bye を round-trip', () => {
    expect(parseMsg(encodeMsg({ t: 'hello', name: 'A' }))).toEqual({ t: 'hello', name: 'A' });
    expect(parseMsg(encodeMsg({ t: 'share', item: item('x') }))).toEqual({ t: 'share', item: item('x') });
    expect(parseMsg(encodeMsg({ t: 'unshare', id: 'x' }))).toEqual({ t: 'unshare', id: 'x' });
    expect(parseMsg(encodeMsg({ t: 'bye' }))).toEqual({ t: 'bye' });
  });
  it('壊れた JSON / 未知 t / 不正 item は null', () => {
    expect(parseMsg('not json')).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'share', item: { id: 'x' } }))).toBeNull(); // 必須欠落
    expect(parseMsg(JSON.stringify({ t: 'hello' }))).toBeNull();
  });
});

describe('makeSharedItem / importProposal / upsertById', () => {
  it('makeSharedItem は id=lid', () => {
    expect(makeSharedItem('lid1', 'タイトル', 'todo', '{"status":"open"}')).toEqual({
      id: 'lid1', title: 'タイトル', archetype: 'todo', body: '{"status":"open"}',
    });
  });
  it('importProposal は archetype/title/body をそのまま運ぶ', () => {
    expect(importProposal(item('a', { archetype: 'textlog', title: 'ログ', body: 'B' }))).toEqual({
      archetype: 'textlog', title: 'ログ', body: 'B',
    });
  });
  it('upsertById は同 id を置換、新規は追加', () => {
    const l0 = [item('a'), item('b')];
    const l1 = upsertById(l0, item('a', { title: '更新' }));
    expect(l1.find((x) => x.id === 'a')!.title).toBe('更新');
    expect(l1).toHaveLength(2);
    const l2 = upsertById(l1, item('c'));
    expect(l2.map((x) => x.id)).toContain('c');
    expect(l2).toHaveLength(3);
  });
});
