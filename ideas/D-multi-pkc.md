# D. Multi-PKC / Bridge ツール

複数の PKC2 インスタンス（iframe）間でメッセージを中継・同期するツール群。
1 つの HTML ページに n 個の PKC2 iframe を埋め込み、それらの間でデータを流す。

---

## 使用する PKC-Message 型

```ts
// 全型を中継対象とする
'ping' | 'pong'                                   // 接続確認
'record:offer' | 'record:accept' | 'record:reject' // レコード転送
'export:request' | 'export:result'                  // 差分比較用
'navigate' | 'custom'                               // 特殊用途
```

D カテゴリの中核は「親ページが Hub として機能する」アーキテクチャ。

---

## 共通アーキテクチャ: 親ページ Hub パターン

全 D カテゴリツールは以下の共通パターンに従う。

### 構成

```
┌──────────────────── 親 HTML (ツール) ────────────────────┐
│                                                          │
│  message listener        routing logic                   │
│       ↓                      ↓                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │
│  │ PKC2-A  │  │ PKC2-B  │  │ PKC2-C  │  ... (n 台)     │
│  │ iframe  │  │ iframe  │  │ iframe  │                  │
│  └─────────┘  └─────────┘  └─────────┘                  │
│      ↑↓            ↑↓            ↑↓                      │
│   postMessage   postMessage   postMessage                │
└──────────────────────────────────────────────────────────┘
```

### 動作原理

1. 親 HTML が n 個の `<iframe>` を動的生成
2. 各 iframe の `message` イベントを親がリッスン
3. 親がルーティングロジックに基づき、他の iframe に `postMessage` で転送
4. `source_id` / `target_id` を適切に書き換え（proxy として動作）

### 共通実装パターン

```ts
// iframe レジストリ
const iframes: Array<{
  id: string;
  element: HTMLIFrameElement;
  url: string;
  status: 'connecting' | 'ready' | 'error';
  profile?: PongProfile;
}> = [];

// 全 iframe からのメッセージをリッスン
window.addEventListener('message', (event) => {
  if (event.data?.protocol !== 'pkc-message') return;
  const sender = iframes.find(f => f.element.contentWindow === event.source);
  if (!sender) return;
  routeMessage(sender, event.data);
});
```

---

## D1. multi-broadcaster（複数 iframe に同時配信）

**目的**: 単一メッセージを複数の PKC2 iframe に同時配信する。
D カテゴリの基本パターン。

**メッセージフロー**:

```
[ユーザー入力] → [broadcaster]
      ├── --record:offer--> [PKC2-A]
      ├── --record:offer--> [PKC2-B]
      └── --record:offer--> [PKC2-C]

各 PKC2 から:
      --record:accept/reject--> [broadcaster]
```

**UI 概要**:

- **iframe URL リスト**: 追加 / 削除ボタン付き
- **接続ステータス**: iframe ごとに ping/pong 結果表示
- **メッセージ作成**: B1 record-offer-composer と同じフォーム
- **「Broadcast」ボタン**
- **iframe 別レスポンス追跡**: accepted / rejected / timeout

**実装ノート**:

- 動的 iframe 管理: `{ id, iframe, url, status }` の配列
- 全 iframe に同一 envelope を送信。ただし `target_id` は各 iframe の container_id に設定
- レスポンス収集: `Promise.allSettled` パターン、iframe ごとにタイムアウト (10s)
- 送信結果: iframe 別に accept/reject/timeout を表示

**SR 依存**: SR-1 (`message_id`、ブロードキャストごとに固有)、SR-2 (`correlation_id`、レスポンス追跡)、SR-11 (broadcast セマンティクス)

**優先度**: Tier 3

---

## D2. a-to-b-bridge（A の accept を B に転送）

**目的**: PKC2-A がレコードを accept したとき、その内容を自動的に PKC2-B に offer する。
一方向データフローブリッジ。

**メッセージフロー**:

```
[外部ツール等] --record:offer--> [PKC2-A]
[PKC2-A] --record:accept--> [bridge]         ← bridge が検知

[bridge] --export:request--> [PKC2-A]        ← 完全なレコードデータ取得
[PKC2-A] --export:result-->  [bridge]

[bridge] --record:offer--> [PKC2-B]          ← B に転送
[PKC2-B] --record:accept/reject--> [bridge]
```

**UI 概要**:

- **2 つの iframe パネル**: Source (A) と Destination (B)
- **ブリッジステータス**: active / paused トグル
- **転送ログ**: どのレコードが転送されたか（ステータス付き）
- **フィルタ**: archetype 別、タグ別

**実装ノート**:

- A からの `record:accept` をリッスン
- 課題: `record:accept` の payload はフルレコードデータを含まない場合がある → `export:request` で取得が必要
- SR-15 があれば `asset:request` で attachment だけを選択取得可能
- 転送ログをメモリに保持
- 重複排除: 転送済みレコードの lid を追跡して再送防止

**SR 依存**: SR-2 (`correlation_id`)、SR-4 (ack)、SR-15 (`asset:request` で attachment 取得)

**優先度**: Tier 3

---

## D3. sync-pair（2 PKC2 の差分同期）

