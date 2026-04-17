# SR-15. `asset:request` / `asset:result`（新規）

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
