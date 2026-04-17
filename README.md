# PKC2 Extensions

PKC2 の **PKC-Message** プロトコル (`pkc-message` v1) を使う **単一 HTML ツール集**。

各ツールは PKC2 HTML ファイル (`pkc2.html`) を iframe に埋め込み、`postMessage` 経由で `record:offer` / `export:request` / `ping` などのメッセージをやり取りする。

また、PKC2 に添付されたファイル（メール / Word / PowerPoint / 画像 / 図など）を **オフラインで閲覧・編集** するためのビューア / エディタ群も対象とする。

## Status

**Phase 0 — Ideation** 中。実装に入る前に、まずツールのアイデアと PKC-Message 仕様の改定案を整理する。

## Documentation

- [IDEAS.md](./IDEAS.md) — カテゴリ別インデックス
- [ideas/00-spec-revisions/](./ideas/00-spec-revisions/) — PKC-Message 仕様改定案 (SR-1 〜 SR-15、個別ファイル)
- [ideas/A-debugging/](./ideas/A-debugging/) — Debugging / Inspection ツール (A1-A5)
- [ideas/B-record-input/](./ideas/B-record-input/) — Record Input ツール (B1-B15)
- [ideas/C-record-output/](./ideas/C-record-output/) — Record Output ツール (C1-C8)
- [ideas/D-multi-pkc/](./ideas/D-multi-pkc/) — Multi-PKC / Bridge ツール (D1-D6)
- [ideas/E-specialized/](./ideas/E-specialized/) — 専門ユース向けツール (E1-E7)
- [ideas/F-file-viewers/](./ideas/F-file-viewers/) — **オフライン添付ビューア / リッチエディタ** (F1-F10)

## Branch

開発ブランチ: `claude/pkc-message-extensions-NmYE2`

## 参照仕様 (PKC2 本体)

- `docs/planning/14_基盤方針追補_clone_embed_message.md` — PKC-Message 契約の原典
- `src/core/model/message.ts` — `MessageEnvelope` / `MessageType` 定義
- `src/adapter/transport/` — bridge / envelope / profile / handler 実装

> PKC2 本体リポジトリは **このリポジトリでは変更しない**。改定案は本リポジトリの ideas/ に記載する。
