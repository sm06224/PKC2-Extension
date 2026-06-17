# PKC2 Extensions — Ideas Index

PKC-Message v1 を活用する **単一 HTML ツール** のアイデアと、現行仕様への改定案を、
カテゴリ別ファイルに分割して管理する。

## 0. 仕様改定案

- [00-spec-revisions/](./ideas/00-spec-revisions/) — SR-1 〜 SR-15（個別ファイルに分割）
  - SR-1: `message_id` 必須化
  - SR-2: `correlation_id` で request/response 紐付け
  - SR-3: 標準 `error` メッセージ型
  - SR-4: `record:ack` (受理前到達確認)
  - SR-5: `navigate` payload 仕様化
  - SR-6: `custom` の名前空間 `ns`
  - SR-7: サイズ / レート制限の明文化
  - SR-8: `record:offer` payload 拡張
  - SR-9: 大ペイロード chunking
  - SR-10: capability negotiation (`hello` / `capabilities:query`)
  - SR-11: broadcast / multicast 整理
  - SR-12: origin / sandbox 境界
  - **SR-13: attachment archetype の body / asset 対応規約** (新規 — F カテゴリ前提)
  - **SR-14: `record:offer` に `mime_type` / `filename` 追加** (新規)
  - **SR-15: 添付ファイル取得用 `asset:request` / `asset:result`** (新規)
  - **SR-16: `data:changed` 通知メッセージ** (新規 — C9 graph-navigator 前提)
  - **SR-17: `selection:changed` 通知メッセージ** (新規 — C9 graph-navigator 前提)
  - **SR-18: ホスト・レンダーサービス** (新規 — `render-request`/`render-result`/`stylesheet` + capability `core-render`。F11 / PKC2 #849 前提)

## 1. ツール一覧 (カテゴリ別)

### A. Debugging / Inspection ([詳細](./ideas/A-debugging/))

| # | Name | 一行サマリ |
|---|---|---|
| A1 | message-probe | ping / pong + 全 envelope ロガー |
| A2 | envelope-validator | JSON を貼って envelope v1 妥当性判定 |
| A3 | capability-matrix | 複数 PKC2 の version / capabilities 比較 |
| A4 | traffic-recorder | 全メッセージをキャプチャして JSON 保存 |
| A5 | replay-player | キャプチャを順次再送 |

### B. Record Input ([詳細](./ideas/B-record-input/))

| # | Name | 一行サマリ | archetype |
|---|---|---|---|
| B1 | record-offer-composer | 単発の汎用 offer フォーム | any |
| B2 | todo-quick-sender | description + 日付の todo 専用入力 | todo |
| B3 | textlog-journaler | textlog 連続追記 | textlog |
| B4 | web-clipper | URL 貼付 → 抽出 → offer | text |
| B5 | clipboard-watcher | クリップボード監視 | text |
| B6 | csv-importer | CSV 一括 offer | 任意 |
| B7 | markdown-batch | front-matter 付き MD バッチ | text |
| B8 | bookmark-importer | bookmarks.html → offer | text |
| B9 | rss-fetcher | RSS → offer | text |
| B10 | qr-scanner | QR 読取 → offer | text |
| B11 | voice-memo | Web Speech → textlog | textlog |
| B12 | screenshot-attacher | 画面キャプチャ → attachment | attachment |
| B13 | pomodoro-logger | タイマー終了で自動 offer | textlog |
| B14 | daily-log-starter | 今日の textlog を自動生成 | textlog |
| B15 | form-template | フォーム → form archetype | form |

### C. Record Output ([詳細](./ideas/C-record-output/))

| # | Name | 一行サマリ |
|---|---|---|
| C1 | export-downloader | export:result を DL |
| C2 | container-json-viewer | container 構造をツリー表示 |
| C3 | backup-diff | 2 PKC2 の diff |
| C4 | csv-exporter | todo を CSV 化 |
| C5 | printable-summary | 印刷向け整形 |
| C6 | markdown-zipper | 各 record を MD ZIP |
| C7 | tag-cloud | タグ頻度可視化 |
| C9 | graph-navigator | relation + folder 階層をグラフ化。embedded(navigate連動) / standalone(旧C8統合) の 2 モード |

### D. Multi-PKC / Bridge ([詳細](./ideas/D-multi-pkc/))

| # | Name | 一行サマリ |
|---|---|---|
| D1 | multi-broadcaster | 複数 iframe に同時配信 |
| D2 | a-to-b-bridge | A の accept を B に転送 |
| D3 | sync-pair | 2 PKC2 の差分同期 |
| D4 | mirror | 全レコードクローン |
| D5 | federation-hub | n 台 PKC2 中継ハブ |
| D6 | diff-merger | 欠落レコードを選択的 offer |

### E. 専門ユース ([詳細](./ideas/E-specialized/))

| # | Name | 一行サマリ |
|---|---|---|
| E1 | reading-list | URL 読書管理 |
| E2 | expense-tracker | form で家計簿 |
| E3 | habit-tracker | cron 的 todo 生成 |
| E4 | meeting-notes | テンプレ議事録 |
| E5 | gratitude-journal | 毎日感謝 textlog |
| E6 | weekly-review | 先週まとめ |
| E7 | learning-cards | フラッシュカード |

### F. オフライン添付ビューア / リッチエディタ (新規) ([詳細](./ideas/F-file-viewers/))

PKC2 の `attachment` archetype に保存された各種ファイルを **オフラインで閲覧・編集** する単一 HTML ツール群。
メモ能力強化のため Mermaid / draw.io 等のダイアグラム編集も含む。

| # | Name | 一行サマリ | 入力形式 |
|---|---|---|---|
| F1 | attachment-browser | PKC2 を開いて添付一覧 → MIME 別ビューアに振分け | * |
| F2 | email-viewer | `.eml` / `.msg` を整形表示 (本文・ヘッダ・添付) | eml/msg |
| F3 | docx-viewer | Word 文書をスタイル保ったまま表示 | docx |
| F4 | pptx-viewer | PowerPoint をスライド単位で表示 | pptx |
| F5 | xlsx-viewer | Excel をシート切替で表示 | xlsx |
| F6 | pdf-viewer | PDF.js 同梱の閲覧 | pdf |
| F7 | mermaid-editor | Mermaid 編集 + ライブプレビュー → text/attachment offer | text/svg |
| F8 | drawio-editor | draw.io XML を読み書きできるエディタ | drawio/xml |
| F9 | markdown-mermaid-note | MD + Mermaid + 図を埋め込めるノートエディタ | text/md |
| F10 | canvas-sketcher | 自由手書きキャンバス → SVG/PNG attachment | svg/png |
| F11 | premium-markdown-viewer | ホスト renderer 借用の美麗 Markdown 描画(エンジン非同梱・SR-18 実証) | text/md |

## 2. 実装優先度 (提案)

### Tier 1 (基盤デバッグ + よく使う送信)

1. **A1 message-probe** — 全ツール開発の前提
2. **B1 record-offer-composer** — 「送る」の基本形
3. **B2 todo-quick-sender** — todo archetype 最速作成

### Tier 2 (実用シナリオ)

4. **F2 email-viewer** — メール添付閲覧 (ユーザー提案の中心)
5. **F7 mermaid-editor** — メモ能力強化
6. **C9 graph-navigator** — relation + folder をグラフで俯瞰して navigate (ユーザー提案)
7. **C1 export-downloader** — embedded export 検証

### Tier 3 (応用)

7. F3 docx-viewer / F4 pptx-viewer / F5 xlsx-viewer
8. A3 capability-matrix
9. F8 drawio-editor

## 3. 次のアクション

1. 本インデックス + 各カテゴリファイルをレビューいただき、優先度や追加案のフィードバック
2. 仕様改定案のうちツール側だけで試作できるもの (SR-1, SR-3, SR-4, SR-5, SR-13, SR-14) を先行検証
3. 合意が取れた順に `tools/NN-name.html` として実装
