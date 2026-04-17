# F9. markdown-mermaid-note（MD + Mermaid + 図埋め込みノートエディタ）

**目的**: Markdown テキストに Mermaid ダイアグラムと画像を埋め込めるリッチノートエディタ。
「PKC2 の究極メモツール」。

**メッセージフロー**:

- 読込: `export:request` → text レコード
- 保存: `record:offer` (archetype=text, body=Markdown ソース)
- 画像: 任意で attachment offer

**UI 概要**:

- **3 ペイン**（設定切替可能）:
  - エディタ: Markdown textarea + Mermaid コードブロック
  - プレビュー: レンダリング済み HTML + ダイアグラム
  - アウトライン: 見出しベース目次
- **ツールバー**: bold, italic, heading, list, link, image, 「Insert Mermaid Block」
- **Mermaid ブロック**: ` ```mermaid ` フェンスドコード → プレビューでダイアグラム表示
- **画像挿入**: paste → base64 インライン or attachment offer
- **キーバインド**: Ctrl+B (bold), Ctrl+I (italic), Ctrl+S (save)

**実装ノート**:

- Markdown → HTML:
  - 自作簡易パーサー (~200 行): headers, bold, italic, links, code blocks, lists, tables
  - または **marked.js** (~25KB, MIT) で完全 CommonMark 対応
- Mermaid 統合: ` ```mermaid ` ブロック検出 → mermaid.js でレンダリング
- 画像: `paste` イベント → `clipboardData.items` → file → base64 → inline MD
- アウトライン: `#` 見出しを抽出しクリッカブル TOC
- 自動保存: debounce 5s で `localStorage`

**SR 依存**: SR-8, SR-13, SR-14, SR-9 | **優先度**: Tier 3

**バンドルライブラリ**: mermaid.js (~300KB) + 任意で marked.js (~25KB)
