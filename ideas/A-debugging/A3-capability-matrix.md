# A3. capability-matrix（複数 PKC2 の version/capabilities 比較）

**目的**: 複数の PKC2 インスタンスに ping を送り、PongProfile を並べて比較する。

**メッセージフロー**:

```
[matrix] --ping--> [PKC2-A] --pong--> [matrix]
[matrix] --ping--> [PKC2-B] --pong--> [matrix]
→ 比較テーブルに表示
```

**UI 概要**:

- 上部: iframe URL 入力リスト（追加/削除）、各行にステータスインジケータ
- メイン: 比較テーブル（行=capability, 列=PKC2 インスタンス）
- 色分け: 🟢全一致 / 🟡一部差異 / 🔴欠損
- サマリ行: 「3/3 互換」等

**実装ノート**:

- 動的 iframe 生成（`height:0; width:0` で非表示）
- タイムアウト: 5 秒で「到達不能」
- 並列 ping → `Promise.allSettled` でレスポンス収集

**SR 依存**: SR-10, SR-2

**優先度**: Tier 3
