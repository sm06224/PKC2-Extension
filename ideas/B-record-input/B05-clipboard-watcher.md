# B5. clipboard-watcher（クリップボード監視）

**目的**: クリップボード変化を監視し、新テキストを自動 offer。

**UI 概要**:

- 「Watching」/「Paused」トグル
- クリップボード履歴（タイムスタンプ付き）
- 各エントリ: プレビュー + 「Send」（or 自動送信モード）
- フィルタ: 最小テキスト長、重複無視

**実装ノート**:

- `navigator.clipboard.readText()` はユーザージェスチャー + Permissions API 必要
- 重複排除: 前回値ハッシュ保持
- プライバシー警告表示

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
