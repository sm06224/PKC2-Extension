# SR-16. `data:changed` 通知メッセージ（新規）

**背景**: C9 graph-navigator 等の「PKC2 の現在状態を可視化するツール」では、
PKC2 側のデータが変更されるたびに表示を更新したいが、現状は変更検知手段がない。

## 問題

現在 PKC2 が `record:offer` を受理しても、**接続中の他ツールには通知されない**。
ツール側は変更を知るために以下のいずれかが必要:

1. `export:request` を定期ポーリング → ネットワーク/計算コスト + 遅延
2. ユーザー操作で手動 Refresh → UX が悪い
3. 自ツール発の変更は追跡できるが、他ツール・PKC2 本体での編集は不可視

## 案

新メッセージ型 `data:changed` を追加。PKC2 は内部で container の entries / relations / assets が変更された時、接続中の全ツールに broadcast する。

```ts
type MessageType = ... | 'data:changed'; // NEW

interface DataChangedPayload {
  change_kind: 'created' | 'updated' | 'deleted';
  target: 'entry' | 'relation' | 'asset' | 'revision';
  lids?: string[];          // 対象 entry の lid 群（entry/relation/revision の場合）
  asset_keys?: string[];    // 対象 asset の key 群
  source?: 'user' | 'message' | 'rehydrate' | 'migration';
                            // 変更のトリガー（自分発を識別するため）
  container_id: string;     // どの container で発生したか
}
```

## 動作規則

- 一度の UserAction で複数変更が発生する場合は **バッチで送信** (`lids: [lid1, lid2, ...]`)
- 高頻度編集（テキスト入力中など）では **debounce** (例: 500ms) を PKC2 側で行う
- capability negotiation (SR-10) に `notifications: ['data:changed']` を載せて、
  対応 PKC2 のみが発火することを明示
- 未対応の受信側には無害（未知 type は破棄、SR-1 の前提）

## ユースケース

- **C9 graph-navigator**: グラフを差分再描画
- **D5 federation-hub**: 変更を他 PKC2 に伝播
- **A1 message-probe**: 変更イベントのトレース
- 将来のリアルタイム同期系全般の前提

## 取り扱い注意

- 自分が送った `record:offer` 由来の変更も自分に返ってくる
  → `source_id` で自分発を判別するか、`correlation_id` (SR-2) で追跡
- 大量変更（import 数百件）で通知ストームが起きないよう、
  バッチング + レート制限 (SR-7 準拠) が必須
