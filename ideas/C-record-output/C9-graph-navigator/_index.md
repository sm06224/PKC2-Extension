# C9. graph-navigator（relation + folder 階層のインタラクティブグラフ）

**旧 C8 relation-graph を統合したツール**。relations と folder 階層を統合したノードリンクグラフを
単一 HTML ファイルとして提供し、2 つのモードで動作する。

## 2 つの動作モード

### embedded モード（メイン想定、旧 C9）

- 自ツールが親ページ。内部に PKC2 iframe を埋め込む
- 左: グラフサイドパネル / 右: PKC2 center pane
- グラフのノードクリック → `navigate { select_lid, view:'detail' }` → center pane が遷移
- PKC2 側の選択変化を SR-17 `selection:changed` で受信 → グラフ上で現選択ハイライト
- PKC2 側のデータ変更を SR-16 `data:changed` で受信 → グラフ差分再描画

### standalone モード（旧 C8 相当）

- container JSON ファイルをアップロードして全画面グラフ可視化
- PKC2 本体と通信しない純粋ビューア
- ノードクリック → サイドパネルにエントリ詳細（ローカル表示）
- バックアップ分析・オフライン俯瞰用途

両モードとも **同一レンダリングエンジン** を使う。モード判定は起動時フラグ or URL パラメータ。

## グラフ合成ロジック

```ts
type GraphNode = {
  lid: string;
  title: string;
  archetype: ArchetypeId;
  degree: number;  // 接続数（folder children + relation edges）
};

type GraphEdge =
  | { kind: 'relation'; from: lid; to: lid; relation_kind: string }
  | { kind: 'folder';   from: lid; to: lid };  // parent → child
```

- **folder エッジ**: folder archetype の body から子 lid を抽出 → 親子エッジ生成（点線表示）
- **relation エッジ**: `container.relations[]` から from/to を抽出（実線表示）
- 両者を同一グラフにマージ、視覚的に区別

## UI 概要

### 共通コンポーネント

- **メイングラフキャンバス**
  - Force-directed レイアウト（自作、外部ライブラリ不要）
  - ノード色: archetype 別（text=青 / todo=緑 / textlog=黄 / attachment=紫 / folder=灰 / form=桃）
  - ノードサイズ: degree に比例 (min 8px 〜 max 40px)
  - エッジ: 実線=relation / 点線=folder / 色で relation_kind を区別
- **ツールバー**
  - レイアウト切替（force / 階層 / 円形）
  - archetype フィルタチェックボックス
  - タグ絞り込み（複数選択可）
  - ズーム / パン / リセット
  - 「Refresh」ボタン（SR-16 未対応時の fallback）
- **選択詳細パネル**（サイドバー）
  - 選択中ノードの: title, archetype, tags, 最終更新日時, 関係一覧
  - embedded モードでは「Navigate」ボタンが目立つ UI
  - standalone モードでは body プレビュー

### モード別要素

| | embedded | standalone |
|---|---------|-----------|
| center 領域 | PKC2 iframe | グラフが全画面 |
| データソース | 起動時 `export:request` + SR-16/17 で追従 | ファイルアップロード |
| クリック動作 | `navigate` 送信 | ローカル詳細パネル |
| 現選択表示 | SR-17 で受動追従 | なし |

## SR 依存

| SR | 役割 | モード | 有無の影響 |
|----|-----|-------|-----------|
| SR-2 | `correlation_id` | 共通 | 並列 export:request 区別（なくても動く） |
| SR-5 | `navigate` payload | embedded のみ | **必須**。なしだと embedded モード不可 |
| SR-8 | relation_hints | 共通 | relation 表示充実（なくても最小動作） |
| SR-16 | `data:changed` 通知 | embedded | **あるべき**。なしだと手動 Refresh ボタン |
| SR-17 | `selection:changed` 通知 | embedded | **あるべき**。なしだと選択連動不可 |

現行 v1 + SR-5 のみで embedded モード MVP は実装可能。
SR-16 / SR-17 は UX 改善のため強く提案（詳細: [plan.md](plan.md) の Phase 2）。

## 実装計画

**→ [plan.md](plan.md) 参照**

ソースツリー、ビルド方式、単一 HTML バンドル戦略、開発フェーズ、テスト戦略を記載。

## 優先度

- **Tier 2**（embedded モード）: ナビゲーション体験の劇的改善
- **Tier 3**（standalone モード）: バックアップ分析ツールとして
