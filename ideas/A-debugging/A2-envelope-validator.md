# A2. envelope-validator（JSON 貼付け → envelope v1 妥当性判定）

**目的**: 手動作成した JSON が PKC-Message v1 envelope として妥当かチェックする。
学習・デバッグ用途。

**メッセージフロー**: postMessage 不使用。ローカル検証ロジックのみ。

**UI 概要**:

- 入力エリア: monospace テキストエリア（JSON 貼付け用）
- 「Validate」ボタン
- 結果パネル: フィールド別チェックリスト
  - `protocol` → ✅ `'pkc-message'` / ❌ 値不正
  - `version` → ✅ `1` / ❌ 値不正
  - `type` → ✅ 許可リスト内 / ❌ 未知の型
  - `source_id` → ✅ string | null / ❌ 型不正
  - `target_id` → ✅ string | null / ❌ 型不正
  - `payload` → ✅ 存在 / ⚠️ undefined
  - `timestamp` → ✅ 有効な ISO 8601 / ❌ パース不可
- 「Fix & Copy」ボタン: 修正可能な問題を自動修正してクリップボードにコピー

**実装ノート**:

- `JSON.parse` の try/catch で構文エラー捕捉。エラー位置を表示
- 型チェック: `typeof` + 許可値リスト
- ISO 8601 検証: `new Date(timestamp)` + 正規表現で形式チェック
- SR-1 採用時は `message_id` の UUID 形式チェックも追加

**SR 依存**: SR-1, SR-3, SR-8 — いずれも任意。存在すれば検証対象に含める

**優先度**: Tier 1
