# B. Record Input ツール

PKC2 に `record:offer` でデータを送り込むツール群。
汎用 composer (B1) を筆頭に、特定アーキタイプ向けの専門 UI を 15 種類提供する。
全ツールが `record:offer` → `record:accept` / `record:reject` のフローを共有するため、
B1 の実装が他ツールの基盤コードとなる。

---

## 使用する PKC-Message 型

```ts
// 送信
'record:offer'     // エントリを PKC2 に送信
// 受信
'record:accept'    // PKC2 がオファーを受理
'record:reject'    // PKC2 がオファーを拒否
// SR-4 採用時
'record:ack'       // bridge が自動送信する到達確認（受理前）
```

共通 payload:
```ts
interface RecordOfferPayload {
  title: string;
  body: string;
  archetype?: ArchetypeId;       // 'text' | 'textlog' | 'todo' | 'form' | 'attachment'
  source_container_id?: string;
  // SR-8 拡張:
  tags?: string[];
  assets?: Record<string, string>;
  relation_hints?: Array<{ kind: string; to_title?: string }>;
}
```

共通フロー:
```
[ツール] --record:offer--> [PKC2 iframe]
[PKC2]   --record:ack-->   [ツール]        ← SR-4（到達確認）
[PKC2]   --record:accept   [ツール]        ← ユーザ操作後
          or record:reject-->
```

---

## B1. record-offer-composer（汎用 offer フォーム）

**目的**: 任意の archetype の `record:offer` を手動構成して送信する汎用ツール。
全 B カテゴリの基本形であり、プロトコル学習用途にも使える。

**メッセージフロー**:

```
[composer] --record:offer--> [PKC2]
[PKC2]    --record:accept/reject--> [composer]
```

**UI 概要**:

- **フォーム**:
  - archetype セレクタ（text / todo / textlog / form / attachment）
  - title 入力
  - body テキストエリア（archetype 切替で placeholder が変化）
  - tags（カンマ区切り入力 → タグチップ表示）
  - 任意: source_container_id、assets（ファイルピッカー → base64）
- **JSON プレビューパネル**: 送信予定の envelope 全体を表示
- **「Send Offer」ボタン** + ステータス表示（pending → accepted / rejected）
- **履歴**: 送信済み offer のリスト（ステータス付き）

**実装ノート**:

- archetype 別 body バリデーション: todo は `{ description }` 必須、form はスキーマ構造チェック
- ファイル → base64: `FileReader.readAsDataURL()`
- ドラフト自動保存: `localStorage` に現在のフォーム状態を永続化
- JSON プレビュー: `JSON.stringify(envelope, null, 2)` をシンタックスカラーリング付きで表示

**SR 依存**: SR-4 (ack)、SR-8 (tags / assets / relations)、SR-14 (mime_type / filename)

**優先度**: Tier 1

---

## B2. todo-quick-sender（todo 専用入力）

**目的**: 最小限の UI で素早く todo レコードを作成する。
description + 日付の 2 フィールドのみのキーボードファースト設計。

**メッセージフロー**: B1 と同一。archetype は `todo` 固定。

**UI 概要**:

- **1 行入力**: description フィールド（大きめフォント）
- **日付ピッカー**: due date（任意）
- **優先度セレクタ**: high / medium / low → タグにマッピング
- **「Add」ボタン** + Enter キーショートカット
- **送信履歴リスト**: accept / reject ステータス付き

**実装ノート**:

- todo body 形式: `JSON.stringify({ status: 'open', description, date?, archived: false })`
- キーボードファースト: Tab でフィールド移動、Enter で即送信
- 送信キュー: 前の offer が pending 中でも次をキューに積み、順次送信
- 連続入力: 送信後に description フィールドを自動クリア + フォーカス復帰

**SR 依存**: SR-4 (ack、キュー管理に有用)、SR-8 (tags で優先度)

**優先度**: Tier 1

---

## B3. textlog-journaler（textlog 連続追記）

**目的**: 追記専用のジャーナルインターフェース。
各エントリが textlog レコードとして PKC2 に送信される。

**メッセージフロー**: 送信のたびに `record:offer` (archetype=textlog)。

**UI 概要**:

- **ヘッダ**: 今日の日付、自動生成タイトル「YYYY-MM-DD Journal」
- **メイン**: このセッションの過去エントリ一覧（タイムスタンプ付き）
- **下部**: テキスト入力エリア + 「Append」ボタン
- **エントリ形式**: `[HH:MM] ユーザーテキスト`

**実装ノート**:

