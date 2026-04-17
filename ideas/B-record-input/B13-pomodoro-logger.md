# B13. pomodoro-logger（タイマー終了 → 自動 offer）

**目的**: ポモドーロタイマー完了時に textlog レコードを自動記録。

**UI 概要**:

- 円形タイマー（25 分作業 / 5 分休憩、設定可能）
- タスク説明入力
- Start / Pause / Reset
- 完了時自動 offer + セッション履歴

**実装ノート**:

- `setInterval` ベース（ドリフト補正付き）
- 通知音: `AudioContext` オシレーター
- バックグラウンド: Notification API
- body: 「Pomodoro: {タスク} - {所要時間}」

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
