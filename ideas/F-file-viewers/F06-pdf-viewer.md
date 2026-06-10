# F6. pdf-viewer（PDF.js 同梱閲覧）

**目的**: PDF.js を同梱して PDF をオフライン閲覧。

**UI 概要**:

- ページ表示（canvas レンダリング）
- ナビ: Previous / Next, ページ番号入力, スクロール
- ズーム: fit width / fit page / パーセント指定
- アウトライン / 目次サイドバー
- テキスト選択 + 印刷ボタン

**実装ノート**:

- **PDF.js** (Mozilla, Apache-2.0, ~500KB core + worker)
  - `pdfjsLib.getDocument({ data: pdfData })`
  - canvas レンダリング + テキストレイヤーオーバーレイ
- バンドル方式:
  1. pdf.js + pdf.worker.js をインライン (~1MB)
  2. worker を inline blob として読み込み（メインスレッド軽減）
- 可視ページのみレンダリング（スクロール時に遅延レンダ）
- **CJK フォント**: CMap ファイル (~5MB 全体) が必要
  - 全 CMap は大きすぎ → 主要 CJK CMap のみ (~1MB) をバンドル
  - 代替: 一部 CJK PDF でレンダリング劣化を許容し明記

**SR 依存**: SR-13, SR-14, SR-15, SR-9 | **優先度**: Tier 3

**バンドルライブラリ**: PDF.js (Apache-2.0, ~500KB + worker + CMap)

**サイズ注意**: CMap 込みで **2MB 超** の単一 HTML になる可能性。F カテゴリ最大。
