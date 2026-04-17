# SR-14. `record:offer` に `mime_type` / `filename` を追加（新規）

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