- 各 append = 新規 `record:offer` (archetype=textlog)
- body: タイムスタンプ接頭辞 + ユーザーテキスト（textlog body 形式準拠）
- PKC-Message v1 には `record:update` がないため、1 追記 = 1 新規レコード
- `sessionStorage` でセッション内のエントリ一覧を追跡

**SR 依存**: SR-4 (ack)、SR-8 (tags)

**優先度**: Tier 2

---

## B4. web-clipper（URL 貼付 → 抽出 → offer）

**目的**: Web ページの内容を貼り付け、可読テキストを抽出して text レコードとして送信する。

**メッセージフロー**: `[clipper] --record:offer--> [PKC2]`

**UI 概要**:

- **URL 入力フィールド**（メタ情報としてタグに保存）
- **HTML/テキスト貼付エリア**: ブラウザからコピーしたコンテンツを貼り付け
- **プレビューペイン**: 抽出された title + 本文
- **編集**: 送信前にプレビューを手動編集可能
- **「Send to PKC2」ボタン**

**実装ノート**:

- **オフライン制約**: 単一 HTML からの URL 直接フェッチは CORS で不可
- 現実的アプローチ: ユーザーが生 HTML / テキストを貼り付け、ツールが可読コンテンツを抽出
- 抽出ロジック:
  1. 一時 `<div>` を作成、`innerHTML` にセット
  2. `<script>`, `<style>`, `<nav>`, `<footer>` を除去
  3. `textContent` を取得、段落構造を保持
  4. `<title>` / `<h1>` からタイトルをヒューリスティック抽出
- ソース URL は tags に `['source:https://...']` として保存

**SR 依存**: SR-8 (tags でソース URL)、SR-14 (mime_type)

**優先度**: Tier 2

---

## B5. clipboard-watcher（クリップボード監視）

**目的**: クリップボードの変化を監視し、新しいテキストを自動的に offer する。

**メッセージフロー**: 新しいクリップボード値ごとに `record:offer`。

**UI 概要**:

- **トグル**: 「Watching」 / 「Paused」
- **クリップボード履歴リスト**: タイムスタンプ付き
- **各エントリ**: プレビューテキスト + 「Send」ボタン（または自動送信モード）
- **フィルタ**: 最小テキスト長、重複無視

**実装ノート**:

- `navigator.clipboard.readText()` はユーザージェスチャー + Permissions API が必要
- ポーリングアプローチ: フォーカス時に `document.execCommand('paste')` で非表示 textarea に取得
- 重複排除: 前回値のハッシュを保持、同一なら skip
- プライバシー: クリップボード監視中である旨の警告を表示

**SR 依存**: SR-4 (ack)、SR-8 (tags)

**優先度**: Tier 3

---

## B6. csv-importer（CSV 一括 offer）

**目的**: CSV ファイルをインポートし、カラムをレコードフィールドにマッピングしてバッチ offer する。

**メッセージフロー**: 行ごとに `record:offer` を順次送信。行単位でステータス追跡。

**UI 概要**:

- **ファイル入力**: CSV ファイル選択
- **カラムマッピング UI**: CSV 列ごとにドロップダウン → レコードフィールド (title, body, tag, due_date 等)
- **archetype セレクタ**
- **プレビューテーブル**: 先頭 10 行の変換結果
- **「Import All」ボタン** + プログレスバー
- **行別ステータス**: pending / accepted / rejected

**実装ノート**:

- CSV パース: 自作の split ベースパーサー（クォート内カンマ、改行対応）
  - Papa Parse 等の外部ライブラリは不要（基本的な CSV で十分）
- バッチ送信: 順次送信、設定可能なディレイ付き（SR-7 レート制限準拠）
- エラー処理: reject された行はスキップして続行
- 結果レポート: accept / reject 数のサマリ + CSV ダウンロード

**SR 依存**: SR-4 (ack、バッチ追跡)、SR-7 (レート制限)、SR-8 (tags / assets)

**優先度**: Tier 2

---

## B7. markdown-batch（front-matter 付き MD バッチ）

**目的**: YAML front-matter 付きの Markdown ファイル群をバッチ offer する。

**メッセージフロー**: ファイルごとに `record:offer` (archetype=text)。

**UI 概要**:

- **ファイル入力**: 複数 .md ファイル選択、またはドラッグ & ドロップ
- **パース結果プレビュー**: front-matter から抽出した title / tags + 本文
- **「Import All」** + プログレス

**実装ノート**:

- front-matter パース: `---` デリミタを検出、間の YAML を簡易 key:value パーサーで処理
  - 完全 YAML ライブラリは不要。`key: value` 行を split で処理
