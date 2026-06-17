# F11. premium-markdown-viewer（ホスト renderer 借用・美麗 Markdown ビューア）★

> **核心**: PKC-Markdown を**複製せず**、ホスト(PKC2)のレンダリングコア + base.css を
> **借りて**綺麗に描画する viewer/editor。`render-request`/`render-result`/`stylesheet`
> + capability `core-render`(**SR-18**)に乗る最初の実証ツール。ホスト設計正本 = **PKC2 #849**。

**目的**: テキスト系 entry(text / textlog / todo の description 等)を、ホスト現行版の PKC-Markdown エンジンで描画し、**借りた CSS の上に独自の上等な CSS を被せて「もっと綺麗」** にする。複製エンジンの 3 負債(drift / asset / CSS、SR-18 背景)を構造的に回避する。

## なぜ複製しないか

| 素朴案(複製) | F11(借用) |
|---|---|
| `markdown-it` + 方言拡張を bundle | エンジンを bundle しない(0KB)。常にホスト現行版で render |
| `asset:KEY` を解決できない | host が配送済みアセットのみ resolve(consent 維持、SR-18 §asset) |
| base.css をミラー(drift する) | `stylesheet` で base.css を**貸与**(単一ソース、drift しない) |

## メッセージフロー（pkc-ext / SR-18）

```
ext → host   hello { capabilities: ['core-render'] }
host → ext   projection                          （索引：text 系 entry を一覧）
host → ext   stylesheet { css, engine_version }   （handshake 直後 1 回、base.css 貸与）
（ユーザーが送付ジェスチャ）
host → ext   deliver { kind:'entry', lid, body }  （描画対象のソース実体）
ext → host   render-request { source, opts, correlation_id }
host → ext   render-result { ok, html, headings, engine_version, correlation_id }
ext          → 借用 CSS + 独自 CSS を当てて表示（sandboxed iframe = 第 4 surface）
```

- 編集系では textarea のソース編集 → debounce → `render-request` でライブプレビュー(Split View 同型)。保存は既存 `write`(`update-body` に raw source)または `propose`(新規)。WYSIWYG 双方向は**非ゴール**(PKC2 #849 §11、ロッシー回避)。

## UI 概要

- **3 ペイン**(エディタ起動時): 左 = アウトライン(`render-result.headings`)/ 中 = ソースエディタ / 右 = 美麗プレビュー。ビューア起動時は 2 ペイン(アウトライン + プレビュー)。
- **テーマ**: 借用 CSS のみ(視覚一致)/ 借用 + premium(タイポgrafi強化・余白・等幅見出し番号など)を切替。これが「premium」の狙い(PKC2 #849 §7)。
- **エンジン版表示**: `render-result.engine_version` を表示し、不一致(将来の複製混在)を可視化。
- **degrade**: `core-render` 未交渉 / 旧 host では **ローカル簡易フォールバック**(CommonMark サブセットの安全 DOM 構築)に落ち、banner で「ホスト描画サービス未提供」を明示。互換は壊さない。

## セキュリティ規律（本 repo 共通 + 本ツール固有）

- **host が返す HTML は sandboxed iframe(`sandbox` / no allow-scripts)の srcdoc に流す**。自分の live DOM へ innerHTML しない(repo 規律 #1 を守りつつ、PKC2 #849 §5 の「host が信頼境界」を**多層防御**で受ける)。
- ローカルフォールバックの描画は **テキストを全てエスケープした安全な subset 変換**(生 HTML はテキスト扱い、リンクは http(s) のみ)。
- 受信で動作を変えない / 外部通信なし / eval なし / 外部リソース読み込みなし。

## 未解決の論点（プロトタイプで可視化する）

1. **asset**: 未配送 `asset:KEY` は broken-ref。F11 は「このアセットを送ってほしい」hint を出し、deliver 後に再 render する導線を持つ(consent を破らず実体を得る唯一の道)。
2. **CSS**: 第 4 surface ゆえ base.css の一部(Viewer popup の inline mirror 相当)で足りるか、center pane 用フル CSS が要るか。プロトタイプで「借りた CSS の不足分」を実測する。
3. **対話要素**: mermaid は host SVG 前倒し(SR-18 D-4)、fold/checkbox は CSS / ローカル JS、状態変更は既存 `write` に載せる(PKC2 #849 §8)。

## 依存

- **SR-18**(`render-request`/`render-result`/`stylesheet` + `core-render`)— ホスト実装 go が前提。**未実装の間はフォールバック描画で standalone 動作**。
- SR-15(asset consent)/ PKC2 #806(host-push)/ PKC2 #796(封じ込め)。

## 配布物

`dist/pkc2-premium-markdown-viewer.html`(単一 HTML、エンジン非同梱で軽量)。

**優先度**: Tier 2(SR-18 実証 + ユーザー重点の「綺麗な描画 / 専門エディタ」の現住所)。
