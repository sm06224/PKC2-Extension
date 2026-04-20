# C9. graph-navigator（relation + folder 階層のインタラクティブグラフ）

**目的**: PKC2 の **relations** と **folder 階層** を統合したノードリンクグラフを表示し、
ノードクリックで親 PKC2 の center pane に該当エントリを表示する **ナビゲーション拡張ツール**。

**想定利用シナリオ**: PKC2 を embed した親ページのサイドバー / オーバーレイとして常駐し、
標準のフォルダツリー UI を補完する「構造地図」として使う。

## メッセージフロー

```
起動時:
  [navigator] --export:request--> [PKC2]
  [PKC2]      --export:result-->  [navigator]
  → relations + folder 階層を合成してグラフ描画

ノードクリック時:
  [navigator] --navigate { select_lid, view:'detail' }--> [PKC2]
  → 親 PKC2 の center pane が該当エントリに遷移

PKC2 側で更新が発生したとき（将来）:
  [PKC2] --custom (or notify)--> [navigator]
  → navigator がグラフを再描画
```

## C8 relation-graph との違い

| 項目 | C8 relation-graph | **C9 graph-navigator** |
|------|------------------|----------------------|
| 配置形態 | standalone（独立 HTML） | **embedded**（親 PKC2 に常駐） |
| 描画対象 | relations のみ | **relations + folder 階層を統合** |
| ノードクリック | ローカル詳細パネル | **`navigate` で親 PKC2 を遷移** |
| 用途 | 可視化・分析 | **ナビゲーション** |
| SR 依存 | SR-2 | **SR-5 (navigate payload 必須)** |

## UI 概要

- **メインエリア**: Force-directed グラフ（C8 のレイアウトエンジンを流用）
  - ノード色: archetype 別（text=青 / todo=緑 / textlog=黄 / attachment=紫 / folder=灰）
  - ノードサイズ: 接続数（relation 数 + 子エントリ数）に比例
  - エッジ色: 種別を視覚化
    - 実線 = relation（意味的リンク）
    - 点線 = folder 階層（親子関係）
- **サイドバー**:
  - 選択中ノードのエントリ情報サマリ（title, archetype, tags, 最終更新日時）
  - 「Go to detail」ボタン（明示操作で navigate 送信、クリックで即座に送る設定も可）
- **ツールバー**:
  - レイアウト切替（force / 階層 / 円形）
  - フィルタ: archetype チェックボックス、タグ絞り込み
  - ズーム / パン / リセット
  - **「Follow parent selection」トグル**: 親 PKC2 の選択変化に追従（将来、PKC2 側が選択変更通知を送れるようになった場合）

## グラフ構造の合成ロジック

```ts
type GraphNode = {
  lid: string;
  title: string;
  archetype: ArchetypeId;
  size: number;  // 接続数ベース
};

type GraphEdge =
  | { kind: 'relation'; from: lid; to: lid; relation_kind: string }
  | { kind: 'folder';   from: lid; to: lid };  // parent → child

// folder エントリの body には子 lid 配列が格納されている想定
// relation は container.relations[] から抽出
```

- folder エントリ: `parent → child` のエッジを生成
- relation エントリ: relation の `from_lid` / `to_lid` からエッジを生成
- 両者を同一グラフにマージ（エッジ種別は色/線種で区別）

## 実装ノート

- **レイアウトエンジン**: C8 の自作 force-directed を流用（斥力 + 引力 + ダンピング）
  - 追加: folder エッジは強めの引力（親子を近接させる）
  - relation エッジは通常強度
- **親 PKC2 との通信**:
  - embed 前提: `window.parent.postMessage(envelope, '*')` で送信
  - navigate payload: `{ view: 'detail', select_lid: clickedLid, edit: false }`
  - SR-5 の payload 仕様に準拠
- **パフォーマンス**:
  - ~500 ノードまで。超過時は folder 単位で折りたたみ表示
  - ノードが多い場合は WebWorker にレイアウト計算を逃がす（将来）
- **選択同期**（オプション）:
  - PKC2 → navigator 方向は現状不可能（PKC2 側に選択変更通知がない）
  - 将来 SR 案: `selection:changed { lid }` のようなイベントを提案できる
  - 暫定: `export:request` を定期ポーリングして差分検知（非推奨、将来の改善対象）
- **更新検知**:
  - 現状は手動「Refresh」ボタン
  - 将来: PKC2 が `notify:updated` 的なメッセージを push する SR を提案（新規 SR-16 候補）

## SR 依存

- **SR-5 (必須)**: `navigate { view, select_lid }` payload 仕様
- SR-2: `correlation_id` で export:request の応答を確実にマッチ
- SR-8: relation_hints 取得（補助的）
- **SR-16 候補（新規提案）**: PKC2 側の更新通知メッセージ型（このツールのリアルタイム追従に必要）

## 優先度

**Tier 2**（ナビゲーション体験の劇的改善。SR-5 の最初の本格利用例）

ユーザー体験上、以下に価値:
- 大量エントリを持つ PKC2 で「どこに何があるか」を俯瞰できる
- folder 階層と relation 構造を同一視野で把握できる
- center pane へのジャンプが 1 クリックで完結する
