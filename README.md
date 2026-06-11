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
| B1 record-offer-composer | #23 | `dist/pkc2-offer-composer.html` | 任意 archetype の record:offer を組み立てて送信。live envelope プレビュー、todo body 自動 JSON 化、v1.1 capture フィールド、ドラフト自動保存、correlation_id で ack/accept/reject を相関表示(PKC2#804) |
| B2 todo-quick-sender | #24 | `dist/pkc2-todo-quick.html` | キーボードファーストの todo 専用送信。Enter で即 offer、送信後フォーカス復帰、オファー状況の相関表示(PKC2#804) |
| C1 export-downloader | #38 | `dist/pkc2-export-downloader.html` | embedded ホストに export:request し、export:result の HTML をそのままファイル保存(描画・解析しない) |
| F7 mermaid-editor | #65 | `dist/pkc2-mermaid-editor.html` | Mermaid ライブ編集(テンプレ・テーマ・SVG/PNG 保存)。ソースを ```mermaid fence の text entry として offer(mermaid 同梱 ~3MB・オフライン) |

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
