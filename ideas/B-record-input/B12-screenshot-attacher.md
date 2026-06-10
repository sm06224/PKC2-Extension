# B12. screenshot-attacher（画面キャプチャ → attachment）

**目的**: 画面キャプチャを attachment レコードとして送信。

**UI 概要**:

- 「Capture Screen」ボタン
- プレビュー + 簡易トリミング（canvas 矩形選択）
- title 入力 + 「Send to PKC2」

**実装ノート**:

- `getDisplayMedia()` → canvas 1 フレーム → `toDataURL('image/png')`
- 画像データは SR-8 assets or SR-13 attachment body で送信
- サイズ注意: SR-9 chunking が必要になる場合あり

**SR 依存**: SR-8, SR-9, SR-13, SR-14 | **優先度**: Tier 3
