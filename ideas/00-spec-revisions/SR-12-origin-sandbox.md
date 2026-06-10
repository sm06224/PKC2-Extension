# SR-12. origin / sandbox 境界の契約化

**問題**: `allowedOrigins` を空にすると全許容という挙動だが、セキュリティ推奨値が不明。

**案**:
- standalone: `allowedOrigins: []`（any）を許容
- embedded: 親ページの origin を `allowedOrigins` にセットすることを推奨
- blob URL iframe の origin は `null` になりがちなので、`blob:` / `data:` / `null` を個別に許容するフラグを追加
