# B8. bookmark-importer（bookmarks.html → offer）

**目的**: ブラウザブックマークエクスポート（Netscape 形式）をインポート。

**UI 概要**:

- ファイル入力
- ツリー表示（フォルダ = グループ）
- チェックボックス選択（全選択 / フォルダ単位）
- 「Import Selected」

**実装ノート**:

- `DOMParser` で `<DT>/<DL>` ツリーを walk
- 各ブックマーク → title=ブックマーク名, body=URL+description, tags=フォルダパス

**SR 依存**: SR-8 | **優先度**: Tier 3
