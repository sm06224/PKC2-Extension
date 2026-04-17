# F3. docx-viewer（Word 文書表示）★ユーザー重点要件

**目的**: .docx をスタイル保持で表示。見出し、リスト、表、画像、太字/斜体をレンダリング。

**UI 概要**:

- ドキュメント表示エリア（ページ風スタイル: 白背景、マージン、影）
- 見出しから目次サイドバー自動生成
- ズームコントロール
- 「Copy as Markdown」ボタン

**実装ノート**:

- **mammoth.js** (~30KB, MIT): DOCX → HTML 変換
  - 対応: 段落、見出し、リスト、表、太字/斜体、ハイパーリンク、画像
  - 画像: base64 data URL として抽出
  - 日本語スタイルマップ: `p[style-name='見出し 1'] => h1:fresh`
- 使用例:
  ```js
  const result = await mammoth.convertToHtml(
    { arrayBuffer: docxBuffer },
    { styleMap: ["p[style-name='見出し 1'] => h1:fresh"] }
  );
  ```
- 非対応: テキストボックス、フロート画像、ヘッダ/フッタ
  - 非対応要素は警告バナーで表示
- 印刷: `@media print` CSS

**SR 依存**: SR-13, SR-14, SR-15 | **優先度**: **Tier 3 早期**

**バンドルライブラリ**: mammoth.js (MIT, ~30KB gzipped)