- front-matter キーマッピング: `title`, `tags`, `date`, `archetype` (デフォルト: text)
- body = 2 番目の `---` 以降全体
- バッチ送信: B6 と同じパターン

**SR 依存**: SR-4、SR-8 (tags)

**優先度**: Tier 3

---

## B8. bookmark-importer（bookmarks.html → offer）

**目的**: ブラウザのブックマークエクスポート（Netscape bookmarks.html 形式）をインポートする。

**メッセージフロー**: ブックマークごとに `record:offer`。

**UI 概要**:

- **ファイル入力**: bookmarks.html ファイル選択
- **ツリー表示**: パースしたブックマーク（フォルダ = グループ）
- **チェックボックス選択**: 全選択 / フォルダ単位
- **「Import Selected」ボタン**

**実装ノート**:

- Netscape bookmarks 形式: `<DL><DT><A HREF="...">Title</A>` 構造
- `DOMParser` で HTML をパース、`<DT>` / `<DL>` ツリーを walk
- 各ブックマーク → text レコード:
  - title = ブックマークタイトル
  - body = URL + description
  - tags = フォルダパス（例: `['Toolbar', 'Tech']`）

**SR 依存**: SR-8 (tags でフォルダ階層)

**優先度**: Tier 3

---

## B9. rss-fetcher（RSS → offer）

**目的**: RSS / Atom XML をパースし、各エントリを text レコードとして offer する。

**メッセージフロー**: エントリごとに `record:offer`。

**UI 概要**:

- **XML 貼付エリア**: RSS/Atom XML コンテンツを貼り付け
- **パース結果表示**: フィードタイトル、エントリ一覧
- **チェックボックス選択**: インポート対象を選択
- **「Import Selected」ボタン**

**実装ノート**:

- **オフライン制約**: B4 同様、URL 直接フェッチ不可。ユーザーが XML を貼り付ける
- `DOMParser` で `text/xml` としてパース
- RSS 2.0: `<item>` → `<title>`, `<description>`, `<link>`, `<pubDate>`
- Atom: `<entry>` → `<title>`, `<content>`, `<link href="">`, `<published>`
- マッピング: title → title, description + link → body, pubDate → tags

**SR 依存**: SR-8 (tags)

**優先度**: Tier 3

---

## B10. qr-scanner（QR 読取 → offer）

**目的**: デバイスカメラで QR コードを読み取り、デコード内容を text レコードとして送信する。

**メッセージフロー**: スキャンごとに `record:offer`。

**UI 概要**:

- **カメラビューファインダー**: `getUserMedia` で背面カメラ表示
- **デコード結果**: ビューファインダー下に表示
- **「Send to PKC2」ボタン**（デコード値ごと）
- **スキャン履歴**
- **フォールバック**: QR コード画像のファイル入力（カメラ不可時）

**実装ノート**:

