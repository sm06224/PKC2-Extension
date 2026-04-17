# B15. form-template（フォーム → form archetype）

**目的**: ビジュアルフォームビルダーで form archetype レコードを作成。

**UI 概要**:

- フォームデザイナー: フィールド追加（text / number / date / select / checkbox）
- フィールドプロパティ: ラベル、必須、デフォルト値
- 2 モード: 定義モード（テンプレ設計）/ 入力モード（値を入力して送信）
- ドラッグ&ドロップ並び替え

**実装ノート**:

- body:
  ```json
  { "fields": [
    { "name":"amount", "type":"number", "label":"金額", "required":true },
    { "name":"category", "type":"select", "label":"分類", "options":["食費","交通費"] }
  ]}
  ```
- バリデーション: required, min/max, pattern
- テンプレートライブラリを `localStorage` に保持

**SR 依存**: SR-8 | **優先度**: Tier 3
