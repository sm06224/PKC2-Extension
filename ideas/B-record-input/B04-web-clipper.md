# B4. web-clipper（HTML/テキスト貼付 → 抽出 → offer）

**目的**: Web ページ内容を貼り付け、可読テキストを抽出して text レコードとして送信。

**UI 概要**:

- URL 入力（メタ情報としてタグに保存）
- HTML/テキスト貼付エリア
- プレビュー（抽出 title + 本文、編集可能）
- 「Send to PKC2」

**実装ノート**:

- **オフライン制約**: URL 直接フェッチ不可（CORS）→ ユーザーが貼り付け
- 抽出: 一時 `<div>` → innerHTML → `<script>/<style>/<nav>` 除去 → textContent
- ソース URL は tags に `['source:https://...']`

**SR 依存**: SR-8, SR-14 | **優先度**: Tier 2
