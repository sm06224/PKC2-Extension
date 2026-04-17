# A. Debugging / Inspection ツール

PKC-Message プロトコルの開発・検証を支援するツール群。
全カテゴリのツール開発に先立ち、メッセージの送受信を可視化・検証する基盤を提供する。
A1 message-probe は全ツール開発の前提であり、最優先で実装する。

---

## 使用する PKC-Message 型

Debugging ツールは **全メッセージ型** を対象とする。

```ts
// 主に使用する型
'ping' | 'pong'          // 接続確認・capability 取得
// 受動的に観測する型（全トラフィック）
'record:offer' | 'record:accept' | 'record:reject'
'export:request' | 'export:result'
'navigate' | 'custom'
```

共通の受信パターン:
```
window.addEventListener('message', (event) => {
  if (event.data?.protocol !== 'pkc-message') return;
  // envelope として処理
});
```

---

## A1. message-probe（ping/pong + 全 envelope ロガー）

**目的**: PKC2 iframe との接続確認と、流れる全メッセージのリアルタイム監視。
全ツール開発のデバッグ基盤として最初に実装する。

**メッセージフロー**:

```
[message-probe]  --ping-->  [PKC2 iframe]
[PKC2 iframe]    --pong-->  [message-probe]   ← PongProfile 表示

   + パッシブリスナーが全 envelope を傍受してログ表示
```

**UI 概要**:

- **トップバー**: 「Send Ping」ボタン、接続ステータスインジケータ（●緑 / ●赤）
- **左パネル**: PongProfile 表示
  - `container_id`, `version`, `record_count`, `capabilities` 一覧
- **右パネル**: スクロール可能なメッセージログテーブル
  - カラム: timestamp, type, source_id, target_id, payload（折りたたみ JSON ツリー）
- **下部**: フィルタ（type 別チェックボックス、payload 内テキスト検索）
- **操作**: 「Copy All」「Clear」ボタン

**実装ノート**:

- `window.addEventListener('message', ...)` で全メッセージをキャプチャ
- `event.data?.protocol === 'pkc-message'` でフィルタ表示。非 PKC メッセージも表示するオプションあり
- タイムスタンプ: `Intl.DateTimeFormat` でロケール対応
- payload 表示: 再帰的 DOM ビルダーで折りたたみ JSON ツリー（外部ライブラリ不要）
- フィルタ設定: `localStorage` に永続化

**SR 依存**: SR-1 (`message_id`) でログの相関追跡が容易になるが、必須ではない。SR-10 (capability negotiation) で pong 表示が充実。

**優先度**: Tier 1（最優先）

---

## A2. envelope-validator（JSON 貼付け → envelope v1 妥当性判定）

**目的**: 手動作成した JSON が PKC-Message v1 envelope として妥当かチェックする。
学習用途・手動デバッグ用途。

**メッセージフロー**: postMessage 不使用。ローカル検証ロジックのみ。

**UI 概要**:

- **入力エリア**: monospace テキストエリア（JSON 貼付け用）
- **「Validate」ボタン**
- **結果パネル**: フィールド別チェックリスト
  - `protocol` → ✅ `'pkc-message'` / ❌ 値不正
  - `version` → ✅ `1` / ❌ 値不正
  - `type` → ✅ 許可リスト内 / ❌ 未知の型
  - `source_id` → ✅ string | null / ❌ 型不正
  - `target_id` → ✅ string | null / ❌ 型不正
  - `payload` → ✅ 存在 / ⚠️ undefined
  - `timestamp` → ✅ 有効な ISO 8601 / ❌ パース不可
- **「Fix & Copy」ボタン**: 修正可能な問題を自動修正（timestamp 補完、message_id 生成）してクリップボードにコピー

**実装ノート**:

- `JSON.parse` の try/catch で構文エラーを捕捉。エラー位置を表示
- 型チェック: `typeof` + 許可値リストで逐一検証
- `type` 許可リスト: `['ping','pong','record:offer','record:accept','record:reject','export:request','export:result','navigate','custom']`
- ISO 8601 検証: `new Date(timestamp)` が `Invalid Date` でないこと + 正規表現で形式チェック
- SR-1 採用時は `message_id` の UUID 形式チェックも追加

**SR 依存**: SR-1 (`message_id`)、SR-3 (`error` 型)、SR-8 (拡張 payload) — いずれも任意。存在すれば検証対象に含める。

**優先度**: Tier 1（開発時に頻繁に使用）

---

## A3. capability-matrix（複数 PKC2 の version / capabilities 比較）

