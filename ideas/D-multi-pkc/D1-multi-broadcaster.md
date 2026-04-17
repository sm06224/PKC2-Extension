# D1. multi-broadcaster（複数 iframe に同時配信）

**目的**: 単一メッセージを複数 PKC2 iframe に同時配信。D カテゴリの基本パターン。

**メッセージフロー**:

```
[broadcaster] --record:offer--> [PKC2-A]
              --record:offer--> [PKC2-B]
              --record:offer--> [PKC2-C]
各 PKC2 --record:accept/reject--> [broadcaster]
```

**UI 概要**:

- iframe URL リスト（追加/削除）+ 接続ステータス
- メッセージ作成（B1 と同じフォーム）
- 「Broadcast」+ iframe 別レスポンス追跡

**実装ノート**:

- `target_id` を各 iframe の container_id に設定
- `Promise.allSettled` + タイムアウト 10s

**SR 依存**: SR-1, SR-2, SR-11 | **優先度**: Tier 3
