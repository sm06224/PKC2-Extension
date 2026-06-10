# C9 graph-navigator — 実装計画

単一 HTML ファイルにバンドルされた成果物を生成するための具体的実装計画。

## 成果物の形

### 最終物

- **1 ファイル**: `dist/graph-navigator.html`
- 外部 CDN 参照ゼロ、全 JS / CSS / アイコンを内包
- サイズ目標: **100KB 以下** (非圧縮)
- ダブルクリックでブラウザが開けば即動作

### 2 つの配布プロファイル

| プロファイル | 用途 | 備考 |
|-----------|-----|------|
| `graph-navigator.html` | standalone (旧 C8) | ファイル D&D で container JSON を読み込む |
| `graph-navigator-embed.html` | embedded | `?pkc2_src=./pkc2.html` 形式で PKC2 をロード |

**両者は同一ソースから異なるエントリポイントでビルド**される。1 つの index.html に両モードを内包して、起動時フラグで切替でも可（設計判断は MVP 完成後）。

## ソースツリー

```
tools/C9-graph-navigator/
├── src/
│   ├── main.ts                  # エントリポイント（モード判定 → 各 bootstrap 呼出）
│   ├── mode/
│   │   ├── embedded.ts          # embedded モード bootstrap
│   │   └── standalone.ts        # standalone モード bootstrap
│   ├── graph/
│   │   ├── model.ts             # GraphNode / GraphEdge 型 + container → graph 変換
│   │   ├── layout.ts            # Force-directed レイアウト物理演算
│   │   ├── renderer.ts          # SVG or Canvas 描画
│   │   └── interaction.ts       # マウス / タッチ / キーボード
│   ├── transport/
│   │   ├── envelope.ts          # MessageEnvelope 型 + validator
│   │   ├── bridge.ts            # postMessage ラッパ（PKC2 との通信）
│   │   └── handlers.ts          # export:result, selection:changed, data:changed 受信処理
│   ├── ui/
│   │   ├── sidebar.ts           # 選択詳細パネル
│   │   ├── toolbar.ts           # レイアウト切替・フィルタ
│   │   └── styles.css           # 全 CSS
│   └── util/
│       ├── archetype-colors.ts  # archetype → 色マップ
│       └── debounce.ts
├── public/
│   └── template.html            # ビルド時にこれをベースに inline する
├── build/
│   └── release-builder.ts       # dist/bundle.{js,css} → dist/*.html にインライン化
├── tests/
│   ├── graph/model.test.ts
│   ├── graph/layout.test.ts
│   └── transport/envelope.test.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## ビルドパイプライン

PKC2 本体と同じ 2 段階方式（Vite + 自作 release-builder）を踏襲:

```bash
npm run build:bundle     # Vite: src/ → dist/bundle.js + dist/bundle.css
npm run build:release    # release-builder: template.html に inline → dist/*.html
npm run build            # 上記両方
```

### Stage 1: Vite バンドル

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'GraphNavigator',
      fileName: () => 'bundle.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'bundle.css',
      },
    },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: false,
  },
});
```

- IIFE 形式で単一 JS ファイルに出力（グローバル汚染なし）
- CSS も単一ファイルに束ねる
- 外部依存なし（mermaid 等は使わない）

### Stage 2: HTML インライン化

`build/release-builder.ts`:

```ts
import { readFileSync, writeFileSync } from 'fs';

const template = readFileSync('public/template.html', 'utf8');
const js = readFileSync('dist/bundle.js', 'utf8');
const css = readFileSync('dist/bundle.css', 'utf8');

// 両プロファイルを出力
const standalone = template
  .replace('<!-- INJECT_MODE -->', '<meta name="gn-mode" content="standalone">')
  .replace('<!-- INJECT_CSS -->', `<style>${css}</style>`)
  .replace('<!-- INJECT_JS -->',  `<script>${js}</script>`);

const embedded = template
  .replace('<!-- INJECT_MODE -->', '<meta name="gn-mode" content="embedded">')
  .replace('<!-- INJECT_CSS -->', `<style>${css}</style>`)
  .replace('<!-- INJECT_JS -->',  `<script>${js}</script>`);

writeFileSync('dist/graph-navigator.html', standalone);
writeFileSync('dist/graph-navigator-embed.html', embedded);
```

### public/template.html 骨子

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>PKC2 Graph Navigator</title>
  <!-- INJECT_MODE -->
  <!-- INJECT_CSS -->
</head>
<body>
  <div id="gn-root"></div>
  <!-- INJECT_JS -->
</body>
</html>
```

- 全スタイルは `#gn-root` スコープ（PKC2 と同じパターン）
- ID 以外の CSS クラスは使わず `data-gn-*` 属性ベース（PKC2 パターン準拠、minify-safe）

## 依存ライブラリ方針

**runtime 依存ゼロ**。以下を自作:

- Force-directed レイアウト (~200 行): クーロン斥力 + フック引力 + ダンピング
- SVG 描画: 標準 DOM API
- JSON Tree 表示（詳細パネル用）: 再帰 DOM ビルダー

dev 依存のみ: TypeScript, Vite, Vitest, eslint

→ 単一 HTML が 100KB を超えない保証。

## embedded モードのレイアウト

```html
<div id="gn-root" data-gn-mode="embedded">
  <aside data-gn-region="sidebar">
    <!-- toolbar -->
    <!-- graph canvas (SVG) -->
    <!-- selection detail -->
  </aside>
  <main data-gn-region="pkc2-host">
    <iframe data-gn-pkc2 src="./pkc2.html"></iframe>
  </main>
</div>
```

