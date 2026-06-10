# SR-9. 大ペイロード向け chunking

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
