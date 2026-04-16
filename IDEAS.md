# PKC2 Extension — Ideas & Spec Revision Proposals

PKC-Message v1 を活用する **単一 HTML ツール** のアイデア集と、
現行仕様で感じた曖昧点に対する **改定案** をまとめる。

---

## 0. 現行 PKC-Message v1 サマリ (既知事実)

| 項目 | 値 |
|---|---|
| `protocol` | 固定 `'pkc-message'` |
| `version` | `1` |
| `type` | `ping` / `pong` / `record:offer` / `record:accept` / `record:reject` / `export:request` / `export:result` / `navigate` / `custom` |
| `source_id` | 送信元 container_id (null = 非 PKC 親) |
| `target_id` | 宛先 container_id (null = broadcast) |
| `payload` | type 依存。`unknown` |
| `timestamp` | ISO 8601 |

- bridge が `ping` → `pong` を自動応答 (pong payload = PongProfile)
- `export:request` は **embedded 時のみ** 受理 (capability guard)
- `record:offer` は PendingOffer として inbox に積まれ、ユーザ操作で `SYS_ACCEPT_OFFER`

---

## 1. 仕様改定案 (Spec Revision Proposals)

現行仕様は Phase 1 型定義段階で、実運用で足りない / 曖昧な箇所が多い。以下は **拡張提案** であり、v1 後方互換を基本とする (未知フィールドは無視するルールを前提)。

### SR-1. `message_id` 必須化 (重複排除 / 追跡)

**問題**: 同じメッセージが再送されたとき、受信側が区別できない。
**案**: envelope に `message_id: string` (UUID v4 推奨) を**必須**追加。受信側は直近 N 件の `message_id` を記憶し、重複を黙って捨てる。

### SR-2. `correlation_id` で request/response を紐付け

**問題**: `export:request` を複数並行で送ると、返ってくる `export:result` がどのリクエストに対応するか分からない。
**案**: 任意フィールド `correlation_id?: string`。response 送信側は受信 envelope の `message_id` を `correlation_id` にセットして返す。

### SR-3. 標準エラー型 `error` を追加

**問題**: ハンドラ失敗時の返信方法が未定義。現在はログに出すだけで送信元に通知されない。
**案**: 新メッセージ型 `error` を追加:
```ts
interface ErrorPayload {
  code: 'INVALID_PAYLOAD' | 'UNSUPPORTED_TYPE' | 'RATE_LIMITED'
      | 'PAYLOAD_TOO_LARGE' | 'INTERNAL' | string;
  message: string;
  details?: unknown;
  /** エラー原因となった envelope の message_id */
  cause_id?: string;
}
```

### SR-4. `record:ack` (受理前の到達確認)

**問題**: `record:offer` 送信後、`record:accept` はユーザ操作まで来ない。到達/保留中/却下の区別がつかない。
**案**: 新メッセージ型 `record:ack` を追加。bridge は offer を pendingOffers に積んだ瞬間に自動送信。`record:accept` はユーザが決めた後。ステートマシン:
  `offer → ack (自動) → accept または reject (手動)`

### SR-5. `navigate` の payload 仕様化

**問題**: 現在はコメントしかない。何を送れば何が起こるか未定義。
**案**:
```ts
interface NavigatePayload {
  /** 画面モード遷移 */
  view?: 'detail' | 'calendar' | 'kanban';
  /** 特定エントリを選択 */
  select_lid?: string;
  /** 編集モードに入るか */
  edit?: boolean;
}
```
`navigate` は embedded 時のみ有効 (親から埋め込み PKC2 を操作する用途)。

### SR-6. `custom` の名前空間付け

**問題**: `custom` は自由すぎて、ベンダー間衝突リスク。
**案**: `custom` envelope の payload 必須フィールド `ns: string` (ex. `'myorg.tool.foo'`) を義務化。受信側は未知 `ns` を黙って捨てる。

### SR-7. サイズ / レート制限の明文化

**問題**: `MAX_PAYLOAD_BYTES = 1MB`, `100 msg/s` は仕様書で言及されているだけでコードに無い。
**案**: `src/adapter/transport/limits.ts` で定数化し、超過時に SR-3 の `error { code: 'PAYLOAD_TOO_LARGE' | 'RATE_LIMITED' }` を返す。

