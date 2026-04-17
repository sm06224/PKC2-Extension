# SR-4. `record:ack`（受理前の到達確認）

**問題**: `record:offer` 送信後、`record:accept` はユーザ操作まで届かない。
到達 / 保留中 / 却下の区別がつかない。

**案**: 新メッセージ型 `record:ack` を追加。
bridge は offer を pendingOffers に積んだ瞬間に自動送信する。

ステートマシン:
```
record:offer
  → record:ack (bridge が自動送信)
  → record:accept または record:reject (ユーザ操作後)
```
