# SR-1. `message_id` 必須化（重複排除・追跡）

**問題**: 再送時に受信側が重複を判別できない。

**案**: envelope に `message_id: string`（UUID v4 推奨）を必須追加。
受信側は直近 N 件の `message_id` を記憶し、重複を黙って破棄する。

```ts
interface MessageEnvelope {
  // ...既存フィールド...
  message_id: string; // NEW: 必須
}
```
