# F8. drawio-editor（draw.io XML 読み書きエディタ）

**目的**: draw.io ダイアグラム (XML) をビジュアル編集する。
既存の drawio attachment を読み込み、編集し、保存。

**メッセージフロー**:

- 読込: SR-15 `asset:request` で既存 drawio attachment を取得
- 保存: `record:offer` (archetype=attachment, asset=drawio XML + SVG)

**UI 概要**:

- Canvas ベースダイアグラムエディタ
- シェイプパレットサイドバー（矩形、円、矢印、テキスト等）
- ドラッグでシェイプ配置
- エッジハンドルからドラッグで接続
- プロパティパネル: 塗り色、枠線、テキスト、フォント
- ツールバー: undo/redo, zoom, align, group
- 「Save」→ XML ソース + SVG レンダリングの両方を offer

**実装ノート**:

**draw.io (diagrams.net) は ~10MB で埋め込み不可** → 簡易エディタを自作。

### draw.io XML パース

```xml
<mxGraphModel>
  <root>
    <mxCell id="2" value="Hello" style="rounded=1;fillColor=#fff2cc;..."
            vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

- `style` 属性: `;` 区切りの key=value ペアをパース
- レンダリング: style に基づき SVG シェイプ生成 (`rounded`, `shape`, `fillColor`, `strokeColor`)
- エッジ: source/target cell ID で接続追跡

### 編集機能

- シェイプ移動、リサイズ、テキスト変更、追加/削除
- 接続: ドラッグでソース/ターゲット指定
- SVG ベースレンダリング

### 制約

- draw.io 全機能（ステンシル、カスタムシェイプ、ルーティング）は非対応
- **推定コード量: ~1000-1500 行**

**SR 依存**: SR-8, SR-13, SR-14, SR-15 | **優先度**: Tier 3
