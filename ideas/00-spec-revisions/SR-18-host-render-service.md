# SR-18. ホスト・レンダーサービス（`render-request` / `render-result` / `stylesheet` + capability `core-render`）

> **位置づけ**: ホスト(PKC2)への spec 変更要望。拡張がレンダリングコアを**借りる**ための
> pkc-ext チャネル追加メッセージを要望する。ホスト側の設計正本は
> **PKC2 #849 / `docs/development/extension-render-service-design-2026-06.md`**(merge 済の設計 doc)。
> 確定 wire は PKC2 `docs/spec/pkc-message-api-v2.md` **§3.8(pkc-ext チャネル)**。本 SR は
> 拡張(ビジター)側からの「欲しい形」の表明であり、実装の所有権・着地判断はホストチームにある。

## 背景

F カテゴリ(添付ビューア / リッチエディタ)で「テキスト系 entry を**綺麗に表示・編集**する viewer/editor」を作るとき、PKC-Markdown 互換のレンダリングが要る。素朴な選択肢は **拡張がエンジンを bundle する(複製)** だが、3 つの負債を抱える(PKC2 #849 §2):

1. **drift** — コアの markdown 方言(`:::section{}` callout / `==[red]==` color / `^^em-dot^^` / `[[ruby:]]` / `$math$` / footnote / csv fence …)が進化すると、拡張同梱コピーが取り残されて互換が崩れる。
2. **asset** — 本文の `asset:KEY` 参照はコンテナの `assets` map で解決される。拡張は projection(メタ)と deliver(送られた実体)しか持たないため、未送付アセットは解決できない。
3. **CSS** — HTML 出力を移植できても、視覚は base.css の「3 surface ミラー」(`markdown-render-scope.md`)に依存する。拡張は **4 つめのサーフェス** になり、CSS を別途持ち込まないと見た目が一致しない。

封じ込め 2 層(PKC2 #796/#821)で既定の **Tier S は cross-origin / opaque iframe**。境界を越えられるのは postMessage の structured-clone のみで、**生きた JS モジュール/関数は越えられない**。よって「コアを貸す」の汎用解は **レンダーをサービス化(RPC)** すること(PKC2 #849 §3)。

## 問題

現行 pkc-ext(PKC2#806 rev.2 / §3.8)は host→ext = `projection`(メタ)/ `deliver`(送付実体)、ext→host = `write` / `hint` / `propose` を持つが、**「このソースを描画して」という変換要求の経路が無い**。結果、拡張は綺麗な PKC-Markdown 描画を**複製でしか**得られない。

## 案(§3.8 への additive 追加。`core-render` 宣言拡張のみ有効)

envelope は既存どおり `{ pkc:'pkc-ext', v:1, nonce, t, ... }`。`t` に 3 種を追加:

| t | 方向 | payload | 意味 |
|---|---|---|---|
| `render-request` | ext→host | `{ source: string, opts?: RenderOpts, want_css?: boolean, correlation_id }` | PKC-Markdown ソースの HTML 化要求 |
| `render-result` | host→ext | `{ ok: boolean, html?, css?, engine_version, headings?, reason?, correlation_id }` | 描画結果(失敗は `ok:false`+`reason`) |
| `stylesheet` | host→ext | `{ css: string, engine_version }` | base.css を handshake 直後に 1 回貸す(`want_css` 連発回避) |

```ts
interface RenderOpts {
  surface?: 'reader' | 'preview';   // typographic profile(既定 reader)
  source_line_anchors?: boolean;    // Split View 相当の行アンカー
  strip_dialect?: boolean;          // CommonMark へ降格(ロッシー)
  toc?: boolean;                    // headings 抽出を同梱
}
```

- `correlation_id` **必須**(既存 write / deliver / propose と同じ相関規約)。
- handshake / nonce / window identity は §3.8 と同一 primitive を流用(新 gate を作らない)。
- 失敗は例外を投げず `ok:false` + `reason`(host renderer が throw しても境界を越えさせない)。
- **新 capability `core-render`**(manifest `extension_manifest.capabilities`、未知 capability 無視の forward 互換に乗る)。宣言した拡張のみ render RPC が有効。

## 信頼方向の反転（要明記）

§3.8 のデータ最小化原則は host→ext = projection(メタ)のみで `body`/`assets`/`revisions` を送るな(MUST NOT)。`render-result` が HTML を返すのは**意図的な例外**(PKC2 #849 §5):

- 拡張が render する `source` は**その拡張が既に deliver で受け取った実体**(または自分で生成したテキスト)。host は新規データを開示していない。
- **asset 解決だけは新規開示になりうる** → §6/SR-15 consent と両立(下記)。
- 返す HTML のサニタイズ責務は **host 側**(renderer が信頼境界)。拡張は受け取った HTML を自分の(既に sandboxed な)DOM に inject する。

## Asset 解決と consent の両立（SR-15 / PKC2 #806 と整合）

`source` が `asset:KEY` を含むとき host が resolve すると base64 inline = 新規開示。consent 不変条件を破らないため(PKC2 #849 §6):

- **MUST**: host は **当該拡張へ既に deliver 済みのアセットのみ** resolve(チャネル単位で配送済み asset_key を追跡)。
- 未配送参照は **broken-ref プレースホルダ**(現行ホストの「参照は壊れた状態で残る」挙動と一致)。
- 結果として `render-request` は **pull の抜け道にならない**。

## 拡張側からの希望（PKC2 #849 の未決 D-1〜D-5 への回答）

PKC2 #849 §13 の未決事項に、**ビジター(拡張)側の希望**を添える:

- **D-1(stylesheet push vs pull)**: **handshake 直後 1 回 push を希望**。ライブプレビュー系(F7/F9/F11)は `stylesheet` 1 回 + `render-request` 多数のパターンが自然で、毎回 `want_css` を立てると往復が重い。古い host(stylesheet 非対応)では `want_css:true` 同梱に degrade できれば両対応。
- **D-2(asset 配送済みのみ)**: **本書 MUST(配送済みのみ)で確定を希望**。consent モデルの単純さを優先。緩和案(参照されたら send 扱い+banner)は将来 opt-in で十分。
- **D-3(`core-render` 独立 capability)**: **独立 capability を希望**。起動 tier(T/S)と直交させ、Tier S の thin 拡張でも render だけ借りられるようにしたい(本 SR のプロトタイプ F11 が Tier S 前提)。
- **D-4(mermaid SVG 前倒し)**: **host が render-result 前に inline SVG まで焼く案(#849 推奨)を希望**。境界を越えるのが確定 SVG のみなら拡張は重い mermaid(~3MB)を同梱せずに済む(F7/F9 の bundle 削減に直結)。
- **D-5(着手順)**: features 層 `render(source, ctx)` seam 抽出 → transport 追加 → 実証 viewer の順に **異議なし**。拡張側は本 SR と同時に **実証プロトタイプ F11(premium-markdown-viewer)** を用意し、Tier S での deliver→render-request→借用 CSS のフローを先に可視化しておく(host 実装の go 判断材料)。

## 後方互換

- すべて additive。`core-render` 未宣言 / 旧 host では render RPC は no-op(未知 `t` は破棄、SR-1 前提)。
- 拡張は render-result が来ない場合に**ローカル簡易フォールバック描画へ degrade**できる(F11 で実証)。互換性は壊れない。

## 関連

- ホスト設計正本: **PKC2 #849** / `extension-render-service-design-2026-06.md`
- 確定 wire: PKC2 `docs/spec/pkc-message-api-v2.md` §3.8
- consent: **SR-15**(asset 取得)/ PKC2 #806(host-push 同意モデル)
- 実証: 本 repo **F11 premium-markdown-viewer**(`ideas/F-file-viewers/F11-premium-markdown-viewer.md`)
- 4 surface: PKC2 `markdown-render-scope.md`(拡張 = 第 4 surface、ミラーではなく「貸与」)