### SR-8. `record:offer` payload を拡張

**問題**: 現在は `title / body / archetype / source_container_id` のみ。tags, relations, assets が送れない。
**案**: 後方互換で次を追加 (全て optional):
```ts
interface RecordOfferPayload {
  title: string;
  body: string;
  archetype?: ArchetypeId;
  source_container_id?: string;
  tags?: string[];
  /** 添付 (base64 data URL または asset hash) */
  assets?: Record<string, string>;
  /** この record に紐付けたい relation hint */
  relation_hints?: Array<{ kind: string; to_title?: string }>;
  /** 受信側で既に存在する場合の衝突方針 */
  on_conflict?: 'reject' | 'append-title' | 'overwrite-as-revision';
}
```

### SR-9. 大ペイロード向け chunking

**問題**: 1MB 超の payload (画像付き records 等) が一切送れない。
**案**: 任意フィールド `chunk?: { id: string; index: number; total: number }`。受信側は `id` ごとに buffer を積み、`total` まで揃ったら 1 メッセージとして処理。

### SR-10. capability negotiation の明示化

**問題**: capability は pong の payload にしか現れない。受信側が送信側の能力を知る手段が pong しかない。
**案**: 新メッセージ型 `capabilities:query` / `capabilities:report` を追加。`report` は push でも pull でも送れる。また `hello` (接続時初回自動送信) で自己紹介を統一。

### SR-11. broadcast / multicast の整理

**問題**: `target_id = null` が broadcast を意味するが、多数の PKC2 が埋め込まれた親で誰が処理したか追えない。
**案**: broadcast 受信時の返信にも `target_id` を明示 (pong / ack はユニキャスト)。親ページが hub として中継するケースを標準動作として README 化。

### SR-12. origin / sandbox 境界の契約化

**問題**: `allowedOrigins` を空にすると全許容という挙動だが、セキュリティ推奨値が不明。
**案**:
- standalone: `allowedOrigins: []` (any) を許容
- embedded: 親ページの origin を `allowedOrigins` にセットすることを推奨
- blob URL iframe の origin は `null` になりがちなので、`blob:` / `data:` / `null` を個別に許容するフラグを追加

---

## 2. 単一 HTML ツールのアイデア (Tool Ideas)

全て「PKC2 HTML を iframe で埋め込み、PKC-Message で通信する」単一 HTML ツール。依存ライブラリ無し・オフライン動作を原則とする。

### A. Debugging / Inspection (開発者向け)

| # | Name | 概要 | 主に使うメッセージ |
|---|---|---|---|
| A1 | **message-probe** | ping 送信 → pong profile 表示。すべての受信 envelope をリアルタイムログ | ping / pong / * |
| A2 | **envelope-validator** | JSON を貼って envelope v1 として妥当性を判定 (ローカル検証) | — |
| A3 | **capability-matrix** | 複数の PKC2 HTML を読込み、version / schema / capabilities を一覧比較 | ping / pong |
| A4 | **traffic-recorder** | embedded PKC2 と親の間の全メッセージをキャプチャ、JSON 保存 | * |
| A5 | **replay-player** | traffic-recorder の JSON を読込み、対象 PKC2 に順次送信 (ユーザ操作の再現) | * |

### B. Record Input — 親ページから PKC2 にデータを流し込む

| # | Name | 概要 | archetype |
|---|---|---|---|
| B1 | **record-offer-composer** | archetype / title / body を選んで単発送信 | any |
| B2 | **todo-quick-sender** | description + 日付入力 → todo JSON body に整形して送信 | todo |
| B3 | **textlog-journaler** | textlog に追記エントリを連続送信 | textlog |
| B4 | **web-clipper** | URL 貼付 → タイトル・本文を抽出 → offer | text |
| B5 | **clipboard-watcher** | クリップボード変化を検知 → 選択で offer | text |
| B6 | **csv-importer** | CSV → 各行を record:offer (一括送信) | 任意 |
| B7 | **markdown-batch** | front-matter 付き Markdown 複数ファイル → 記事ごとに offer | text |
| B8 | **bookmark-importer** | ブラウザの `bookmarks.html` → URL と title を offer | text |
| B9 | **rss-fetcher** | RSS feed を読み込み → エントリを offer | text |
| B10 | **qr-scanner** | カメラで QR 読取 → payload を offer | text |
| B11 | **voice-memo** | Web Speech API で録音 → 文字起こしを textlog offer | textlog |
| B12 | **screenshot-attacher** | 画面キャプチャ / canvas → base64 → attachment offer | attachment |
| B13 | **pomodoro-logger** | 25 分タイマー終了で自動 offer (やったこと入力) | textlog |
| B14 | **daily-log-starter** | 今日の日付をタイトルに textlog を自動生成 | textlog |
| B15 | **form-template** | 事前定義のフォームを描画 → 送信で form archetype offer | form |

