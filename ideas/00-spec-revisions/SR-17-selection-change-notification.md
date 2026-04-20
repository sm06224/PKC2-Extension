# SR-17. `selection:changed` 通知メッセージ（新規）

**背景**: C9 graph-navigator のような「PKC2 のナビゲーションを補助するツール」では、
ユーザーが PKC2 本体で選択を変えたとき、ツール側（グラフ等）もその選択を反映したい。
現状、PKC2 からツール側に選択情報を push する手段がない。

## 問題

`navigate { select_lid }` はツール → PKC2 方向の **片方向** しか定義されていない。
逆方向（PKC2 側での選択変化をツールに通知）がないため、以下ができない:

- グラフ上で現在選択中エントリをハイライト
- サイドバーに現エントリの関連情報を表示
- 選択に連動した補助ペインの更新

## 案

新メッセージ型 `selection:changed` を追加。PKC2 は `selectedLid` が変化した時、
接続中の全ツールに broadcast する。

```ts
type MessageType = ... | 'selection:changed'; // NEW

interface SelectionChangedPayload {
  lid: string | null;              // 新しい選択 lid（null = 選択解除）
  view: 'detail' | 'calendar' | 'kanban';  // 現在のビューモード
  previous_lid?: string | null;    // 直前の選択（diff 用）
  trigger: 'user' | 'navigate' | 'import' | 'initial';
                                    // 変化のきっかけ
  container_id: string;
}
```

## 動作規則

- `SET_VIEW_MODE` では選択がクリアされない（PKC2 の既存 invariant）
  → ビューモード変更時は `trigger: 'user'` + `lid` 既存値で送信
- `trigger: 'navigate'` は SR-5 の `navigate` メッセージで起動された場合
  → ツール自身が送った navigate の echo を検出するのに使える
- 初期化時（ページロード直後）は `trigger: 'initial'` で初期選択を 1 度送信

## ユースケース

- **C9 graph-navigator**: 現選択ノードをハイライト + ビューセンタリング
- **将来ツール**: 選択連動サイドパネル、コンテキストアクション提供
- **D 系ツール**: 選択に応じた補助操作（例: 関連エントリ提案）

## SR-16 との関係

- SR-16 (`data:changed`): **データ自体**の変更通知
- SR-17 (`selection:changed`): **UI 状態**の変化通知
- 両方を併用して初めてツールが PKC2 に完全追従できる

## capability negotiation

- SR-10 の capability に `notifications: ['selection:changed']` を追加
- 未対応 PKC2 ではツール側は `export:request` + 手動 refresh にフォールバック

## プライバシー考慮

- 選択情報は軽度に機密（何を見ているかが漏れる）
- 将来、origin ごとに notification 購読可否を設定できる仕組み（SR-12 の拡張）を検討
