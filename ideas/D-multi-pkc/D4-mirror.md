# D4. mirror（全レコードクローン）

**目的**: ソース PKC2 → デスティネーション PKC2 に全レコード一方向クローン。

**UI 概要**:

- Source / Destination iframe + 「Start Mirror」
- プログレス「Offering record 15/200...」
- 完了サマリ（accepted / rejected / total）

**実装ノート**:

- ソース export → 全エントリを順次 offer
- ディレイ 100ms（SR-7 準拠）
- reject は graceful にログして続行
- デスティネーションに既存レコードがあれば重複警告

**SR 依存**: SR-4, SR-7, SR-8, SR-9, SR-13 | **優先度**: Tier 3
