# B14. daily-log-starter（今日の textlog を自動生成）

**目的**: 1 クリックで今日の日報テンプレートを textlog レコードとして生成。

**UI 概要**:

- 「Create Today's Log」ボタン
- テンプレートプレビュー / エディタ
- 送信後ステータス

**デフォルトテンプレート**:

```
# YYYY-MM-DD (曜日) 日報
## 今日の目標
-
## メモ
-
## 明日への申し送り
-
```

**実装ノート**:

- テンプレート `localStorage` 保存、設定で編集可
- 日付: `Intl.DateTimeFormat('ja-JP', { weekday:'short' })`
- 重複防止: 最終作成日を `localStorage` に保存、同日警告

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
