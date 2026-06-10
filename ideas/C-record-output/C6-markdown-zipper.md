# C6. markdown-zipper（各 record を MD → ZIP）

**目的**: 各レコードを Markdown に変換し ZIP でダウンロード。

**UI 概要**:

- 「Export as Markdown ZIP」
- オプション: archetype 選択、ファイル名パターン、front-matter トグル
- ファイルリストプレビュー + 「Download ZIP」

**実装ノート**:

- **JSZip** (~100KB) インライン埋め込み
- 構造: `{archetype}/{title-slugified}.md`
- front-matter: title, archetype, tags, created_at
- todo → `- [ ] description (期限: date)`

**SR 依存**: SR-2 | **優先度**: Tier 3 | **バンドル**: JSZip (MIT, ~100KB)
