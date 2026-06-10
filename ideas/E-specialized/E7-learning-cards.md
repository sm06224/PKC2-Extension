# E7. learning-cards（フラッシュカード）

**目的**: Q&A フラッシュカード。簡易 Leitner 法で間隔反復学習。

**UI 概要**:

- 作成: Question + Answer → 「Add Card」
- 学習: 質問 → タップで回答表示 → Easy / Hard / Again
- デッキブラウザ + 統計

**実装ノート**:

- body: `{ question, answer, deck?, tags? }`
- Leitner 3 box: Box1=毎回, Box2=3回ごと, Box3=7回ごと
- ボックス配置は `localStorage`（カード lid ごと）
- フリップ: CSS `transform: rotateY`

**SR 依存**: SR-2, SR-4, SR-8 | **優先度**: Tier 3
