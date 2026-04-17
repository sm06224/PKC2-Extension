# F10. canvas-sketcher（自由手書きキャンバス → SVG/PNG）

**目的**: フリーハンド描画キャンバス。スケッチやメモを SVG/PNG attachment として保存。

**メッセージフロー**: `record:offer` (archetype=attachment, asset=SVG or PNG)

**UI 概要**:

- フルスクリーンキャンバス
- ツールバー: pen, eraser, shapes (line/rect/circle), text
- カラーピッカー、ストローク幅スライダー
- Undo / Redo
- 「Clear All」
- 「Save as SVG」/「Save as PNG」
- タッチ / スタイラス対応

**実装ノート**:

- **純粋 Canvas API** — 外部ライブラリ不要
- 描画: `mousedown` → start path, `mousemove` → `lineTo`, `mouseup` → end
- タッチ: `touchstart/move/end` を同じハンドラにマッピング
- ストローク平滑化: Catmull-Rom スプライン補間
- データモデル: `{ points: [{x,y}], color, width }` のストローク配列
- SVG エクスポート:
  ```js
  strokes.map(s =>
    `<path d="M${s.points.map(p => `${p.x} ${p.y}`).join(' L')}"
      stroke="${s.color}" stroke-width="${s.width}" fill="none"/>`
  )
  ```
- PNG: `canvas.toDataURL('image/png')`
- Undo: ストローク配列の末尾を pop → 全再描画
- 筆圧感知: `PointerEvent.pressure` で可変ストローク幅（対応デバイスのみ）

**SR 依存**: SR-8, SR-13, SR-14 | **優先度**: Tier 3
