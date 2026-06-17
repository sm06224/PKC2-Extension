# PKC-Message 仕様改定案 (Spec Revision Proposals)

現行 v1 は Phase 1 型定義段階。実運用で不足する点への拡張提案。
v1 後方互換を基本とする（未知フィールドは無視するルールを前提）。

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

## 提案一覧

| SR | タイトル | ファイル |
|----|---------|---------|
| SR-1 | `message_id` 必須化 | [SR-01-message-id.md](SR-01-message-id.md) |
| SR-2 | `correlation_id` | [SR-02-correlation-id.md](SR-02-correlation-id.md) |
| SR-3 | 標準 `error` 型 | [SR-03-error-type.md](SR-03-error-type.md) |
| SR-4 | `record:ack` | [SR-04-record-ack.md](SR-04-record-ack.md) |
| SR-5 | `navigate` payload | [SR-05-navigate-payload.md](SR-05-navigate-payload.md) |
| SR-6 | `custom` 名前空間 | [SR-06-custom-namespace.md](SR-06-custom-namespace.md) |
| SR-7 | サイズ / レート制限 | [SR-07-size-rate-limits.md](SR-07-size-rate-limits.md) |
| SR-8 | `record:offer` 拡張 | [SR-08-offer-payload-ext.md](SR-08-offer-payload-ext.md) |
| SR-9 | 大ペイロード chunking | [SR-09-chunking.md](SR-09-chunking.md) |
| SR-10 | capability negotiation | [SR-10-capability-negotiation.md](SR-10-capability-negotiation.md) |
| SR-11 | broadcast / multicast | [SR-11-broadcast-multicast.md](SR-11-broadcast-multicast.md) |
| SR-12 | origin / sandbox 境界 | [SR-12-origin-sandbox.md](SR-12-origin-sandbox.md) |
| SR-13 | attachment body 規約 | [SR-13-attachment-body.md](SR-13-attachment-body.md) |
| SR-14 | offer に mime/filename | [SR-14-offer-mime-filename.md](SR-14-offer-mime-filename.md) |
| SR-15 | `asset:request/result` | [SR-15-asset-request.md](SR-15-asset-request.md) |
| SR-16 | `data:changed` 通知 | [SR-16-data-change-notification.md](SR-16-data-change-notification.md) |
| SR-17 | `selection:changed` 通知 | [SR-17-selection-change-notification.md](SR-17-selection-change-notification.md) |
| SR-18 | ホスト・レンダーサービス (`render-request`/`render-result`/`stylesheet` + `core-render`) | [SR-18-host-render-service.md](SR-18-host-render-service.md) |
