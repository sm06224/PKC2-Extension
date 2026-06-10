# E1. reading-list（URL 読書管理）

**目的**: URL 読書リストの管理。追加、既読/未読追跡、メモ。

**UI 概要**:

- URL + タイトル入力 + 「Add」
- テーブル: title, URL, ステータス (unread/reading/done), 追加日
- メモ textarea + フィルタ

**実装ノート**:

- ステータス: `localStorage` + 読了時に新規 offer (`tags=['reading-list','read']`)
- リスト復元: `export:request` → `tags='reading-list'` フィルタ

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
