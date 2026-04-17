# B7. markdown-batch（front-matter 付き MD バッチ）

**目的**: YAML front-matter 付き Markdown ファイル群をバッチ offer。

**UI 概要**:

- 複数 .md ファイル選択 or ドラッグ&ドロップ
- パース結果プレビュー（title / tags / 本文）
- 「Import All」+ プログレス

**実装ノート**:

- `---` デリミタで front-matter 検出 → 簡易 key:value パーサー
- マッピング: `title`, `tags`, `date`, `archetype`（デフォルト text）
- body = 2 番目 `---` 以降全体

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
