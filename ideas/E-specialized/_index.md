# E. 専門ユース向けツール

特定ユースケースに特化した PKC2 拡張ツール群。
B カテゴリの `record:offer` パターンを基盤とし、特定シナリオの UI/ワークフローを最適化。

## 共通課題: `record:update` 不在

PKC-Message v1 には `record:update` がないため、ステータス変更は:
1. `localStorage` にローカル保持（揮発性）
2. 新規レコードを tags 付きで offer（永続的だが冗長）
3. 将来の `record:update` を待つ

## ツール一覧

| # | Name | 一行サマリ | 優先度 |
|---|------|----------|-------|
| E1 | [reading-list](E1-reading-list.md) | URL 読書管理 | Tier 3 |
| E2 | [expense-tracker](E2-expense-tracker.md) | form で家計簿 | Tier 3 |
| E3 | [habit-tracker](E3-habit-tracker.md) | cron 的 todo 生成 | Tier 3 |
| E4 | [meeting-notes](E4-meeting-notes.md) | テンプレ議事録 | Tier 3 |
| E5 | [gratitude-journal](E5-gratitude-journal.md) | 毎日感謝 textlog | Tier 3 |
| E6 | [weekly-review](E6-weekly-review.md) | 先週まとめ | Tier 3 |
| E7 | [learning-cards](E7-learning-cards.md) | フラッシュカード | Tier 3 |
