# C. Record Output ツール

PKC2 から `export:request` / `export:result` でデータを取得し、
可視化・変換・エクスポートするツール群。
全ツールが「container を丸ごと取得 → ローカルで加工」のフローを共有する。

---

## 使用する PKC-Message 型

```ts
// 送信
'export:request'    // container データの全体要求
// 受信
'export:result'     // container JSON 全体が返る
// SR-15 採用時（選択的取得）
'asset:request'     // 特定 asset だけを要求
'asset:result'      // asset データが返る
```

共通フロー:
```
[ツール] --export:request--> [PKC2 iframe]
[PKC2]   --export:result-->  [ツール]     ← container JSON 全体
[ツール] ローカルでフィルタ・変換・可視化
```

SR-2 (`correlation_id`) を使うと並列リクエストのレスポンスを正確にマッチできる。

---

## C1. export-downloader（export:result を DL）

**目的**: PKC2 から container JSON を取得し、ファイルとしてダウンロードする。
embedded PKC2 のエクスポート検証にも使える。

**メッセージフロー**:

```
[downloader] --export:request--> [PKC2]
[PKC2]       --export:result-->  [downloader]
[downloader] → ブラウザダウンロード
```

**UI 概要**:

- **「Request Export」ボタン**
- **ローディングスピナー**（リクエスト中）
- **受信時**: ファイルサイズ、レコード数、container_id を表示
- **「Download JSON」/「Download Minified」ボタン**
- **ファイル名**: `pkc2-export-{container_id}-{date}.json`

**実装ノート**:

- `export:request` payload: `{}`（空、全 container を要求）
- Blob ダウンロード: `new Blob([json], { type: 'application/json' })` → `URL.createObjectURL` → `<a>` click
- タイムアウト: 30 秒、応答なければエラー表示
- Minified: `JSON.stringify(container)` (indent なし)

**SR 依存**: SR-2 (`correlation_id`)、SR-3 (`error` で失敗通知)

**優先度**: Tier 2

---

## C2. container-json-viewer（container 構造をツリー表示）

**目的**: エクスポートされた container の構造をインタラクティブなツリーで可視化する。
データ形状の理解・デバッグに使用。

**メッセージフロー**: `export:request` → `export:result` 後、ローカルレンダリング。

**UI 概要**:

- **折りたたみツリー**: container → entries (archetype 別グループ) → 個別エントリ → フィールド
- **archetype 別バッジ**: エントリ数を表示
- **エントリクリック**: サイドパネルに全フィールド詳細表示
- **検索 / フィルタ**: ツリー内テキスト検索
- **統計サマリ**: 総エントリ数、archetype 別内訳、総 assets サイズ

**実装ノート**:

- 再帰的 DOM ツリービルダー（外部ライブラリ不要）
- 遅延レンダリング: 大きい container では子ノードを展開時に生成
- JSON 値のシンタックスカラーリング: 簡易正規表現ベース（string=緑、number=青、boolean=赤、null=グレー）
- 検索: 線形スキャンで文字列マッチ、一致箇所をハイライト

**SR 依存**: SR-2 (`correlation_id`)

**優先度**: Tier 3

---

## C3. backup-diff（2 PKC2 の diff）

**目的**: 2 つの container エクスポートを横並びで比較し、
追加・削除・変更されたレコードを表示する。

**メッセージフロー**:

```
方法 1: 2 iframe に export:request
  [diff] --export:request--> [PKC2-A] --export:result--> [diff]
  [diff] --export:request--> [PKC2-B] --export:result--> [diff]

方法 2: 2 つの JSON ファイルをアップロード
  [diff] ← file A (upload)
  [diff] ← file B (upload)
```

**UI 概要**:

- **2 つのソースセレクタ**: 各々「PKC2 iframe から取得」または「JSON ファイルアップロード」
- **差分ビュー**: 3 列テーブル（A のみ / 変更あり / B のみ）
- **色分け**: 🟢 追加、🔴 削除、🟡 変更
- **エントリクリック**: フィールド別 diff 表示
- **サマリ**: 「A: 45 件, B: 52 件, 共通: 40, A のみ: 5, B のみ: 12, 変更: 3」

**実装ノート**:

- レコードマッチ: `lid` (local ID) で突き合わせ
- 同一判定: `JSON.stringify(entry)` で比較
- 変更レコード: フィールドごとに比較し、差異をハイライト
- 2 iframe モード: 非表示 iframe を 2 つ生成、各々 ping → export

**SR 依存**: SR-2 (`correlation_id`、並列 export のマッチ)、SR-11 (broadcast / multicast)

**優先度**: Tier 3

---

## C4. csv-exporter（todo を CSV 化）

**目的**: PKC2 の todo レコードを CSV ファイルとしてエクスポートする。
スプレッドシートでの管理・分析用。

**メッセージフロー**: `export:request` → `export:result` → todo フィルタ → CSV 生成。

**UI 概要**:

- **「Export Todos」ボタン**
- **プレビューテーブル**: 抽出した todo 一覧
- **カラム選択**: title, description, due_date, status, tags（チェックボックス）
- **「Download CSV」ボタン**
- **オプション**: archetype フィルタドロップダウン（todo 以外も対応可能）

