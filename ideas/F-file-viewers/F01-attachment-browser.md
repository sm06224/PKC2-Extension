# F1. attachment-browser（添付一覧 → MIME 別振り分け）

**目的**: PKC2 内の全 attachment を一覧表示し、MIME type に基づき適切なビューアに振り分ける中央ハブ。

**メッセージフロー**:

```
[browser] --export:request--> [PKC2]
[PKC2]    --export:result-->  [browser]
[browser] archetype=attachment をフィルタ → 一覧表示
ユーザークリック → MIME に基づきビューア起動
```

**UI 概要**:

- グリッド / リスト表示切替
- 各 attachment: アイコン（MIME 別）、filename、サイズ、日付
- ソート: 名前 / 日付 / 種類 / サイズ
- 検索 / フィルタバー
- クリック → インラインビューアパネル or 新タブ

**MIME → ビューア対応表**:

```js
const VIEWERS = {
  'message/rfc822': 'F2',
  'application/vnd.ms-outlook': 'F2',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'F3',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'F4',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'F5',
  'application/pdf': 'F6',
  'image/*': 'inline-img',
  'text/plain': 'inline-pre',
};
```

**実装ノート**:

- `export:result` → `archetype === 'attachment'` フィルタ
- body を SR-13 `AttachmentBody` としてパース
- ビューア起動方式:
  1. iframe 内にビューアを埋め込み、`custom` メッセージ (`ns:'pkc2ext.attachment.view'`) でデータ送信
  2. `window.open` + URL フラグメントでデータ渡し（~2MB 上限）
- MIME アイコン: emoji ベース（📧📄📊📋📑📐🖼️）

**SR 依存**: SR-13 (必須), SR-14, SR-15 | **優先度**: Tier 2
