# SR-11. broadcast / multicast の整理

**問題**: `target_id = null` が broadcast を意味するが、
複数 PKC2 が埋め込まれた親ページで誰が処理したか追えない。

**案**:
- broadcast 受信時の返信には必ず `target_id` を明示（pong / ack はユニキャスト）
- 親ページが hub として中継するケースを標準動作として文書化
- `source_id` の重複検出で二重処理を防ぐ
