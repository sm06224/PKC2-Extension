# C8. relation-graph（relations をグラフ表示）

**目的**: レコード間 relations をインタラクティブなノードリンクグラフで可視化。

**UI 概要**:

- Force-directed グラフ: ノード=レコード, エッジ=relation
- ノード色=archetype, サイズ=接続数
- ノードクリック → サイドバーに詳細
- ズーム / パン

**実装ノート**:

- **外部ライブラリ不使用**: Canvas ベース自作 force-directed
  - 斥力（クーロン法）+ 引力（フック法）+ ダンピング
  - ~200 行の物理シミュレーション
- `requestAnimationFrame` ループ
- ~500 ノードまで。超過時は警告

**SR 依存**: SR-2, SR-8 | **優先度**: Tier 3
