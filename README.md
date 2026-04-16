# PKC2 Extensions

PKC2 の **PKC-Message** プロトコル (`pkc-message` v1) を使う **単一 HTML ツール集**。

各ツールは PKC2 HTML ファイル (`pkc2.html`) を iframe に埋め込み、`postMessage` 経由で `record:offer` / `export:request` / `ping` などのメッセージをやり取りする。

また、PKC2 に添付されたファイル（メール / Word / PowerPoint / 画像 / 図など）を **オフラインで閲覧・編集** するためのビューア / エディタ群も対象とする。

## Status

**Phase 0 — Ideation** 中。実装に入る前に、まずツールのアイデアと PKC-Message 仕様の改定案を整理する。

## Documentation

- [IDEAS.md](./IDEAS.md) — カテゴリ別インデックス
- [ideas/00-spec-revisions.md](./ideas/00-spec-revisions.md) — PKC-Message 仕様改定案 (SR-1 〜 SR-15)
- [ideas/A-debugging.md](./ideas/A-debugging.md) — Debugging / Inspection ツール
- [ideas/B-record-input.md](./ideas/B-record-input.md) — Record Input ツール
- [ideas/C-record-output.md](./ideas/C-record-output.md) — Record Output ツール
- [ideas/D-multi-pkc.md](./ideas/D-multi-pkc.md) — Multi-PKC / Bridge ツール
- [ideas/E-specialized.md](./ideas/E-specialized.md) — 専門ユース向けツール
- [ideas/F-file-viewers.md](./ideas/F-file-viewers.md) — **オフライン添付ビューア / リッチエディタ** (Word, PowerPoint, Mail, Mermaid, draw.io)

## Branch

開発ブランチ: `claude/pkc-message-extensions-NmYE2`

## 参照仕様 (PKC2 本体)

- `docs/planning/14_基盤方針追補_clone_embed_message.md` — PKC-Message 契約の原典
- `src/core/model/message.ts` — `MessageEnvelope` / `MessageType` 定義
- `src/adapter/transport/` — bridge / envelope / profile / handler 実装

> PKC2 本体リポジトリは **このリポジトリでは変更しない**。改定案は本リポジトリの ideas/ に記載する。
