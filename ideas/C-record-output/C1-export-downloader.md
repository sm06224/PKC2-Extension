# C1. export-downloader（export:result を DL）

**目的**: PKC2 から container JSON を取得しファイルとしてダウンロード。

**UI 概要**:

- 「Request Export」ボタン + ローディング
- 受信時: ファイルサイズ、レコード数、container_id 表示
- 「Download JSON」/「Download Minified」

**実装ノート**:

- `Blob` + `URL.createObjectURL` + `<a>` click
- ファイル名: `pkc2-export-{container_id}-{date}.json`
- タイムアウト 30 秒

**SR 依存**: SR-2, SR-3 | **優先度**: Tier 2
