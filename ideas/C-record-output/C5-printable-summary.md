# C5. printable-summary（印刷向け整形）

**目的**: PKC2 内容を印刷適正 HTML レイアウトで表示。

**UI 概要**:

- セクション選択（archetype 別）+ ソート順
- Preview + 「Print」（`window.print()`）
- serif フォント、適切なマージン、ページ区切り

**実装ノート**:

- `@media print` CSS
- `page-break-before: always` でセクション分離
- `Intl.DateTimeFormat('ja-JP')` で日本語日付

**SR 依存**: SR-2 | **優先度**: Tier 3
