# E2. expense-tracker（form で家計簿）

**目的**: 支出を form archetype で記録し月別サマリ表示。

**UI 概要**:

- 入力: 日付, 金額 (JPY), カテゴリ, 説明
- クイックカテゴリボタン（アイコン付き）
- 月別サマリ: 合計 + カテゴリ別棒グラフ

**実装ノート**:

- body: `{ date, amount, category, description, currency:'JPY' }`
- tags: `['expense', category]`
- 棒グラフ: CSS ベース（div width を金額に比例）
- `Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY' })`

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
