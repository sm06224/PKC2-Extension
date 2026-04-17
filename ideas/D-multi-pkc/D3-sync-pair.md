# D3. sync-pair（2 PKC2 の差分同期）

**目的**: 2 PKC2 間の双方向差分同期。

**メッセージフロー**:

```
[sync] --export:request--> [A] / [B]  (並列)
[sync] 差分計算
[sync] --record:offer (B に不足分)--> [B]
[sync] --record:offer (A に不足分)--> [A]
```

**UI 概要**:

- 2 iframe + 「Compare」→ 差分表示（Aのみ / Bのみ / 両方）
- チェックボックスで同期対象選択 + 方向矢印
- プログレスバー

**実装ノート**:

- lid は container 間で不一致 → content hash (`SubtleCrypto SHA-256`) でマッチ
- 同一 title + 異なる body = コンフリクト → ユーザー選択
- バッチ offer にディレイ（SR-7 準拠）

**SR 依存**: SR-2, SR-4, SR-7, SR-8 | **優先度**: Tier 3
