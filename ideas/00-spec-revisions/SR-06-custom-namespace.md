# SR-6. `custom` の名前空間付け

**問題**: `custom` は自由すぎてベンダー間衝突リスクがある。

**案**: `custom` envelope の payload 必須フィールド `ns: string` を義務化。
例: `'myorg.tool.foo'`。受信側は未知 `ns` を黙って破棄する。
