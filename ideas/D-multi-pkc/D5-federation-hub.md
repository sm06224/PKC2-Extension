# D5. federation-hub（n 台 PKC2 中継ハブ）

**目的**: N 台の PKC2 を管理する中央中継ハブ。1 台の accept → 他全台に自動転送。

**UI 概要**:

- ノードグリッド（PKC2 カード + ステータス）
- 接続メッシュ可視化 + メッセージフローアニメーション
- ルール設定: archetype ホワイトリスト、タグフィルタ
- フェデレーションログ

**実装ノート**:

- iframe X からの accept → X 以外の全 iframe に offer
- **ループ防止**: `message_id` を追跡（SR-1 必須）
- O(n-1) メッセージ / accept
- スケール上限: ~10 iframe

**SR 依存**: SR-1 (必須), SR-2, SR-4, SR-7, SR-11 | **優先度**: Tier 3
