# F2. email-viewer（.eml / .msg 表示）★ユーザー重点要件

**目的**: メールファイル (.eml / .msg) を整形表示する。
ヘッダ、本文（HTML/プレーンテキスト）、インライン添付を正しくレンダリング。

**メッセージフロー**:

- F1 から base64 データを受信（or SR-15 `asset:request`）
- ローカルでデコード → レンダリング
- 任意: メール内添付を PKC2 に offer 可能

**UI 概要**:

- **ヘッダブロック**: From, To, CC, Date, Subject（メールクライアント風）
- **本文表示**:
  - HTML メール: sandboxed iframe (`sandbox="allow-same-origin"`) でレンダリング
  - プレーンテキスト: `<pre>` + line wrap
  - HTML / プレーン切替トグル
- **添付リスト**（メール自身の添付）:
  - filename, サイズ, ダウンロードボタン
  - 画像添付: インラインプレビュー
  - 「Save to PKC2」ボタン → `record:offer` (archetype=attachment)

**実装ノート**:

### .eml 形式 (MIME / RFC 822)

- **postal-mime** (~15KB, MIT) でフルパース
  - multipart, base64, quoted-printable 対応
  - パース: base64 → Uint8Array → postal-mime → headers, text, html, attachments
- HTML 本文: `DOMParser` でサニタイズ (`<script>` 除去)、sandboxed iframe に注入
- CID 画像: `cid:xxx` 参照をパース済み添付の data URL に置換
- **日本語 charset**: postal-mime が Shift_JIS / ISO-2022-JP を検出・変換

### .msg 形式 (Microsoft Outlook CFBF)

- OLE Compound File Binary Format — .eml より大幅に複雑
- 最小アプローチ: CFBF 構造パース → Subject, From, To, Body, Attachments 抽出
- パース失敗時: hex dump + 「unsupported format」メッセージ

### セキュリティ

- メール内スクリプトは一切実行しない
- 全 HTML 出力をサニタイズ

**SR 依存**: SR-13, SR-14, SR-15 | **優先度**: **Tier 2**（F カテゴリ最優先）

**バンドルライブラリ**: postal-mime (MIT, ~15KB gzipped)
