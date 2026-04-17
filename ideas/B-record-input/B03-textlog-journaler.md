# B3. textlog-journaler（textlog 連続追記）

**目的**: 追記専用のジャーナル。各エントリが textlog レコードとして送信される。

**UI 概要**:

- ヘッダ: 今日の日付、自動タイトル「YYYY-MM-DD Journal」
- メイン: このセッションの過去エントリ一覧（タイムスタンプ付き）
- 下部: テキスト入力 + 「Append」

**実装ノート**:

- 各 append = 新規 `record:offer` (archetype=textlog)
- body: `[HH:MM] ユーザーテキスト`
- v1 に `record:update` なし → 1 追記 = 1 新規レコード
- `sessionStorage` でセッション内エントリ追跡

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 2
