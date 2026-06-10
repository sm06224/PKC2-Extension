# SR-5. `navigate` の payload 仕様化

**問題**: 現在はコメントしかない。何を送れば何が起こるか未定義。

**案**:

```ts
interface NavigatePayload {
  view?: 'detail' | 'calendar' | 'kanban'; // 画面モード遷移
  select_lid?: string;                      // 特定エントリを選択
  edit?: boolean;                           // 編集モードに入るか
}
```

`navigate` は embedded 時のみ有効（親から埋め込み PKC2 を操作する用途）。
