/** Starter templates for each diagram type (F7 plan doc). */

export const TEMPLATES: ReadonlyArray<{ label: string; code: string }> = [
  {
    label: 'Flowchart',
    code: `graph TD
  A[開始] --> B{条件?}
  B -- はい --> C[処理 1]
  B -- いいえ --> D[処理 2]
  C --> E[終了]
  D --> E`,
  },
  {
    label: 'Sequence',
    code: `sequenceDiagram
  participant Ext as 拡張ツール
  participant PKC as PKC2
  Ext->>PKC: ping
  PKC-->>Ext: pong (PongProfile)
  Ext->>PKC: record:offer
  Note over PKC: user が accept`,
  },
  {
    label: 'Class',
    code: `classDiagram
  class Container {
    +entries: Entry[]
    +relations: Relation[]
  }
  class Entry {
    +lid: string
    +title: string
    +body: string
  }
  Container "1" o-- "*" Entry`,
  },
  {
    label: 'Gantt',
    code: `gantt
  title 計画
  dateFormat YYYY-MM-DD
  section 実装
  設計        :a1, 2026-06-10, 2d
  実装        :after a1, 3d
  レビュー     :2d`,
  },
  {
    label: 'State',
    code: `stateDiagram-v2
  [*] --> initializing
  initializing --> ready
  ready --> editing
  editing --> ready
  ready --> [*]`,
  },
  {
    label: 'ER',
    code: `erDiagram
  CONTAINER ||--o{ ENTRY : has
  ENTRY ||--o{ RELATION : from
  ENTRY {
    string lid
    string title
  }`,
  },
  {
    label: 'Pie',
    code: `pie title 内訳
  "A" : 45
  "B" : 30
  "C" : 25`,
  },
];