**目的**: 複数の PKC2 インスタンスに ping を送り、PongProfile を並べて比較する。
バージョン差異や capability の有無を一目で把握する。

**メッセージフロー**:

```
[matrix] --ping--> [PKC2-A] --pong--> [matrix]
[matrix] --ping--> [PKC2-B] --pong--> [matrix]
[matrix] --ping--> [PKC2-C] --pong--> [matrix]

→ 3 つの PongProfile を比較テーブルに表示
```

**UI 概要**:

- **上部**: iframe URL 入力リスト（追加 / 削除ボタン）、各行にステータスインジケータ
- **メイン**: 比較テーブル
  - 行 = capability フィールド (`container_id`, `version`, `record_count`, 各 capability)
  - 列 = PKC2 インスタンス
  - 色分け: 🟢 全一致 / 🟡 一部差異 / 🔴 欠損・非互換
- **サマリ行**: 「3/3 互換」「2/3 が record:offer 対応」等

**実装ノート**:

- 動的 iframe 生成: `document.createElement('iframe')` を非表示（`height:0; width:0`）で配置
- タイムアウト: pong が 5 秒以内に届かなければ「到達不能」マーク
- PongProfile 比較フィールド: `container_id`, `version`, `record_count`, `capabilities`
- 並列 ping: 全 iframe に同時送信、`Promise.allSettled` パターンでレスポンス収集

**SR 依存**: SR-10 (capability negotiation) でより豊富なデータ取得。SR-2 (`correlation_id`) で並列 ping のレスポンスを正確にマッチ。

**優先度**: Tier 3

---

## A4. traffic-recorder（全メッセージキャプチャ → JSON 保存）

**目的**: PKC-Message トラフィックをセッション全体にわたって記録し、
JSON ファイルとしてダウンロードする。A5 replay-player の入力データを生成する。

**メッセージフロー**: パッシブリスナーのみ。ツール自身はメッセージを送信しない。

**UI 概要**:

- **トップバー**: 「Start Recording」/「Stop Recording」トグル、経過時間、メッセージ数
- **メイン**: キャプチャ済みメッセージのライブフィード（1 行 1 メッセージ、コンパクト表示）
- **下部**: 「Download JSON」「Clear」ボタン

**ダウンロードファイル形式**:

```json
[
  {
    "envelope": { "protocol": "pkc-message", ... },
    "event_origin": "http://localhost:...",
    "captured_at": "2026-04-17T10:30:00.123Z"
  },
  ...
]
```

**実装ノート**:

- キャプチャ配列はメモリ内保持（IndexedDB 不要）
- 各エントリ: 完全な envelope + `event.origin` + キャプチャタイムスタンプ
- ダウンロード: `Blob` + `URL.createObjectURL` + 一時 `<a>` クリック
- ファイル名: `pkc-traffic-{ISO date}.json`
- 10,000 エントリ超過時にメモリ警告表示

**SR 依存**: SR-1 (`message_id`) でリプレイが決定的になる。SR-7 (レート制限) はストレステストに関連。

**優先度**: Tier 2

---

## A5. replay-player（キャプチャを順次再送）

**目的**: A4 で記録したトラフィックを PKC2 iframe に再送し、
テスト・リグレッションチェックに使用する。

**メッセージフロー**:

```
[replay-player] A4 の JSON ファイルをロード
[replay-player] --msg[0]--> [PKC2 iframe]
     [PKC2]    --response--> [replay-player]  ← キャプチャ
[replay-player] --msg[1]--> [PKC2 iframe]
     ...
```

**UI 概要**:

- **ファイル入力**: A4 の JSON ファイルをロード
- **タイムライン / スクラバー**: 全メッセージの再生位置表示
- **再生コントロール**: Play / Pause / Step / Speed (0.5x, 1x, 2x, 5x, instant)
- **分割ビュー**: 左 = 送信メッセージ、右 = 受信レスポンス
- **Diff モード**: キャプチャしたレスポンスを元の記録と比較

**実装ノート**:

- `setTimeout` チェーンでメッセージ間ディレイを制御
- `source_id` / `target_id` を現在の iframe コンテキストに合わせて調整
- SR-1 採用時: `message_id` を再生成するか元の ID を使うかのオプション
- Step モード: ボタン 1 クリックで 1 メッセージ進行
- レスポンス比較: JSON deep-equal で差異箇所をハイライト

**SR 依存**: SR-1 (`message_id`) で重複排除。SR-2 (`correlation_id`) でレスポンスマッチ。

**優先度**: Tier 3
