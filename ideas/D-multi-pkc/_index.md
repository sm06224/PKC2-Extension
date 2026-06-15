# D. Multi-PKC / Bridge ツール

複数の PKC2 インスタンス（iframe）間でメッセージを中継・同期するツール群。

## 共通アーキテクチャ: 親ページ Hub パターン

```
┌──────────────── 親 HTML (ツール) ────────────────┐
│                                                   │
│  message listener       routing logic             │
│       ↓                     ↓                     │
│  ┌────────┐  ┌────────┐  ┌────────┐              │
│  │ PKC2-A │  │ PKC2-B │  │ PKC2-C │  ... (n 台)  │
│  │ iframe │  │ iframe │  │ iframe │              │
│  └────────┘  └────────┘  └────────┘              │
│     ↑↓           ↑↓           ↑↓                  │
│  postMessage  postMessage  postMessage            │
└───────────────────────────────────────────────────┘
```

1. 親 HTML が n 個の `<iframe>` を動的生成
2. 各 iframe の `message` イベントを親がリッスン
3. ルーティングロジックに基づき他の iframe に転送
4. `source_id` / `target_id` を書き換え（proxy 動作）

## ツール一覧

| # | Name | 一行サマリ | 優先度 |
|---|------|----------|-------|
| D1 | [multi-broadcaster](D1-multi-broadcaster.md) | 複数 iframe に同時配信 | Tier 3 |
| D2 | [a-to-b-bridge](D2-a-to-b-bridge.md) | A → B 片方向転送 | Tier 3 |
| D3 | [sync-pair](D3-sync-pair.md) | 2 PKC2 双方向差分同期 | Tier 3 |
| D4 | [mirror](D4-mirror.md) | 全レコード一方向クローン | Tier 3 |
| D5 | [federation-hub](D5-federation-hub.md) | n 台中継ハブ | Tier 3 |
| D6 | [diff-merger](D6-diff-merger.md) | 欠落レコードを選択的 offer | Tier 3 |
| D7 | [remote-collab](D7-remote-collab.md) | **WebRTC でリモート PKC2 の一部に参加**（拡張 = 緩衝地帯） | 設計 |
