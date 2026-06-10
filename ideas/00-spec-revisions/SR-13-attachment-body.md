# SR-13. `attachment` archetype の body/asset 対応規約（新規）

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
