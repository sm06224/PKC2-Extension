# E3. habit-tracker（cron 的 todo 生成）

**目的**: 繰り返し習慣を定義しスケジュールで todo を自動生成。

**UI 概要**:

- 習慣リスト（名前, 頻度, ストリーク）
- 「Generate Today's Habits」
- カレンダーヒートマップ（🟢完了 / 🔴未完了）

**実装ノート**:

- 習慣定義は `localStorage`（メタ設定、PKC2 レコードではない）
- スケジュール: daily / weekly(特定曜日) / custom(N日ごと)
- 完了確認: `export:request` → タイトル + 日付タグでマッチ

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
