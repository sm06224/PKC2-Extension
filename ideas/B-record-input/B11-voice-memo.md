# B11. voice-memo（Web Speech → textlog）

**目的**: 音声をテキスト変換し textlog レコードとして送信。

**UI 概要**:

- 大きな「Record」ボタン
- リアルタイム文字起こし（interim results）
- 「Stop & Send」
- 履歴

**実装ノート**:

- `SpeechRecognition` / `webkitSpeechRecognition`
- `continuous=true`, `interimResults=true`, `lang='ja-JP'`
- **オフライン制限**: Chrome は要ネットワーク。Firefox オフライン可。明記する
- フォールバック: 手動テキスト入力

**SR 依存**: SR-4, SR-8 | **優先度**: Tier 3
