# F5. xlsx-viewer（Excel シート切替表示）

**目的**: .xlsx をシート切替・基本書式付きで表示。

**UI 概要**:

- シートタブ（下部、Excel 風）
- スプレッドシートグリッド: 列ヘッダ (A,B,C...) + 行番号
- セル書式（太字、色、数値フォーマット）
- 固定ペイン（ヘッダ行/列）
- 列リサイズ + シート内検索

**実装ノート**:

- **SheetJS (xlsx-mini)** (~150KB, Apache-2.0)
  - `XLSX.read(data, {type:'array'})` → workbook → sheets
  - 数式: 計算結果値、スタイル、複数シート対応
- レンダリング: HTML `<table>` (シートごと)
  - 仮想スクロール（大シートは可視行のみレンダリング）
  - セル書式: `XLSX.utils.format_cell`
- 遅延パース: タブクリック時にシートをパース
- 大ファイル: 10,000 行超で先頭 1,000 行 + 「load more」

**SR 依存**: SR-13, SR-14, SR-15 | **優先度**: Tier 3

**バンドルライブラリ**: SheetJS xlsx-mini (Apache-2.0, ~150KB gzipped)
