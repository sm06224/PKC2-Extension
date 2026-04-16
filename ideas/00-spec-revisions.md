# PKC-Message 仕様改定案 (Spec Revision Proposals)

現行 v1 は Phase 1 型定義段階。実運用で不足する点への拡張提案。
v1 後方互換を基本とする（未知フィールドは無視するルールを前提）。

---

## 現行 PKC-Message v1 サマリ

```ts
interface MessageEnvelope {
  protocol: 'pkc-message';  // 固定
  version: 1;
  type: MessageType;
  source_id: string | null;  // null = 非PKC親
  target_id: string | null;  // null = broadcast
  payload: unknown;
  timestamp: string;         // ISO 8601
}

type MessageType =
  | 'ping' | 'pong'
  | 'record:offer' | 'record:accept' | 'record:reject'
  | 'export:request' | 'export:result'
  | 'navigate' | 'custom';
```

---

## SR-1. `message_id` 必須化（重複排除・追跡）

**問題**: 再送時に受信側が重複を判別できない。

**案**: envelope に `message_id: string`（UUID v4 推奨）を必須追加。
受信側は直近 N 件の `message_id` を記憶し、重複を黙って破棄する。

```ts
interface MessageEnvelope {
  // ...既存フィールド...
  message_id: string; // NEW: 必須
}
```

---

## SR-2. `correlation_id` で request/response を紐付け

**問題**: `export:request` を複数並行送信すると、返ってくる `export:result` がどのリクエストに対応するか不明。

**案**: 任意フィールド `correlation_id?: string`。
response 送信側は受信 envelope の `message_id` を `correlation_id` にセットして返す。

---

## SR-3. 標準エラー型 `error` を追加

**問題**: ハンドラ失敗時の返信方法が未定義。現在は `console.warn` のみで送信元に通知されない。

**案**: 新メッセージ型 `error` を追加:

```ts
type MessageType = ... | 'error'; // NEW

interface ErrorPayload {
  code:
    | 'INVALID_PAYLOAD'
    | 'UNSUPPORTED_TYPE'
    | 'RATE_LIMITED'
    | 'PAYLOAD_TOO_LARGE'
    | 'INTERNAL'
    | string;
  message: string;
  details?: unknown;
  cause_id?: string; // エラー原因となった envelope の message_id
}
```

---

## SR-4. `record:ack`（受理前の到達確認）

**問題**: `record:offer` 送信後、`record:accept` はユーザ操作まで届かない。
到達 / 保留中 / 却下の区別がつかない。

**案**: 新メッセージ型 `record:ack` を追加。
brigde は offer を pendingOffers に積んだ瞬間に自動送信する。

ステートマシン:
```
record:offer
  → record:ack (bridge が自動送信)
  → record:accept または record:reject (ユーザ操作後)
```

---

## SR-5. `navigate` の payload 仕様化

**問題**: 現在はコメントしかない。何を送れば何が起こるか未定義。

**案**:

```ts
interface NavigatePayload {
  view?: 'detail' | 'calendar' | 'kanban'; // 画面モード遷移
  select_lid?: string;                      // 特定エントリを選択
  edit?: boolean;                           // 編集モードに入るか
}
```

`navigate` は embedded 時のみ有効（親から埋め込み PKC2 を操作する用途）。

---

## SR-6. `custom` の名前空間付け

**問題**: `custom` は自由すぎてベンダー間衝突リスクがある。

**案**: `custom` envelope の payload 必須フィールド `ns: string` を義務化。
例: `'myorg.tool.foo'`。受信側は未知 `ns` を黙って破棄する。

---

## SR-7. サイズ / レート制限の明文化

**問題**: `MAX_PAYLOAD_BYTES = 1MB`, `100 msg/s` は仕様書に記載されているだけでコードに存在しない。

**案**: `src/adapter/transport/limits.ts` で定数化し、超過時に SR-3 の `error` を返す。

```ts
export const MAX_PAYLOAD_BYTES = 1_048_576; // 1MB
export const MAX_MESSAGES_PER_SECOND = 100;
```

---

## SR-8. `record:offer` payload を拡張

**問題**: 現在は `title / body / archetype / source_container_id` のみ。
tags, relations, assets が送れない。

**案**: 後方互換で次を追加（全て optional）:

```ts
interface RecordOfferPayload {
  title: string;
  body: string;
  archetype?: ArchetypeId;
  source_container_id?: string;
  // NEW optional fields:
  tags?: string[];
  assets?: Record<string, string>;  // base64 data URL または asset hash
  relation_hints?: Array<{ kind: string; to_title?: string }>;
  on_conflict?: 'reject' | 'append-title' | 'overwrite-as-revision';
  // SR-14 で追加:
  mime_type?: string;
  filename?: string;
}
```

