# SR-2. `correlation_id` で request/response を紐付け

**問題**: `export:request` を複数並行送信すると、返ってくる `export:result` がどのリクエストに対応するか不明。

**案**: 任意フィールド `correlation_id?: string`。
response 送信側は受信 envelope の `message_id` を `correlation_id` にセットして返す。
