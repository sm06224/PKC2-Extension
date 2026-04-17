# A5. replay-player（キャプチャを順次再送）

**目的**: A4 で記録したトラフィックを PKC2 iframe に再送し、テスト・リグレッションチェックに使用する。

**メッセージフロー**:

```
[replay-player] A4 の JSON ファイルをロード
[replay-player] --msg[0]--> [PKC2 iframe]
     [PKC2]    --response--> [player]
[replay-player] --msg[1]--> ...
```

**UI 概要**:

- ファイル入力: A4 の JSON ファイルをロード
- タイムライン / スクラバー
- 再生コントロール: Play / Pause / Step / Speed (0.5x〜instant)
- 分割ビュー: 左=送信、右=受信レスポンス
- Diff モード: レスポンスを元の記録と比較

**実装ノート**:

- `setTimeout` チェーンでメッセージ間ディレイ制御
- `source_id`/`target_id` を現 iframe コンテキストに調整
- Step モード: ボタン 1 クリック = 1 メッセージ進行
- レスポンス比較: JSON deep-equal で差異ハイライト

**SR 依存**: SR-1 (重複排除)、SR-2 (レスポンスマッチ)

**優先度**: Tier 3