### C. Record Output — PKC2 のデータを外に出す

| # | Name | 概要 | 主に使うメッセージ |
|---|---|---|---|
| C1 | **export-downloader** | export:request → 受信した HTML をダウンロード | export:request/result |
| C2 | **container-json-viewer** | export:result を復号して records / relations / revisions をツリー表示 | export |
| C3 | **backup-diff** | 2 つの PKC2 HTML を export → diff 表示 | export |
| C4 | **csv-exporter** | todo だけ抽出して CSV に落とす | export |
| C5 | **printable-summary** | todo/text を印刷向けに整形 | export |
| C6 | **markdown-zipper** | 各 record を `.md` にして ZIP で落とす | export |
| C7 | **tag-cloud** | タグ頻度を可視化 | export |
| C8 | **relation-graph** | relations を力学グラフで可視化 | export |

### D. Multi-PKC / Bridge

| # | Name | 概要 |
|---|---|---|
| D1 | **multi-broadcaster** | 複数の PKC2 iframe に同時に同じ offer を配信 |
| D2 | **a-to-b-bridge** | A で accept された offer を自動的に B へ転送 |
| D3 | **sync-pair** | 2 つの PKC2 を差分同期 (SR-4 の ack が要る) |
| D4 | **mirror** | A の全レコードを B にクローン |
| D5 | **federation-hub** | n 台の PKC2 を中継するメッセージハブ |
| D6 | **diff-merger** | 2 つの export:result を比較 → 欠落レコードを選択的に offer |

### E. 専門ユース

| # | Name | 概要 |
|---|---|---|
| E1 | **reading-list** | URL + 状態を todo として管理 |
| E2 | **expense-tracker** | form archetype で家計簿 |
| E3 | **habit-tracker** | cron 的に todo を繰り返し生成 |
| E4 | **meeting-notes** | テンプレ埋め込みの議事録 |
| E5 | **gratitude-journal** | 毎日プロンプト → textlog |
| E6 | **weekly-review** | 先週の textlog を集めてレビュー offer |
| E7 | **learning-cards** | フラッシュカード学習 → 成績を form で記録 |

---

## 3. 実装優先度 (提案)

最小の価値を最短で出すなら以下の順。

1. **A1 message-probe** — 他の全ツール開発の前提になる基本デバッガ
2. **B1 record-offer-composer** — 最もよく使う「送る」の基本形
3. **B2 todo-quick-sender** — PKC2 の目玉である todo archetype を最速で作れるツール
4. **C1 export-downloader** — embedded モードの export:request を実使用で検証
5. **A3 capability-matrix** — 複数 PKC2 の比較デバッグ

---

## 4. 未解決の設計論点

- **Blob URL iframe の origin**: ブラウザによって `null` / 親 origin / 個別 origin。受信側での origin 判定方針を tool 側でどう扱うか。
- **複数 iframe からの target_id 解決**: 親ページから見てどの iframe が誰か、を安定して判別する ID 発行プロトコル (SR-11 と絡む)。
- **大容量 attachment**: 1MB 制限のもとで画像/PDF をどう扱うか (SR-9 chunking か、IndexedDB 共有か)。
- **PKC2 本体の未実装**: `navigate` ハンドラは本体未実装なので、ツール側で想定しても空振りする。本体 Phase 2 待ちになる機能と、今すぐ使える機能の区別が必要。

---

## 5. 次のアクション (提案)

1. 本 IDEAS.md をレビューいただき、優先順や追加アイデアのフィードバック
2. 仕様改定案のうち、**ツール側だけで試作できるもの** (SR-1 message_id, SR-3 error, SR-4 ack, SR-5 navigate 仕様) を先行検証
3. 合意が取れた順で tool を `tools/NN-name.html` として実装
