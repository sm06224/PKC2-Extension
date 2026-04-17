# B9. rss-fetcher（RSS/Atom → offer）

**目的**: RSS/Atom XML をパースし各エントリを text レコードとして offer。

**UI 概要**:

- XML 貼付エリア
- パース結果（フィードタイトル + エントリ一覧）
- チェックボックス選択 + 「Import Selected」

**実装ノート**:

- **オフライン制約**: URL 直接フェッチ不可 → ユーザーが XML 貼付
- `DOMParser` で `text/xml` パース
- RSS 2.0: `<item>` / Atom: `<entry>`

**SR 依存**: SR-8 | **優先度**: Tier 3
