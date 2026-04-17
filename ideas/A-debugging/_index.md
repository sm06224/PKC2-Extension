# A. Debugging / Inspection ツール

PKC-Message プロトコルの開発・検証を支援するツール群。
全カテゴリのツール開発に先立ち、メッセージの送受信を可視化・検証する基盤を提供する。

## 使用する PKC-Message 型

全メッセージ型を対象とする。

```ts
'ping' | 'pong'          // 接続確認・capability 取得
'record:offer' | 'record:accept' | 'record:reject'
'export:request' | 'export:result'
'navigate' | 'custom'
```

## ツール一覧

| # | Name | 一行サマリ | 優先度 |
|---|------|----------|-------|
| A1 | [message-probe](A1-message-probe.md) | ping/pong + 全 envelope ロガー | Tier 1 |
| A2 | [envelope-validator](A2-envelope-validator.md) | JSON 妥当性判定 | Tier 1 |
| A3 | [capability-matrix](A3-capability-matrix.md) | 複数 PKC2 の capabilities 比較 | Tier 3 |
| A4 | [traffic-recorder](A4-traffic-recorder.md) | 全メッセージを JSON 保存 | Tier 2 |
| A5 | [replay-player](A5-replay-player.md) | キャプチャを順次再送 | Tier 3 |
