# D7. remote-collab（WebRTC 緩衝ブリッジ）— 設計 doc

**issue**: （本 doc 起票）／ **トラッキング**: #110 ／ **状態**: 設計（実装は方針確定後）

**目的**: 拡張を **緩衝地帯（trust boundary）** として、**WebRTC** でリモート PKC2 の
**"一部"（共有スペース）に参加**する。D1–D6 のローカル iframe ハブとは別系統 = **リモート P2P**。

---

## 1. アーキテクチャ

```
ローカル PKC2 host ─pkc-ext─ 拡張A(緩衝) ═══ WebRTC DataChannel(P2P) ═══ 拡張B(緩衝) ─pkc-ext─ リモート PKC2 host
```

- 各 peer は自分の PKC2 から拡張を Tier S sandbox で起動。**拡張同士が WebRTC で直接 P2P 接続**。
- 拡張は sandbox なのでホスト DOM / IDB / localStorage に構造的に触れない。
  - **ローカルへの反映**は **propose（R5、同意 banner で accept→mint）経由のみ**。
  - **共有に出せる**のは **ユーザーが send ジェスチャ（deliver）で拡張へ渡した entry だけ**。
- → リモートは「あなたが共有した一部」しか見えず、あなたの PKC2 を**勝手に書けない**（propose 同意必須）。
  これが「**一部に参加**」と「**緩衝地帯**」の実装そのもの。

## 2. 共有モデル（「一部」の意味）

- **共有スペース** = この接続セッションで出し合った entry 集合（セッションスコープ・接続ごとにリセット）。
- **out（共有に出す）**: ユーザーが deliver で拡張へ渡した entry を共有リストに載せ、DataChannel で送る。出していないものは一切流れない（opt-in）。
- **in（受信）**: リモートが共有した entry は拡張の **受信バッファ**に入る（まだローカル PKC2 には入らない）。ユーザーが「取り込み」→ **propose（同意 banner）**で初めてローカル化。
- 本文（body）は DataChannel を流れるが、**ローカル PKC2 へは同意経由でしか入らない**。

## 3. WebRTC トランスポート

- `RTCPeerConnection` + `RTCDataChannel`（ordered / reliable）。メッセージは JSON（共有 entry / プレゼンス / 軽いチャット）。
- **シグナリング（SDP offer/answer + ICE 交換）の選択肢**:
  - **S1) サーバーレス手動**: SDP を相互にコピペ（テキスト/QR）。インフラゼロ・規律最小。STUN（public、例 `stun.l.google.com:19302`）で NAT 補助。relay なし（対称 NAT 下は不通の場合あり）。← **v1 推奨**
  - S2) シグナリングサーバー: 部屋 ID で自動マッチ。外部インフラ運用が要る。将来。
  - S3) TURN relay: NAT 困難ケースの中継。外部インフラ。将来。
- データは P2P（peer 間直結）。TURN 不使用なら**本文はサーバーを通らない**（STUN は IP 発見のみ）。

## 4. セキュリティ / 規律

- WebRTC は外部通信（H2 に続く 2 例目）。**接続先 peer・使用 STUN を明示表示**、未接続が既定。
- リモート由来の entry は **untrusted**: 描画は `textContent`、ローカル化は **propose 同意必須**（自動取り込みなし）。
- 共有は **opt-in**（deliver で渡したものだけ）。接続終了で共有リスト・受信バッファをクリア。
- peer 表示名はユーザー入力。**本格的な認証/暗号化検証は v1 では非対応**（手動シグナリングのコピペ経路自体が帯域外確認になる。WebRTC は DTLS で輸送暗号化済み）。
- キー/秘密は持たない（API キー等は無い）。

## 5. PKC2 本体との関係

- **本体 PKC2 変更は不要**。pkc-ext の `deliver`（共有に出す実体の受信）/ `propose`（取り込み）/ `projection`（接続確認・タイトル解決）で成立。
- 注意: projection には body が来ないため、「共有に出す」には**実体が要る → send ジェスチャ（deliver）でその都度渡す**。現状 1 ジェスチャ = 1 件。複数まとめて共有する UX が要るなら「複数 deliver」を #830 系で論点化（v1 はブロッカーにしない）。

## 6. v1 スコープ（決定済み 2026-06-15）

- **方向**: **D-a 双方向共有スペース**（両者が出し合い、取り込みは各自 propose 同意）。← 決定
- **シグナリング**: **S1 サーバーレス手動 + public STUN**（インフラゼロ・規律最小）。← 既定採用（後で S2/S3 拡張可）
- 含む: 接続(手動 SDP コピペ)・共有プール(out, deliver した entry を per-item トグルで共有)・受信バッファ(in)→propose 取り込み・プレゼンス(hello)・外部通信の明示。
- **やらない（v1）**: 自動シグナリングサーバー / TURN relay / リアルタイム共同編集（同一 entry の同時編集マージ）/ 認証 / 多 peer（v1 は 1:1）/ attachment 実体の共有（asset は転送しない＝テキスト系 entry のみ）。

## 7. 決定（ユーザー判断 2026-06-15）

1. シグナリング = **S1 サーバーレス手動 + STUN**。
2. 方向 = **双方向(D-a)**。

## 8. 依存

- pkc-ext: `deliver` / `propose`(R5) / `projection`。
- ブラウザ: WebRTC（`RTCPeerConnection` / `RTCDataChannel`）。
- shared: `ext-channel`（propose 済み）/ `envelope`(cid/cap) / `ui` / `help`。
- 注: happy-dom に WebRTC は無い → トランスポートは抽象 seam を切り、テストは fake transport で「共有/受信/取り込み(propose)」の配線を parity 検証。実 WebRTC 疎通はユーザー実機（壁 #71）。