---

## SR-9. 大ペイロード向け chunking

**問題**: 1MB 超の payload（画像付き records 等）が一切送れない。

**案**: 任意フィールド `chunk?` を追加。受信側は `id` ごとに buffer を積み、
`total` まで揃ったら 1 メッセージとして処理する。

```ts
interface ChunkInfo {
  id: string;     // チャンクセッション ID
  index: number;  // 0-based
  total: number;  // 総チャンク数
}

interface MessageEnvelope {
  // ...既存フィールド...
  chunk?: ChunkInfo; // NEW: optional
}
```

---

## SR-10. capability negotiation の明示化

**問題**: capability は pong の payload にしか現れない。
受信側が送信側の能力を知る手段が ping/pong だけ。

**案**: 新メッセージ型を追加:

```ts
type MessageType = ... | 'hello' | 'capabilities:query' | 'capabilities:report';
```

- `hello`: 接続時に自動送信する自己紹介。pong と同じ PongProfile を payload に持つ
- `capabilities:query`: 相手の capabilities を問い合わせる
- `capabilities:report`: query への応答、または push 通知

---

## SR-11. broadcast / multicast の整理

**問題**: `target_id = null` が broadcast を意味するが、
複数 PKC2 が埋め込まれた親ページで誰が処理したか追えない。

**案**:
- broadcast 受信時の返信には必ず `target_id` を明示（pong / ack はユニキャスト）
- 親ページが hub として中継するケースを標準動作として文書化
- `source_id` の重複検出で二重処理を防ぐ

---

## SR-12. origin / sandbox 境界の契約化

**問題**: `allowedOrigins` を空にすると全許容という挙動だが、セキュリティ推奨値が不明。

**案**:
- standalone: `allowedOrigins: []`（any）を許容
- embedded: 親ページの origin を `allowedOrigins` にセットすることを推奨
- blob URL iframe の origin は `null` になりがちなので、`blob:` / `data:` / `null` を個別に許容するフラグを追加

---

## SR-13. `attachment` archetype の body/asset 対応規約（新規）

**背景**: F カテゴリ（オフライン添付ビューア）の実装前提。

**問題**: `attachment` archetype の `body` フィールドに何を入れるか、
`assets` の key とどう紐付けるかが暗黙的でコード上の規約が存在しない。

**現状の推定動作**:
```
entry.body = "<asset_key>"  // body が asset key を指す文字列
container.assets[asset_key] = "data:image/png;base64,..."
```

**案**: `docs/spec/body-formats.md` に attachment 規約を明文化する。

```ts
// attachment archetype の body 形式（提案）
interface AttachmentBody {
  asset_key: string;   // container.assets のキー
  mime_type: string;   // 例: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  filename: string;    // 例: 'report.docx'
  size_bytes?: number; // 元ファイルサイズ
  encoding: 'base64';  // 現在は base64 のみ
}
```

body を JSON 文字列として格納する（他 archetype と同様）。

---

## SR-14. `record:offer` に `mime_type` / `filename` を追加（新規）

**背景**: SR-13 と SR-8 の組み合わせ。

**問題**: attachment archetype の offer を受けたビューアが、
body を decode する前に MIME type を知る手段がない。

**案**: SR-8 の拡張フィールドとして `mime_type` / `filename` を追加（再掲）:

```ts
interface RecordOfferPayload {
  // ...SR-8 フィールド...
  mime_type?: string;  // 例: 'application/pdf', 'message/rfc822'
  filename?: string;   // 例: 'invoice.pdf'
}
```

ビューア（F カテゴリ）はこのフィールドで受信前にレンダラを選択できる。

---

## SR-15. `asset:request` / `asset:result`（新規）

**背景**: attachment ビューア（F1〜F6）が PKC2 から特定の asset だけを取得したい。
`export:request` は container 全体を返すため、大容量 attachment には不向き。

**問題**: 現在、embedded ビューアが特定の asset_key だけを取得する手段がない。

**案**: 新メッセージ型を追加:

```ts
type MessageType = ... | 'asset:request' | 'asset:result';

interface AssetRequestPayload {
  asset_key: string;   // 取得したい asset の key
  entry_lid?: string;  // コンテキスト用（どの entry に属するか）
}

interface AssetResultPayload {
  asset_key: string;
  data: string;        // base64 data URL
  mime_type: string;
  filename?: string;
  size_bytes: number;
}
```

- capability guard: `asset:request` は embedded 時のみ受理
- SR-9 chunking と統合: 大容量 asset は chunk で分割送信
- 取得失敗時は SR-3 の `error { code: 'ASSET_NOT_FOUND' }` を返す
