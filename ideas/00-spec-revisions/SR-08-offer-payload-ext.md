# SR-8. `record:offer` payload を拡張

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
