# B2. todo-quick-sender（todo 専用入力）

**目的**: 最小 UI で素早く todo レコードを作成する。キーボードファースト。

**UI 概要**:

- 1 行 description 入力（大きめフォント）
- 日付ピッカー（due date, 任意）
- 優先度セレクタ（high/medium/low → タグ化）
- 「Add」+ Enter ショートカット
- 送信履歴リスト（accept/reject ステータス付き）

**実装ノート**:

- body: `JSON.stringify({ status:'open', description, date?, archived:false })`
- Tab でフィールド移動、Enter で送信
- 送信キュー: 前 offer が pending 中でも次をキューに積む
- 送信後 description 自動クリア + フォーカス復帰

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 1
