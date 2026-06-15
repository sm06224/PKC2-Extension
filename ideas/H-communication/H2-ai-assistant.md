# H2. ai-assistant（AI チャット連携）— 設計 doc

**issue**: #109 ／ **トラッキング**: #110 ／ **状態**: 設計合意 → v1 実装

**目的**: PKC2 の隣で動く AI チャット。会話ログを PKC2 に保存（textlog）し、PKC2 の
エントリを**ユーザーの送付ジェスチャでのみ**文脈として渡す（host-push の同意モデルを
そのまま AI 文脈にも適用 — 勝手に読まない）。

---

## 1. 最大の論点: 「外部通信なし」規律との整合

本リポジトリの全 40 ツールは**外部通信ゼロ**で来た。AI 連携は初の例外になり得る。
ユーザー判断（2026-06-15）で **方式 A（外部 API）も含める**ことを決定。よって v1 は
A/B/C を 1 つのツールで切替可能にし、**外部送信は明示 opt-in・送信内容を可視化**する。

| 方式 | 通信 | v1 実装 |
|---|---|---|
| **A) 外部 API**（OpenAI 互換 / BYO key） | 外部 | ◯ opt-in。endpoint + model + key をユーザーが入力。外部 URL は警告表示。 |
| **B) localhost LLM**（ollama / LM Studio） | ローカルのみ | ◯ 既定候補。A と同一コード（OpenAI 互換エンドポイント）、URL が localhost なだけ。 |
| **C) クリップボード手動ブリッジ** | ゼロ | ◯ fallback。プロンプトをコピー → 外部 AI → 応答を貼り付け。 |

### 通信モデルの単純化
A と B は **OpenAI 互換 Chat Completions**（`POST {endpoint}` に `{model, messages:[{role,content}]}`、
応答 `choices[0].message.content`）で同一コードに収斂する。ollama / LM Studio はいずれも
OpenAI 互換エンドポイント（`/v1/chat/completions`）を持つ。差は **endpoint URL と key の有無**だけ。
- プリセット: ollama `http://localhost:11434/v1/chat/completions` ／ LM Studio `http://localhost:1234/v1/chat/completions` ／ OpenAI `https://api.openai.com/v1/chat/completions`。
- Anthropic ネイティブ（`/v1/messages`・`x-api-key`・body 形が異なる）は v1 では非対応（OpenAI 互換 proxy 経由なら可）。将来 adapter 追加余地。

### セキュリティ規律（実装 MUST）
1. **API キーは localStorage に置かない**。in-memory（セッション中のみ）。リロードで消える。endpoint/model などの非機密設定だけ localStorage 可。
2. **外部送信は明示 opt-in**。既定は「未設定」。外部 URL を入れたら赤系の警告（「このプロンプトと添付文脈が外部 `<host>` に送信されます」）を常時表示。
3. **送信内容の可視化**: 送信前に「何が送られるか（system 文脈に含む entry 一覧 + 直近の会話 + 入力）」を確認できる UI。
4. **Tier S sandbox は fetch を遮断しない**（`allow-scripts`）。「sandbox だから安全」とは言えない。よって通信開示は**拡張側 UI の責務**として実装し、加えて PKC2 manifest 側の通信開示の仕組みを #830 系で協議（下記 §6）。
5. **AI 応答は外部由来の untrusted データ**。描画は `textContent` のみ（`innerHTML` 禁止）。markdown レンダリングはしない（生テキスト表示）。
6. キー入力は `type=password`、ログ・propose 本文・status にキーを出さない。

---

## 2. 文脈注入の同意モデル

- 文脈として渡せるのは**ユーザーが送付ジェスチャ（`deliver`）で渡した entry の本文だけ**。projection には本文が来ないので、勝手に全文を読むことは構造的に不可能。
- 受け取った entry は「文脈候補」リストに入り、各々 include トグルで会話に注入するか選ぶ。
- **会話ごとにリセット**（「新しい会話」で文脈 include 状態と履歴をクリア）。
- system プロンプトに含めるのは include した entry の `title` + `body`（テキスト系のみ。asset/base64 は注入しない）。

---

## 3. 会話ログの保存形式

- 保存は **R5 `propose`**（H1 と同じ wire）で textlog として PKC2 へ。ユーザー同意 banner で accept されて初めて mint。
- textlog body 互換（`{entries:[{id,text,createdAt,flags}]}`）。各ターンを 1 entry にし、`text` を `[user] …` / `[ai] …` の話者プレフィックス付きにする。flags に `ai-chat`。
- タイトルは「AI チャット YYYY-MM-DD(曜) HH:MM」。

---

## 4. サイズと body cap

- record:offer / propose の body cap は **262,144 UTF-16 code units**（spec §9.3、`BODY_SIZE_CAP_UTF16_UNITS`）。
- 保存時に直列化後の body 長を測り、cap 超過なら propose せず警告（古い会話を間引く / 分割は v1 ではしない）。
- 送信プロンプトのサイズはプロバイダ依存。文脈 entry を多数 include すると外部送信量が増えるため、include 件数と概算文字数を表示。

---

## 5. v1 スコープ

- プロバイダ: `none`（既定）/ `http`（A=外部・B=localhost 共通）/ `clipboard`（C）。
- http: endpoint プリセット + 任意 URL、model、API キー（in-memory）、外部警告、送信内容プレビュー、エラー表示。
- clipboard: プロンプトをコピー → 応答貼り付け欄。
- 文脈: deliver で受けた entry を候補化 + include トグル + 会話リセット。
- 保存: 会話を textlog として propose。
- 受信描画は textContent のみ。

### v1 で**やらない**
- ストリーミング応答（一括受信のみ）。
- Anthropic ネイティブ API。
- 自動文脈選択（常に手動 include）。
- 添付（画像等）の AI 送信。

---

## 6. PKC2 への協議事項（方式 A の通信開示）

方式 A は拡張が外部へ fetch する初例。Tier S は fetch を止めないため、**PKC2 manifest に
「この拡張は外部通信する」開示フィールド**を設け、起動時に host がユーザーへ提示できると
ガバナンス上望ましい（拡張側 UI の自己申告に加えた二重化）。これは pkc-ext の新規論点として
#830 系で起票・協議する（拡張ツール自体は manifest 変更なしでも動作するため、ブロッカーではない）。

---

## 7. 依存

- pkc-ext: `deliver`（文脈受信）/ `propose`（R5、会話保存）/ `projection`（接続確認）。
- shared: `ext-channel`（propose 済み）/ `textlog-body` / `envelope`（cap・cid）/ `ui` / `help`。
