/**
 * D7 remote-collab — 純関数の協調プロトコル + トランスポート seam
 * (issue #120、設計 doc ideas/D-multi-pkc/D7-remote-collab.md)。
 *
 * 拡張同士が WebRTC DataChannel で交換する JSON メッセージの型・直列化・防御
 * parse。実 WebRTC は rtc.ts(browser 専用)。本モジュールは pure なので fake
 * transport で配線テストできる。
 *
 * 規律: 共有に出すのはユーザーが deliver で渡したテキスト entry のみ。受信は
 * untrusted → ローカル化は propose 同意経由(main の責務、描画は textContent)。
 */

/** 共有スペースに出す / で受け取る 1 件。attachment 実体(asset)は運ばない。 */
export interface SharedItem {
  id: string;
  title: string;
  archetype: string;
  body: string;
}

/** DataChannel を流れるメッセージ。 */
export type CollabMsg =
  | { t: 'hello'; name: string }
  | { t: 'share'; item: SharedItem }
  | { t: 'unshare'; id: string }
  | { t: 'bye' };

/** トランスポート抽象(rtc.ts の WebRTC 実装 / テストの fake が満たす)。 */
export interface CollabTransport {
  send(data: string): void;
  onMessage(cb: (data: string) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export function encodeMsg(m: CollabMsg): string {
  return JSON.stringify(m);
}

function parseSharedItem(v: unknown): SharedItem | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o['id'] !== 'string'
    || typeof o['title'] !== 'string'
    || typeof o['archetype'] !== 'string'
    || typeof o['body'] !== 'string'
  ) return null;
  return { id: o['id'], title: o['title'], archetype: o['archetype'], body: o['body'] };
}

/** 防御的 parse(壊れ / 未知 t は null)。 */
export function parseMsg(data: string): CollabMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o['t']) {
    case 'hello':
      return typeof o['name'] === 'string' ? { t: 'hello', name: o['name'] } : null;
    case 'share': {
      const item = parseSharedItem(o['item']);
      return item ? { t: 'share', item } : null;
    }
    case 'unshare':
      return typeof o['id'] === 'string' ? { t: 'unshare', id: o['id'] } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

/** deliver で受けた entry を共有アイテム化(id = origin lid)。Pure。 */
export function makeSharedItem(lid: string, title: string, archetype: string, body: string): SharedItem {
  return { id: lid, title, archetype, body };
}

export interface CollabProposal {
  archetype: string;
  title: string;
  body: string;
}

/** 受信アイテムをローカル化する propose payload(R5)。本文はそのまま運ぶ。Pure。 */
export function importProposal(item: SharedItem): CollabProposal {
  return { archetype: item.archetype, title: item.title, body: item.body };
}

/** id 一致を置換、無ければ追加(共有/受信リストの upsert)。Pure(新配列を返す)。 */
export function upsertById(list: readonly SharedItem[], item: SharedItem): SharedItem[] {
  const out = list.filter((x) => x.id !== item.id);
  out.push(item);
  return out;
}
