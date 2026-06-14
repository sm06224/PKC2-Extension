# PKC2 Extensions

PKC2 の **PKC-Message** プロトコル (`pkc-message` v1) を使う **単一 HTML ツール集**。

各ツールは PKC2 HTML ファイル (`pkc2.html`) を iframe に埋め込む、または PKC2 の extension launcher から起動され(`window.opener` 経由)、`postMessage` で `record:offer` / `export:request` / `ping` などのメッセージをやり取りする。

また、PKC2 に添付されたファイル(メール / Word / PowerPoint / 画像 / 図など)を **オフラインで閲覧・編集** するためのビューア / エディタ群も対象とする。

## Status

**Phase 1 — Implementation** 中。計画の live tracking は **GitHub Issues が正本**(全体マップは issue #69)。`IDEAS.md` + `ideas/` は詳細仕様のアーカイブとして保持する。

## ツール一覧

| ツール | issue | 配布物 | 概要 |
|---|---|---|---|
| A1 message-probe | #18 | `dist/pkc2-message-probe.html` | ping/pong + 全 envelope ロガー。record:offer / export:request / navigate / custom / raw envelope の送信テスト。launcher 起動・iframe 埋め込み両対応 |
| A2 envelope-validator | #19 | `dist/pkc2-envelope-validator.html` | envelope JSON を貼って spec §4.2 と同順で判定 + type 別 payload 検査(完全オフライン) |
| A3 capability-matrix | #20 | `dist/pkc2-capability-matrix.html` | 複数 PKC2 を iframe で並べ、PongProfile(version / capabilities)を比較表に |
| A4 traffic-recorder | #21 | `dist/pkc2-traffic-recorder.html` | window に届く全メッセージ + 自分の送信を記録して JSON 保存(A5 用) |
| A5 replay-player | #22 | `dist/pkc2-replay-player.html` | A4 / A1 のキャプチャを接続中 host へ順次再送(間隔調整・in/foreign は opt-in) |
| B1 record-offer-composer | #23 | `dist/pkc2-offer-composer.html` | 任意 archetype の record:offer を組み立てて送信。live envelope プレビュー、todo body 自動 JSON 化、v1.1 capture フィールド、ドラフト自動保存、correlation_id で ack/accept/reject を相関表示(PKC2#804) |
| B2 todo-quick-sender | #24 | `dist/pkc2-todo-quick.html` | キーボードファーストの todo 専用送信。Enter で即 offer、送信後フォーカス復帰、オファー状況の相関表示(PKC2#804) |
| B3 textlog-journaler | #25 | `dist/pkc2-textlog-journaler.html` | ローカルに連続追記(localStorage 保持)→ まとめて 1 つの textlog として offer |
| B4 web-clipper | #26 | `dist/pkc2-web-clipper.html` | コピーしたページを貼り付け → HTML を inert 抽出して text offer(title 自動、source_url 付き)。URL fetch は CORS のため非対応(ペーストモード) |
| B6 csv-importer | #28 | `dist/pkc2-csv-importer.html` | CSV(ヘッダ行 + 列マッピング)を 1 行 = 1 offer で間隔送信(上限 200 行・停止可) |
| B7 markdown-batch | #29 | `dist/pkc2-markdown-batch.html` | 複数 .md を 1 ファイル = 1 offer で送信(front-matter の title/archetype/source_url 解釈) |
| B8 bookmark-importer | #30 | `dist/pkc2-bookmark-importer.html` | bookmarks.html をフォルダ階層付きで text offer 化(http(s) のみ・上限 200) |
| B9 rss-fetcher | #31 | `dist/pkc2-rss-fetcher.html` | RSS 2.0 / Atom XML を貼り付け / ファイルで読み込み、選択記事を 1 件 = 1 offer で間隔送信(description は inert テキスト化、link は http(s) のみ) |
| B15 form-template | #37 | `dist/pkc2-form-template.html` | form archetype(name/note/checked 固定 3 フィールド)をテンプレから offer |
| B13 pomodoro-logger | #35 | `dist/pkc2-pomodoro-logger.html` | 集中タイマー完了で textlog を自動 offer(時間帯・ラベル付き) |
| B14 daily-log-starter | #36 | `dist/pkc2-daily-log-starter.html` | テンプレから今日の textlog をワンクリック offer |
| C1 export-downloader | #38 | `dist/pkc2-export-downloader.html` | embedded ホストに export:request し、export:result の HTML をそのままファイル保存(描画・解析しない) |
| D1 multi-broadcaster | #46 | `dist/pkc2-multi-broadcaster.html` | 複数 PKC2 を iframe スロットで並べ、同一レコードを一斉 record:offer。スロット別に ack/accept/reject を相関表示(PKC2#804) |
| D2 a-to-b-bridge | #47 | `dist/pkc2-a-to-b-bridge.html` | 承認パイプライン: 本ツール発の offer が A で accept されたら同一 payload を B へ自動転送(record:accept の correlation echo 検知、保留/再開可) |
| E1 reading-list | #52 | `dist/pkc2-reading-list.html` | URL 読書管理(積読/読書中/読了)+ 項目ごとに source_url 付き offer |
| E2 expense-tracker | #53 | `dist/pkc2-expense-tracker.html` | 記帳 → 「¥金額 内容 #カテゴリ」の textlog offer(form 固定 3 フィールドのため方針変更) |
| E3 habit-tracker | #54 | `dist/pkc2-habit-tracker.html` | 習慣リスト → 今日の期日付き todo 群を一括生成 |
| E4 meeting-notes | #55 | `dist/pkc2-meeting-notes.html` | 議事録テンプレ(日時/参加者/KPT 構成)→ text offer |
| E5 gratitude-journal | #56 | `dist/pkc2-gratitude-journal.html` | 今日の感謝 3 つ → textlog offer |
| E6 weekly-review | #57 | `dist/pkc2-weekly-review.html` | ISO 週番号タイトルの KPT レビュー → text offer |
| E7 learning-cards | #58 | `dist/pkc2-learning-cards.html` | フラッシュカード作成・学習・デッキの text offer(往復書式) |
| G1 filer-pro | #105 | `dist/pkc2-filer-pro.html` | ファイラ作り直し(左ツリー + 右一覧)。検索/ソート/フィルタ + **D&D フォルダ移動**(write op)+ 関連付け + PKC2 と選択同期。閲覧・整理特化(rename/archive/create は #110 待ち) |
| G2 kanban-pro | #106 | `dist/pkc2-kanban-pro.html` | todo の open/done Kanban。D&D で完了/未完了を切替(`set-todo-status` write op、本文保全)。archived 除外・期日 past due 強調(PKC2#831/#832 の R1/R2 を使用) |
| F1 attachment-browser | #59 | `dist/pkc2-attachment-browser.html` | 全添付のメタデータ索引(検索/ソート/MIME アイコン)+ 推奨ビューア振分け。画像・テキストは内蔵プレビュー、実体は送付ジェスチャで受信(host-push) |
| F2 email-viewer | #60 | `dist/pkc2-email-viewer.html` | .eml を依存ゼロ MIME パーサで整形表示(本文/全ヘッダ/添付保存)。HTML メールは inert テキスト抽出。standalone + T1 受動受信 |
| F3 docx-viewer | #61 | `dist/pkc2-docx-viewer.html` | .docx を依存ゼロで構造表示(見出し/段落/箇条書き/表、削除履歴は除外)。mammoth 不採用(HTML 描画規律)。standalone + T1 受動受信 |
| F4 pptx-viewer | #62 | `dist/pkc2-pptx-viewer.html` | .pptx を依存ゼロでスライド別テキストアウトライン表示(タイトル/本文/表)。standalone + T1 受動受信 |
| F5 xlsx-viewer | #63 | `dist/pkc2-xlsx-viewer.html` | .xlsx を依存ゼロ(ZIP=DecompressionStream + XML=DOMParser)でシート切替表示・CSV 保存。SheetJS 不採用(npm 版に既知 CVE)。standalone + T1 受動受信 |
| F6 pdf-viewer | #64 | `dist/pkc2-pdf-viewer.html` | pdf.js 同梱のオフライン PDF ビューア。standalone(ファイル/ドラッグ&ドロップ)+ T1 受動受信(projection 索引 → 送付ジェスチャで表示、PKC2#806)~1.6MB |
| F7 mermaid-editor | #65 | `dist/pkc2-mermaid-editor.html` | Mermaid ライブ編集(テンプレ・テーマ・SVG/PNG 保存)。ソースを ```mermaid fence の text entry として offer(mermaid 同梱 ~3MB・オフライン) |
| F8 drawio-editor | #66 | `dist/pkc2-drawio-editor.html` | .drawio の XML ソース編集 + 簡易 SVG プレビュー(圧縮保存形式も展開)。保存は非圧縮 mxfile。standalone + T1 受動受信 |
| F9 md-note | #67 | `dist/pkc2-md-note.html` | Markdown + Mermaid の 3 ペインノート(アウトライン/エディタ/プレビュー)。自作ミニパーサ(生 HTML はテキスト扱い・リンクは http(s) のみ)、本文を text offer(mermaid 同梱 ~3MB) |
| F10 canvas-sketcher | #68 | `dist/pkc2-canvas-sketcher.html` | 手書きキャンバス(筆圧/undo/redo/消しゴム)→ SVG/PNG ローカル保存。v1 では attachment offer 不可のため standalone 専用(壁 #80) |

### 使い方(A1 message-probe)

1. **standalone**: `dist/pkc2-message-probe.html` を `pkc2.html` と同じ場所に置いて開き、「PKC2 を iframe で読み込む」→ embedded ホストには `export:request` も通る
2. **launcher 起動**: PKC2 に attachment として取り込み「PKC-Extension として扱う」を ON にして開くと `window.opener` 経由で接続(standalone ホストなので `export:request` の capability reject が観測できる)

## 開発

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run build         # 全ツールの単一 HTML を dist/ に生成
npm run build:a1      # A1 のみ
```

**コミット前**: `npm test` + `npm run build` を実行して `dist/` を更新し、`gitleaks git --no-banner .` を通すこと。

### ビルドの仕組み

PKC2 公認グラフ拡張(`PKC2-Extensions/graph`)と同じレシピ:

- Vite **lib mode + classic IIFE**(`type="module"` は launcher の `document.write` 注入で Firefox で実行されないため不可)
- `build/singlefile.mjs <tool>` が CSS を `<style>`、JS を classic `<script>` にインライン化して `dist/` へ出力(`</script>` はエスケープ)
- 各ツールの出力名・タイトルは `tools/<name>/tool.config.json`

### リポジトリ構成

```
ideas/            file ベース計画のアーカイブ(live tracking は Issues)
tools/<name>/     ツールごとのソース(vite.config.ts + tool.config.json + src/)
tests/<name>/     vitest(+ happy-dom)テスト
build/            共有ビルドスクリプト(singlefile.mjs)
dist/             配布物(単一 HTML、コミットする)
```

## セキュリティ規律(全ツール共通)

1. **runtime データの描画は textContent のみ** — innerHTML 禁止(postMessage で届く payload は信頼しない)
2. **postMessage の targetOrigin は期待 origin に pin** — `'*'` は opaque origin(file:// の "null")のみ。受信は `event.source` の同一性 + origin の両方で判定
3. **受信メッセージで動作を変えない**(表示専用。pong profile の文字列パースのみ例外)
4. **ログ・バッファは容量上限**(message flood への耐性)。localStorage には UI 設定のみ保存(メッセージ内容は保存しない)
5. **外部通信なし・eval なし・外部リソース読み込みなし**
6. 毎 PR で `gitleaks` + 上記観点の自己監査

## 参照仕様 (PKC2 本体)

- `docs/spec/pkc-message-api-v1.md` — **PKC-Message v1 の canonical spec**(envelope / 9 type / capability / boundary)
- `PKC2-Extensions/graph/` — 公認グラフ拡張(launcher 経路・単一 HTML ビルドのリファレンス実装)
- `src/adapter/transport/` — bridge / envelope / profile / handler 実装

> PKC2 本体リポジトリは **このリポジトリでは変更しない**。仕様改定案は本リポジトリの SR issues(#1〜#17)で管理し、必然性が実証されたものだけ PKC2 へ issue 起票する。
