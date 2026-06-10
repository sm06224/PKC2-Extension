# C4. csv-exporter（todo を CSV 化）

**目的**: PKC2 の todo レコードを CSV エクスポート。

**UI 概要**:

- 「Export Todos」+ プレビューテーブル
- カラム選択チェックボックス（title, description, due_date, status, tags）
- 「Download CSV」
- archetype フィルタ（todo 以外も可能）

**実装ノート**:

- `archetype === 'todo'` でフィルタ
- CSV: カンマ・改行含むフィールドはクォート
- BOM プレフィックス (`\uFEFF`) で Excel 日本語互換
- デリミタ切替（カンマ / タブ）

**SR 依存**: SR-2 | **優先度**: Tier 2
