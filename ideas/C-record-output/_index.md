# C. Record Output ツール

PKC2 から `export:request` / `export:result` でデータを取得し、
可視化・変換・エクスポートするツール群。

## 使用する PKC-Message 型

```ts
'export:request'   // container 全体を要求
'export:result'    // container JSON が返る
'asset:request'    // SR-15: 特定 asset のみ要求
'asset:result'     // SR-15: asset データが返る
```

## ツール一覧

| # | Name | 一行サマリ | 優先度 |
|---|------|----------|-------|
| C1 | [export-downloader](C1-export-downloader.md) | export:result を DL | Tier 2 |
| C2 | [container-json-viewer](C2-container-json-viewer.md) | container 構造をツリー表示 | Tier 3 |
| C3 | [backup-diff](C3-backup-diff.md) | 2 PKC2 の diff | Tier 3 |
| C4 | [csv-exporter](C4-csv-exporter.md) | todo を CSV 化 | Tier 2 |
| C5 | [printable-summary](C5-printable-summary.md) | 印刷向け整形 | Tier 3 |
| C6 | [markdown-zipper](C6-markdown-zipper.md) | 各 record を MD ZIP | Tier 3 |
| C7 | [tag-cloud](C7-tag-cloud.md) | タグ頻度可視化 | Tier 3 |
| C8 | [relation-graph](C8-relation-graph.md) | relations をグラフ表示（standalone 可視化） | Tier 3 |
| C9 | [graph-navigator](C9-graph-navigator.md) | relation + folder 階層の対話グラフ → 親 PKC2 の center pane に navigate | **Tier 2** ★ |
