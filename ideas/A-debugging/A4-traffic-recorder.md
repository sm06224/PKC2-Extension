# A4. traffic-recorder（全メッセージキャプチャ → JSON 保存）

**目的**: PKC-Message トラフィックをセッション全体にわたって記録し、
JSON ファイルとしてダウンロードする。A5 replay-player の入力データを生成する。

**メッセージフロー**: パッシブリスナーのみ。ツール自身はメッセージを送信しない。

**UI 概要**:

- トップバー: 「Start/Stop Recording」トグル、経過時間、メッセージ数
- メイン: キャプチャ済みメッセージのライブフィード
- 下部: 「Download JSON」「Clear」ボタン

**ダウンロードファイル形式**:

```json
[
  {
    "envelope": { "protocol": "pkc-message", ... },
    "event_origin": "http://localhost:...",
    "captured_at": "2026-04-17T10:30:00.123Z"
  }
]
```

**実装ノート**:

- キャプチャ配列はメモリ内保持
- ダウンロード: `Blob` + `URL.createObjectURL` + 一時 `<a>` click
- ファイル名: `pkc-traffic-{ISO date}.json`
- 10,000 エントリ超過時にメモリ警告

**SR 依存**: SR-1 (リプレイの決定性向上)、SR-7 (ストレステスト)

**優先度**: Tier 2
