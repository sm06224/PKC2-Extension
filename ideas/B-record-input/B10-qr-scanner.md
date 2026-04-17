# B10. qr-scanner（QR 読取 → offer）

**目的**: デバイスカメラで QR コードを読み取り text レコードとして送信。

**UI 概要**:

- カメラビューファインダー
- デコード結果表示 + 「Send to PKC2」
- スキャン履歴
- フォールバック: QR 画像ファイル入力

**実装ノート**:

- `getUserMedia({ video: { facingMode:'environment' } })`
- **jsQR** (~40KB) をインライン埋め込み
- video → canvas → `getImageData` → jsQR（~200ms 間隔）

**SR 依存**: SR-8 | **優先度**: Tier 3 | **バンドル**: jsQR (Apache-2.0, ~40KB)
