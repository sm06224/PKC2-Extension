# F. オフライン添付ビューア / リッチエディタ

PKC2 の attachment archetype に保存された各種ファイルを
**完全オフラインで閲覧・編集** する単一 HTML ツール群。

メモ能力強化のため Mermaid / draw.io 等のダイアグラム編集も含む。
**ユーザーが最も重視するカテゴリ**であり、メール / Word / PowerPoint の
オフライン表示が中心的な要件。

## ファイル取得フロー

```
1. F1 (attachment-browser) が PKC2 から attachment 一覧を取得
2. MIME type に基づき適切なビューア (F2-F10) を起動
3. ビューアは asset データ (base64) を受け取りローカルでレンダリング
```

取得方法:
- `export:request` → `export:result` (container 全体、重い)
- SR-15 `asset:request` → `asset:result` (単一 asset、軽い)

## ライブラリバンドル戦略

CDN 参照禁止（オフライン要件）。全ライブラリを HTML 内にインライン埋め込み。

| ビューア | ライブラリ | サイズ (min+gzip) | ライセンス |
|---------|----------|------------------|-----------|
| F2 email | postal-mime | ~15KB | MIT |
| F3 docx | mammoth.js | ~30KB | MIT |
| F4 pptx | JSZip + 自作パーサー | ~120KB | MIT |
| F5 xlsx | SheetJS mini | ~150KB | Apache-2.0 |
| F6 pdf | PDF.js | ~500KB | Apache-2.0 |
| F7 mermaid | mermaid.js | ~300KB | MIT |
| F8 drawio | 自作 XML パーサー | ~50KB | — |
| F10 canvas | Canvas API | 0KB | — |

## ツール一覧

| # | Name | 対象形式 | 優先度 |
|---|------|---------|-------|
| F1 | [attachment-browser](F01-attachment-browser.md) | * | Tier 2 |
| F2 | [email-viewer](F02-email-viewer.md) | eml/msg | **Tier 2** ★ |
| F3 | [docx-viewer](F03-docx-viewer.md) | docx | **Tier 3 早期** ★ |
| F4 | [pptx-viewer](F04-pptx-viewer.md) | pptx | Tier 3 ★ |
| F5 | [xlsx-viewer](F05-xlsx-viewer.md) | xlsx | Tier 3 |
| F6 | [pdf-viewer](F06-pdf-viewer.md) | pdf | Tier 3 |
| F7 | [mermaid-editor](F07-mermaid-editor.md) | text/svg | **Tier 2** ★ |
| F8 | [drawio-editor](F08-drawio-editor.md) | drawio/xml | Tier 3 |
| F9 | [markdown-mermaid-note](F09-markdown-mermaid-note.md) | text/md | Tier 3 |
| F10 | [canvas-sketcher](F10-canvas-sketcher.md) | svg/png | Tier 3 |

★ = ユーザーの重点要件