**目的**: 2 つの PKC2 インスタンス間で双方向差分同期を行う。
片方にしかないレコードを検出し、相手側に offer する。

**メッセージフロー**:

```
[sync] --export:request--> [PKC2-A] --export:result--> [sync]
[sync] --export:request--> [PKC2-B] --export:result--> [sync]

[sync] 差分計算

[sync] --record:offer (B に不足分)--> [PKC2-B]
[sync] --record:offer (A に不足分)--> [PKC2-A]
```

**UI 概要**:

- **2 つの iframe パネル** + 接続ステータス
- **「Compare」ボタン** → 差分表示
- **3 セクション**: A のみ / B のみ / 両方にあり（変更 diff 付き）
- **チェックボックス**: レコード単位で同期対象を選択
- **「Sync Selected」ボタン** + 方向矢印
- **プログレスバー**

**実装ノート**:

- 両 container をエクスポートし、コンテンツハッシュでマッチ
  - lid は container 間で一致しないため使えない
  - content hash: `SubtleCrypto.digest('SHA-256', JSON.stringify(sortedEntry))`
- コンフリクト検出: 同一 title だが異なる body → コンフリクトマーク、ユーザーが選択
- バッチ offer: レコード間にディレイ（SR-7 レート制限準拠）
- 全操作をログに記録

**SR 依存**: SR-2、SR-4、SR-7 (レート制限)、SR-8 (tags / assets 保持)

**優先度**: Tier 3

---

## D4. mirror（全レコードクローン）

**目的**: ソース PKC2 の全レコードをデスティネーション PKC2 に一方向クローンする。

**メッセージフロー**: ソースから `export:request` → 全エントリを順次 `record:offer` でデスティネーションへ。

**UI 概要**:

- **Source / Destination iframe パネル**
- **「Start Mirror」ボタン**
- **プログレス**: 「Offering record 15/200...」
- **レコード別ステータス追跡**
- **完了サマリ**: accepted / rejected / total

**実装ノート**:

- ソース container をエクスポート
- 全エントリをイテレートし、デスティネーションに offer
- レート制限: 設定可能なディレイ（デフォルト 100ms、SR-7 準拠）
- reject は graceful にハンドル（ログして続行）
- assets: SR-8 の assets フィールドで offer payload に含める
- 警告: デスティネーションに既存レコードがある場合、重複作成の可能性を通知

**SR 依存**: SR-4、SR-7、SR-8、SR-9 (大レコードの chunking)、SR-13 (attachment 形式)

**優先度**: Tier 3

---

## D5. federation-hub（n 台 PKC2 中継ハブ）

**目的**: N 台の PKC2 インスタンスを管理する中央中継ハブ。
1 台で accept されたレコードを他の全台に自動転送する。

**メッセージフロー**:

```
[PKC2-X] --record:accept--> [hub]

[hub] --record:offer--> [PKC2-Y]   (X 以外の全 iframe)
[hub] --record:offer--> [PKC2-Z]
      ...
```

**UI 概要**:

- **ノードグリッド**: 各 PKC2 をカードで表示（ステータス付き）
- **追加 / 削除**: ノード管理
- **接続メッシュ可視化**: どのノードが接続されているか
- **メッセージフローアニメーション**: ノード間を移動するドット
- **ルール設定**: 転送対象の archetype ホワイトリスト、タグフィルタ
- **フェデレーションログ**

**実装ノート**:

- ハブが全 iframe のレジストリを維持
- iframe X からの `record:accept` を検知 → X 以外の全 iframe に offer
- 転送ルール: ノードごとに設定可能なフィルタ（archetype ホワイトリスト、タグマッチ）
- ループ防止: `message_id` を追跡し、転送済みメッセージを再転送しない（SR-1 必須）
- パフォーマンス: accept 1 件あたり O(n-1) メッセージ
- スケール上限: ~10 iframe が現実的（ブラウザメモリ制約）

**SR 依存**: SR-1 (`message_id`、ループ防止に必須)、SR-2、SR-4、SR-7、SR-11

**優先度**: Tier 3（上級）

---

## D6. diff-merger（欠落レコードを選択的 offer）

**目的**: C3 (backup-diff) の差分表示に加え、欠落レコードを選択的に offer する。
C3 + D4 の統合ツール。

**メッセージフロー**:

```
[merger] 2 つのソースから container 取得（iframe or ファイル）
[merger] 差分計算
[merger] --record:offer (選択分)--> [対象 PKC2]
```

**UI 概要**:

- **ソース / デスティネーション選択**: iframe またはファイルアップロード
- **差分テーブル**: ソースにのみ存在するレコード（プレビュー付き）
- **個別「Offer」ボタン** or **「Offer All Selected」**
- **レコード別ステータス追跡**
- **確認ダイアログ**: 大量バッチ時

**実装ノート**:

- 差分アルゴリズムは C3 と同一
- 選択的 offer は D4 パターン
- 各レコードを offer 前にプレビュー可能
- 大量バッチ (50+ 件) では確認ダイアログ表示

**SR 依存**: SR-2、SR-4、SR-8

**優先度**: Tier 3