- カメラ: `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
- QR デコード: **jsQR** ライブラリ (~40KB) をインライン埋め込み
- フレームごとの処理: video → canvas に描画 → `getImageData` → jsQR に渡す
- スキャン間隔: ~200ms/フレーム
- ファイル入力フォールバック: `<input type="file" accept="image/*">` → canvas → jsQR

**SR 依存**: SR-8 (tags)

**優先度**: Tier 3

**バンドルライブラリ**: jsQR (Apache-2.0, ~40KB minified)

---

## B11. voice-memo（Web Speech → textlog）

**目的**: Web Speech API で音声をテキストに変換し、textlog レコードとして送信する。

**メッセージフロー**: メモごとに `record:offer` (archetype=textlog)。

**UI 概要**:

- **大きな「Record」ボタン**（マイクアイコン）
- **リアルタイム文字起こし表示**: interim results を逐次表示
- **「Stop & Send」ボタン**
- **文字起こし履歴**

**実装ノート**:

- `SpeechRecognition` / `webkitSpeechRecognition` API
- 設定: `continuous = true`, `interimResults = true`
- 言語: `lang = 'ja-JP'`（設定で変更可能）
- **オフライン制限**: Chrome の Web Speech API はネットワーク送信が必要な場合がある。Firefox はオフラインモード利用可。この制約をドキュメントに明記
- フォールバック: Speech API が利用不可の場合は手動テキスト入力

**SR 依存**: SR-4 (ack)、SR-8 (tags)

**優先度**: Tier 3

---

## B12. screenshot-attacher（画面キャプチャ → attachment）

**目的**: 画面 / ウィンドウ / タブをキャプチャし、attachment レコードとして PKC2 に送信する。

**メッセージフロー**: `record:offer` (archetype=attachment、assets に base64 画像)。

**UI 概要**:

- **「Capture Screen」ボタン**: `getDisplayMedia` をトリガー
- **プレビュー**: キャプチャ画像の表示
- **簡易トリミング**: canvas ベースの矩形選択
- **title 入力**
- **「Send to PKC2」ボタン**

**実装ノート**:

- `navigator.mediaDevices.getDisplayMedia()` → video ストリーム → canvas に 1 フレーム描画
- `canvas.toDataURL('image/png')` で base64 取得
- 簡易トリミング: canvas 上の選択矩形 → `drawImage` で切り出し
- 画像データは SR-8 の assets フィールドまたは SR-13 の attachment body 形式で送信
- サイズ注意: スクリーンショットは大きくなりがち → SR-9 chunking が必要になる場合あり

**SR 依存**: SR-8 (assets)、SR-9 (大画像の chunking)、SR-13 (attachment body 形式)、SR-14 (mime_type / filename)

**優先度**: Tier 3

---

## B13. pomodoro-logger（タイマー終了 → 自動 offer）

**目的**: ポモドーロタイマーが完了したとき、作業セッションを textlog レコードとして自動記録する。

**メッセージフロー**: タイマー完了時に `record:offer` (archetype=textlog)。

**UI 概要**:

- **大きな円形タイマー表示**: 25 分作業 / 5 分休憩（設定可能）
- **タスク説明入力**: 「何に取り組んでいるか」
- **Start / Pause / Reset ボタン**
- **完了時**: 「Pomodoro: {タスク} - {所要時間}」を body とする自動 offer
- **セッション履歴**: 合計ポモドーロ数の表示

**実装ノート**:

- `setInterval` ベースのタイマー（ドリフト補正付き）
- 通知音: `AudioContext` オシレーターで生成（音声ファイル不要）
- バックグラウンドタブ用: Notification API
- タイマー終了時の自動 offer: ユーザーのタスク説明を body に含む
- tags: `['pomodoro', 'YYYY-MM-DD']`

**SR 依存**: SR-4 (ack)、SR-8 (tags: `'pomodoro'`)

**優先度**: Tier 3

---

## B14. daily-log-starter（今日の textlog を自動生成）

**目的**: 1 クリックで今日の日報テンプレートを textlog レコードとして生成する。

**メッセージフロー**: 1 回の `record:offer` (archetype=textlog)。

**UI 概要**:

- **「Create Today's Log」ボタン**（大きめ）
- **テンプレートプレビュー / エディタ**（設定で変更可能）
- **デフォルトテンプレート**:
  ```
  # YYYY-MM-DD (曜日) 日報
  ## 今日の目標
  - 
  ## メモ
  - 
  ## 明日への申し送り
  - 
  ```
- **送信後ステータス表示**

**実装ノート**:

- テンプレートは `localStorage` に保存、設定パネルで編集可能
- 日付フォーマット: `Intl.DateTimeFormat('ja-JP', { weekday: 'short' })` で `YYYY-MM-DD (月)` 形式
- 重複防止: 最終作成日を `localStorage` に保存、同日に再度作成しようとすると警告
- tags: `['daily-log', 'YYYY-MM-DD']`

**SR 依存**: SR-4 (ack)、SR-8 (tags: 日付ベース)

**優先度**: Tier 3

---

## B15. form-template（フォーム → form archetype）

**目的**: ビジュアルフォームビルダーで form archetype のレコードを作成する。

**メッセージフロー**: `record:offer` (archetype=form)。

**UI 概要**:

- **フォームデザイナー**: フィールド追加（text / number / date / select / checkbox）
- **フィールドプロパティ**: ラベル、必須フラグ、デフォルト値、バリデーション
- **プレビュー**: レンダリングされたフォームの表示
- **2 つのモード**:
  1. **定義モード**: フォームテンプレートを設計して送信
  2. **入力モード**: フォームに値を入力して、入力済みフォームレコードとして送信
- **ドラッグ & ドロップ**: フィールドの並べ替え（HTML Drag and Drop API）

**実装ノート**:

- フォームスキーマ: JSON Schema ライクな構造を body に格納
  ```json
  {
    "fields": [
      { "name": "amount", "type": "number", "label": "金額", "required": true },
      { "name": "category", "type": "select", "label": "分類", "options": ["食費","交通費","光熱費"] }
    ]
  }
  ```
- バリデーション: required チェック、number の min/max、text の pattern
- フォーム定義の保存: `localStorage` にテンプレートライブラリとして保持

**SR 依存**: SR-8 (拡張 payload でスキーマ送信)

**優先度**: Tier 3