**実装ノート**:

- `export:result` からエントリを `archetype === 'todo'` でフィルタ
- CSV 生成: カンマ・改行を含むフィールドはクォートで囲む
- BOM プレフィックス (`\uFEFF`) で Excel 日本語互換
- デリミタ設定: カンマ / タブ 切替可能

**SR 依存**: SR-2 (`correlation_id`)

**優先度**: Tier 2

---

## C5. printable-summary（印刷向け整形）

**目的**: PKC2 の内容を印刷に適した HTML レイアウトで表示する。

**メッセージフロー**: `export:request` → `export:result` → 印刷レイアウト生成。

**UI 概要**:

- **セクション選択**: どの archetype を含めるか
- **ソート順**: 日付順 / タイトル順 / archetype 順
- **「Preview」**: ページネーション付き印刷レイアウト表示
- **「Print」ボタン**: `window.print()` を発火
- **書体**: serif フォント、適切なマージン、セクション間のページ区切り

**実装ノート**:

- `@media print` CSS で画面表示と印刷を分離
- セクション間: `page-break-before: always`
- 目次: archetype 別セクション + エントリ数
- ヘッダ / フッタ: container_id + エクスポート日付
- 日付フォーマット: `Intl.DateTimeFormat('ja-JP')` で日本語ロケール対応

**SR 依存**: SR-2

**優先度**: Tier 3

---

## C6. markdown-zipper（各 record を MD → ZIP）

**目的**: 各レコードを Markdown ファイルに変換し、ZIP にまとめてダウンロードする。

**メッセージフロー**: `export:request` → `export:result` → MD 変換 → ZIP 生成。

**UI 概要**:

- **「Export as Markdown ZIP」ボタン**
- **オプション**: archetype 含む / 除外、ファイル名パターン、front-matter トグル
- **プレビュー**: ファイルリスト（名前 + サイズ）
- **「Download ZIP」ボタン**

**実装ノート**:

- **JSZip** (~100KB minified) をインライン埋め込みで ZIP 生成
- ディレクトリ構造: `{archetype}/{title-slugified}.md`
- front-matter: `title`, `archetype`, `tags`, `created_at`
- body 変換:
  - text / textlog: body をそのまま使用
  - todo: `- [ ] description (期限: date)` 形式
  - form: フィールドをテーブルで表示
- ZIP ダウンロード: `Blob` 経由

**SR 依存**: SR-2

**優先度**: Tier 3

**バンドルライブラリ**: JSZip (MIT, ~100KB minified)

---

## C7. tag-cloud（タグ頻度可視化）

**目的**: 全レコードのタグ頻度をワードクラウドとして可視化する。

**メッセージフロー**: `export:request` → `export:result` → タグ抽出 → クラウド描画。

**UI 概要**:

- **ワードクラウド**: 頻度に応じてフォントサイズ変化
- **タグクリック**: そのタグを持つレコード一覧を表示
- **統計サイドバー**: タグリスト（頻度順ソート + カウント）
- **archetype 別色分け**

**実装ノート**:

- タグ抽出: 全エントリの `tags` 配列をイテレート、頻度カウント
- クラウドレイアウト: スパイラル配置アルゴリズム（D3 不要）
  - フォントサイズ: 頻度に比例（min 12px 〜 max 48px）
  - CSS absolute positioning + 回転（0° / 90°）
- 最小実装: 頻度順の棒グラフ（クラウドより簡単、情報量は同等）
- クリックハンドラ: フィルタしたエントリをクラウド下部にリスト表示

**SR 依存**: SR-2、SR-8 (tags フィールドが populated であること)

**優先度**: Tier 3

---

## C8. relation-graph（relations をグラフ表示）

**目的**: レコード間の relations をインタラクティブなノードリンクグラフとして可視化する。

**メッセージフロー**: `export:request` → `export:result` → relation 抽出 → グラフ描画。

**UI 概要**:

- **Force-directed グラフ**: ノード = レコード、エッジ = relation
- **ノード色**: archetype 別
- **ノードサイズ**: 接続数に比例
- **ノードクリック**: サイドバーにレコード詳細表示
- **ズーム / パン**: マウスホイール + ドラッグ
- **レイアウト選択**: force-directed / 階層 / 円形

**実装ノート**:

- **外部ライブラリ不使用**: Canvas ベースの自作 force-directed レイアウト
  - ノード間: 斥力（クーロンの法則）
  - エッジ: 引力（フックの法則）
  - ダンピング + イテレーション（安定するまで）
  - ~200 行の物理シミュレーションコード
- Canvas レンダリング: `requestAnimationFrame` ループ
- インタラクション: マウスドラッグでノード移動、ホイールズーム、クリック選択
- パフォーマンス: ~500 ノードまで。超過時は警告表示
- 代替: 小規模グラフでは SVG ベース（クリックハンドリングが容易）

**SR 依存**: SR-2、SR-8 (`relation_hints`)

**優先度**: Tier 3