- CSS Grid レイアウト: sidebar 幅可変、pkc2-host が残り全域
- iframe `allow-scripts allow-same-origin`（SR-12 準拠）
- URL パラメータ `?pkc2_src=...` で PKC2 のロード先を指定可能

## 開発フェーズ

### Phase 1: MVP (standalone) — 1〜2 週

- [ ] ソースツリー作成、Vite + release-builder セットアップ
- [ ] `GraphNode` / `GraphEdge` 型 + container → graph 変換（folder + relation 両対応）
- [ ] Force-directed レイアウト実装
- [ ] SVG レンダリング（ノード・エッジ・ラベル）
- [ ] ファイルアップロード UI
- [ ] 選択詳細サイドパネル
- [ ] 単一 HTML ビルド確認

**完了条件**: container JSON をアップロード → グラフが表示、クリックで詳細表示、単一 HTML で動作。

### Phase 2: embedded モード — 1〜2 週

- [ ] PKC2 iframe 埋め込み + layout
- [ ] `transport/bridge.ts`: envelope 送受信ラッパ実装
- [ ] 起動時 `export:request` → `export:result` でグラフ構築
- [ ] ノードクリック → `navigate { select_lid, view:'detail' }` 送信
- [ ] embedded プロファイルの単一 HTML ビルド

**完了条件**: ホストに `graph-navigator-embed.html` と `pkc2.html` を並べて開く → PKC2 のデータでグラフ表示、クリックで center pane が遷移。

この時点で **SR-5 のみで動作**。ただし Refresh は手動ボタン、選択同期なし。

### Phase 3: SR-16 / SR-17 追従 — 1 週（PKC2 本体側の対応が前提）

- [ ] `selection:changed` 受信 → グラフ上で現選択ハイライト
- [ ] `data:changed` 受信 → 差分再描画（作成/更新/削除の種別ごとに処理）
- [ ] capability negotiation: PKC2 未対応時は Phase 2 動作にフォールバック

**完了条件**: PKC2 側で編集 → グラフが自動更新。PKC2 側で選択変更 → グラフが追従。

### Phase 4: UX 仕上げ — 1 週

- [ ] レイアウト切替（force / 階層 / 円形）
- [ ] フィルタ（archetype, tags）
- [ ] 大規模 container (500+ ノード) 対応: folder 単位折りたたみ
- [ ] キーボードナビ（矢印キーでノード移動、Enter で navigate）
- [ ] エクスポート（現在グラフを SVG / PNG として保存）

## テスト戦略

- **unit** (Vitest): `graph/model.ts` / `graph/layout.ts` / `transport/envelope.ts`
- **integration** (happy-dom): full container JSON → 描画 DOM の構造検証
- **E2E** (Playwright 相当, 手動 or Playwright): 実 PKC2 と組み合わせた embedded モード動作確認
- **bundle size check**: CI で `dist/*.html` が目標サイズ内か検証

## PKC2 本体側に必要な作業

C9 embedded モードを本格運用するために PKC2 本体に必要な対応:

| 作業 | SR | PKC2 本体の変更範囲 |
|------|-----|-------------------|
| `navigate` ハンドラ実装 | SR-5 | `adapter/transport/handlers.ts` に追加 |
| `data:changed` 発火 | SR-16 | Dispatcher / reducer 後で broadcast |
| `selection:changed` 発火 | SR-17 | `SELECT_LID` アクション処理後で broadcast |
| capability に通知型を宣言 | SR-10 | `pong` / `hello` payload 拡張 |

→ これらは **本リポジトリの対象外**（PKC2 本体リポジトリで対応）。
PKC2 に SR 実装 PR を出す前に、本リポジトリで C9 を prototype しフィードバックを得るのが健全な順序。

## 想定される落とし穴

- **Force-directed のパフォーマンス**: 500+ ノードで体感劣化
  → folder 単位で折りたたみ、または WebWorker 化（Phase 4 以降）
- **iframe の sandbox / origin**: blob/data URL 起動時に origin=null になる
  → SR-12 の推奨に従い `blob:` を個別許可
- **`data:changed` 通知ストーム**: import 時の大量通知
  → PKC2 側でバッチング + debounce、ツール側で受信頻度制限
- **PKC2 のビルド差異**: pkc2.html のバージョンで capability が異なる
  → 起動時に `ping` で capability を取得し、未対応機能は graceful degrade

## 受け渡し可能な単体 HTML になる保証

- ビルド成果物は `dist/graph-navigator.html` / `dist/graph-navigator-embed.html` の 2 ファイルのみ
- それぞれがダブルクリックで動作
- embedded 版は同一ディレクトリに `pkc2.html` を置けば動作（`?pkc2_src=...` で別パスも可）
- CDN アクセスなし、完全オフライン動作

## 実装順序の推奨

1. **本リポジトリで Phase 1 (standalone) 完成** → 単一 HTML 動作確認
2. **PKC2 本体へ SR-5 実装 PR** (navigate 受信ハンドラ)
3. **本リポジトリで Phase 2 (embedded)** → SR-5 のみで MVP 動作
4. ユーザーレビュー → SR-16 / SR-17 の必要性・仕様の合意
5. **PKC2 本体へ SR-16 / SR-17 実装 PR**
6. **本リポジトリで Phase 3** → 通知受信で自動追従
7. **Phase 4** で仕上げ
