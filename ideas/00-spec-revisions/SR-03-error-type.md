# SR-3. 標準エラー型 `error` を追加

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
