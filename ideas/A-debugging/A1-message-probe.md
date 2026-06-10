# A1. message-probe（ping/pong + 全 envelope ロガー）

**目的**: PKC2 iframe との接続確認と、流れる全メッセージのリアルタイム監視。
全ツール開発のデバッグ基盤として最初に実装する。

**メッセージフロー**:

```
[message-probe]  --ping-->  [PKC2 iframe]
[PKC2 iframe]    --pong-->  [message-probe]   ← PongProfile 表示

   + パッシブリスナーが全 envelope を傍受してログ表示
```

**UI 概要**:

- トップバー: 「Send Ping」ボタン、接続ステータスインジケータ（●緑 / ●赤）
- 左パネル: PongProfile 表示（container_id, version, record_count, capabilities）
- 右パネル: スクロール可能なメッセージログテーブル（timestamp, type, source_id, target_id, payload 折りたたみ JSON ツリー）
- 下部: フィルタ（type 別チェックボックス、payload 内テキスト検索）
- 操作: 「Copy All」「Clear」ボタン

**実装ノート**:

- `window.addEventListener('message', ...)` で全メッセージをキャプチャ
- `event.data?.protocol === 'pkc-message'` でフィルタ表示。非 PKC メッセージも表示するオプションあり
- タイムスタンプ: `Intl.DateTimeFormat` でロケール対応
- payload: 再帰的 DOM ビルダーで折りたたみ JSON ツリー（外部ライブラリ不要）
- フィルタ設定: `localStorage` に永続化

**SR 依存**: SR-1 (message_id でログ相関)、SR-10 (capability negotiation で pong 充実)

**優先度**: Tier 1（最優先）
