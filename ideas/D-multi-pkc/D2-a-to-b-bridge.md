# D2. a-to-b-bridge（A の accept を B に転送）

**目的**: PKC2-A が accept → 自動的に PKC2-B に offer。一方向ブリッジ。

**メッセージフロー**:

```
[PKC2-A] --record:accept--> [bridge] 検知
[bridge] --export:request--> [PKC2-A] → 完全データ取得
[bridge] --record:offer-->   [PKC2-B] → 転送
```

**UI 概要**:

- Source (A) / Destination (B) iframe パネル
- active/paused トグル
- 転送ログ + archetype/タグ フィルタ

**実装ノート**:

- `record:accept` payload はフルデータを含まない → `export:request` で取得が必要
- 転送済み lid を追跡して重複防止

**SR 依存**: SR-2, SR-4, SR-15 | **優先度**: Tier 3
