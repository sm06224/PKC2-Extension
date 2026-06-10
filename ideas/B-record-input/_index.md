# B. Record Input ツール

PKC2 に `record:offer` でデータを送り込むツール群。
汎用 composer (B1) を筆頭に、特定アーキタイプ向けの専門 UI を 15 種類提供する。

## 使用する PKC-Message 型

```ts
'record:offer'              // エントリ送信
'record:accept' | 'record:reject'  // 応答
'record:ack'                // SR-4: 到達確認
```

共通 payload:
```ts
interface RecordOfferPayload {
  title: string;
  body: string;
  archetype?: ArchetypeId;
  source_container_id?: string;
  tags?: string[];           // SR-8
  assets?: Record<string, string>; // SR-8
}
```

## ツール一覧

| # | Name | archetype | 優先度 |
|---|------|-----------|-------|
| B1 | [record-offer-composer](B01-record-offer-composer.md) | any | Tier 1 |
| B2 | [todo-quick-sender](B02-todo-quick-sender.md) | todo | Tier 1 |
| B3 | [textlog-journaler](B03-textlog-journaler.md) | textlog | Tier 2 |
| B4 | [web-clipper](B04-web-clipper.md) | text | Tier 2 |
| B5 | [clipboard-watcher](B05-clipboard-watcher.md) | text | Tier 3 |
| B6 | [csv-importer](B06-csv-importer.md) | any | Tier 2 |
| B7 | [markdown-batch](B07-markdown-batch.md) | text | Tier 3 |
| B8 | [bookmark-importer](B08-bookmark-importer.md) | text | Tier 3 |
| B9 | [rss-fetcher](B09-rss-fetcher.md) | text | Tier 3 |
| B10 | [qr-scanner](B10-qr-scanner.md) | text | Tier 3 |
| B11 | [voice-memo](B11-voice-memo.md) | textlog | Tier 3 |
| B12 | [screenshot-attacher](B12-screenshot-attacher.md) | attachment | Tier 3 |
| B13 | [pomodoro-logger](B13-pomodoro-logger.md) | textlog | Tier 3 |
| B14 | [daily-log-starter](B14-daily-log-starter.md) | textlog | Tier 3 |
| B15 | [form-template](B15-form-template.md) | form | Tier 3 |
