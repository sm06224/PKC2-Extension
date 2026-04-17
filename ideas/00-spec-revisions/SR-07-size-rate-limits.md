# SR-7. サイズ / レート制限の明文化

**問題**: `MAX_PAYLOAD_BYTES = 1MB`, `100 msg/s` は仕様書に記載されているだけでコードに存在しない。

**案**: `src/adapter/transport/limits.ts` で定数化し、超過時に SR-3 の `error` を返す。

```ts
export const MAX_PAYLOAD_BYTES = 1_048_576; // 1MB
export const MAX_MESSAGES_PER_SECOND = 100;
```
