/**
 * D7 remote-collab — WebRTC トランスポート(browser 専用、方式 S1 = サーバーレス
 * 手動シグナリング + public STUN)。
 *
 * シグナリングはサーバーレス: SDP(offer/answer)を相互にコピペ。ICE は
 * 非 trickle(gathering 完了まで待って SDP に同梱)。STUN は IP 発見のみで、
 * 本文(DataChannel)は peer 直結 = サーバーを通らない。
 *
 * happy-dom に WebRTC は無いため本モジュールは単体テストしない(壁 #71)。
 * プロトコル/配線は collab.ts(pure)+ main の fake transport テストで担保。
 */

import type { CollabTransport } from './collab';

export const STUN_URL = 'stun:stun.l.google.com:19302';

export interface CollabPeer {
  transport: CollabTransport;
  /** host: 招待コード(offer SDP)を作る。 */
  createInvite(): Promise<string>;
  /** host: 相手の応答コード(answer SDP)を受ける。 */
  acceptAnswer(answerCode: string): Promise<void>;
  /** guest: 招待コードから応答コード(answer SDP)を作る。 */
  acceptInvite(inviteCode: string): Promise<string>;
  close(): void;
}

function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** WebRTC peer を作る。useStun=false なら STUN なし(同一 LAN / 検証向け)。 */
export function createCollabPeer(useStun: boolean): CollabPeer {
  const pc = new RTCPeerConnection({ iceServers: useStun ? [{ urls: STUN_URL }] : [] });
  let channel: RTCDataChannel | null = null;
  let msgCb: ((d: string) => void) | null = null;
  let openCb: (() => void) | null = null;
  let closeCb: (() => void) | null = null;

  const wire = (ch: RTCDataChannel): void => {
    channel = ch;
    ch.onmessage = (e): void => msgCb?.(String(e.data));
    ch.onopen = (): void => openCb?.();
    ch.onclose = (): void => closeCb?.();
  };
  // guest 側は host が作った channel を受け取る
  pc.ondatachannel = (e): void => wire(e.channel);

  const transport: CollabTransport = {
    send: (data) => {
      if (channel && channel.readyState === 'open') channel.send(data);
    },
    onMessage: (cb) => { msgCb = cb; },
    onOpen: (cb) => { openCb = cb; },
    onClose: (cb) => { closeCb = cb; },
    close: () => pc.close(),
  };

  return {
    transport,
    async createInvite() {
      wire(pc.createDataChannel('pkc-collab'));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      return JSON.stringify(pc.localDescription);
    },
    async acceptAnswer(answerCode) {
      const desc = JSON.parse(answerCode) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(desc);
    },
    async acceptInvite(inviteCode) {
      const desc = JSON.parse(inviteCode) as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      return JSON.stringify(pc.localDescription);
    },
    close() {
      pc.close();
    },
  };
}
