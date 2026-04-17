# F7. mermaid-editor（Mermaid 編集 + ライブプレビュー）★ユーザー重点要件

**目的**: Mermaid ダイアグラムコードをライブプレビュー付きで編集し、
text レコード（ソース）または SVG attachment として保存する。
**メモ能力強化の中核ツール**。

**メッセージフロー**:

- 読込: `export:request` で既存 Mermaid テキストレコード取得、またはコード直接入力
- テキスト保存: `record:offer` (archetype=text, body=Mermaid ソース)
- SVG 保存: `record:offer` (archetype=attachment, asset=レンダリング済み SVG)

**UI 概要**:

- **分割ペイン**: 左=コードエディタ、右=ライブプレビュー
- **コードエディタ**:
  - monospace textarea + 行番号（CSS counter）
  - Tab → スペース挿入（フォーカス離脱防止）
  - 簡易シンタックスハイライト（graph, subgraph, --> 等のキーワード着色）
- **プレビュー**: SVG ダイアグラム、入力 500ms debounce で自動更新
- **ツールバー**: ダイアグラムテンプレートボタン
  - `[Flowchart]` `[Sequence]` `[Class]` `[Gantt]` `[State]` `[ER]` `[Pie]`
  - クリックでスターターコード挿入
- **保存**: 「Save as Text」/「Save as SVG」/「Save Both」
- **エラー表示**: 構文エラーをエディタ下部に行番号付きで表示
- **エクスポート**: 「Copy SVG」/「Download PNG」

**実装ノート**:

- **mermaid.js** (~300KB, MIT)
  - `mermaid.render('id', code)` → SVG 文字列
  - エラーハンドリング: invalid syntax で throw → catch して表示
- ライブプレビュー: `oninput` + debounce 500ms → re-render
- SVG → PNG: `new Image()` に SVG セット → canvas → `toDataURL('image/png')`
- テーマ: mermaid テーマ切替 (default / dark / forest / neutral)
- PKC2 統合:
  - text: body = Mermaid ソース（再編集可能）
  - attachment: body = SVG（Mermaid なしで閲覧可能）
  - 両方同時 offer で最大互換性

**SR 依存**: SR-8 (tags: 'mermaid','diagram'), SR-13, SR-14 | **優先度**: **Tier 2**

**バンドルライブラリ**: mermaid.js (MIT, ~300KB gzipped)
