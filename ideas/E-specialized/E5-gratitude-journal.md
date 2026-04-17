# E5. gratitude-journal（毎日感謝 textlog）

**目的**: 毎日「感謝すること」を 3 つ記入する textlog ジャーナル。

**UI 概要**:

- 落ち着いたデザイン（暖色系、serif、大きめフォント）
- 3 つの入力フィールド + 自由記述
- 「Save」+ ストリークカウンター

**実装ノート**:

- body: 番号付きリスト + リフレクション
- tags: `['gratitude', 'YYYY-MM-DD']`
- ストリーク: export → gratitude タグの連続日付を数える

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
