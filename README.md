# PKC2 Extensions

PKC2 の **PKC-Message** プロトコル (`pkc-message` v1) を使う **単一 HTML ツール集**。

各ツールは PKC2 HTML ファイル (`pkc2.html`) を iframe に埋め込み、`postMessage` 経由で `record:offer` / `export:request` / `ping` などのメッセージをやり取りする。

## Status

**Phase 0 — Ideation** 中。実装に入る前に、まずツールのアイデアと PKC-Message 仕様の改定案を整理する。

詳細は [IDEAS.md](./IDEAS.md) を参照。

## Branch

開発ブランチ: `claude/pkc-message-extensions-NmYE2`

## 参照仕様 (PKC2 本体)

- `docs/planning/14_基盤方針追補_clone_embed_message.md` — PKC-Message 契約の原典
- `src/core/model/message.ts` — `MessageEnvelope` / `MessageType` 定義
- `src/adapter/transport/` — bridge / envelope / profile / handler 実装

> PKC2 本体リポジトリは **このリポジトリでは変更しない**。改定案は本リポジトリの IDEAS.md に記載する。
