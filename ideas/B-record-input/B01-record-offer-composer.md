# B1. record-offer-composer（汎用 offer フォーム）

**目的**: 任意の archetype の `record:offer` を手動構成して送信する。全 B カテゴリの基本形。

**UI 概要**:

- archetype セレクタ（text / todo / textlog / form / attachment）
- title, body, tags（カンマ区切り→チップ）入力
- 任意: source_container_id, assets（ファイルピッカー→base64）
- JSON プレビューパネル（送信 envelope 全体を表示）
- 「Send Offer」+ ステータス + 送信履歴

**実装ノート**:

- archetype 別 body バリデーション（todo は `{ description }` 必須等）
- `FileReader.readAsDataURL()` でファイル → base64
- ドラフト自動保存: `localStorage`

**SR 依存**: SR-4, SR-8, SR-14 | **優先度**: Tier 1
