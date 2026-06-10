# SR-10. capability negotiation の明示化

**問題**: capability は pong の payload にしか現れない。
受信側が送信側の能力を知る手段が ping/pong だけ。

**案**: 新メッセージ型を追加:

```ts
type MessageType = ... | 'hello' | 'capabilities:query' | 'capabilities:report';
```

- `hello`: 接続時に自動送信する自己紹介。pong と同じ PongProfile を payload に持つ
- `capabilities:query`: 相手の capabilities を問い合わせる
- `capabilities:report`: query への応答、または push 通知
