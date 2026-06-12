/**
 * pkc-ext v1 — child (extension) side of the host-push channel
 * (PKC2#806 rev.2 / host implementation PKC2#816-818).
 *
 * Wire (NOT PKC-Message envelopes — a generalized bespoke channel like the
 * old graph one):
 *   ext  → host  { pkc:'pkc-ext', v:1, t:'hello' }                    (handshake)
 *   host → ext   { pkc, v, nonce, t:'projection', projection }        (既定露出)
 *   host → ext   { pkc, v, nonce, t:'deliver', payload }              (send ジェスチャの実体)
 *   ext  → host  { pkc, v, nonce, t:'write', lid?, ops, correlation_id? }   (T2)
 *   host → ext   { pkc, v, nonce, t:'write-result', ok, correlation_id }
 *   ext  → host  { pkc, v, nonce, t:'hint', kind, lid? }              (軽量ヒント、pull ではない)
 *
 * Security (graph と同じ primitive — PKC2#796 の opaque 移行を生存):
 *  - host は最初の有効メッセージで判明する window(opener/parent)に固定し、
 *    `event.source` の同一性で検証(偽造不能)
 *  - origin は `location.origin` 一致(file:// 等の opaque は両者 'null' で一致)
 *  - nonce は最初の有効な host メッセージから pin し、以後の受信で必須・
 *    送信(write/hint)に同梱
 *  - 受信 payload は型ガードで防御的にパース。描画は呼び出し側の責務
 *    (textContent 規律)
 */

/** ホスト実装(features/extension-host/projection.ts)のミラー。 */
export interface ProjectionEntry {
  lid: string;
  title: string;
  archetype: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  color_tag?: string | null;
  folder?: string;
  mime?: string;
  filename?: string;
  asset_size?: number;
}

export interface ProjectionStats {
  totalEntries: number;
  byArchetype: Record<string, number>;
  totalRelations: number;
  totalAssets: number;
}

export interface ContainerProjection {
  containerId: string;
  title: string;
  entries: ProjectionEntry[];
  relations: { from: string; to: string; kind: string }[];
  stats: ProjectionStats;
}

/** ホスト実装(features/extension-host/deliver.ts)のミラー。 */
export interface DeliverPayload {
  kind: 'asset' | 'entry';
  lid?: string;
  asset_key?: string;
  mime?: string;
  filename?: string;
  body?: string;
  data_base64?: string;
  correlation_id?: string;
}

export const PKC_EXT = 'pkc-ext';
export const PKC_EXT_V = 1;

/** 防御的 parse: projection らしき値を最小検証で受け入れる。 */
export function parseProjection(v: unknown): ContainerProjection | null {
  if (v === null || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p['containerId'] !== 'string' || !Array.isArray(p['entries'])) return null;
  return {
    containerId: p['containerId'],
    title: typeof p['title'] === 'string' ? p['title'] : '',
    entries: (p['entries'] as unknown[]).filter(isProjectionEntry),
    relations: Array.isArray(p['relations'])
      ? (p['relations'] as unknown[]).filter(isRelation)
      : [],
    stats: isStats(p['stats'])
      ? (p['stats'] as ProjectionStats)
      : { totalEntries: 0, byArchetype: {}, totalRelations: 0, totalAssets: 0 },
  };
}

function isProjectionEntry(v: unknown): v is ProjectionEntry {
  if (v === null || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e['lid'] === 'string' && typeof e['title'] === 'string' && typeof e['archetype'] === 'string';
}

function isRelation(v: unknown): v is { from: string; to: string; kind: string } {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['from'] === 'string' && typeof r['to'] === 'string' && typeof r['kind'] === 'string';
}

function isStats(v: unknown): boolean {
  return v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>)['totalEntries'] === 'number';
}

/** 防御的 parse: deliver payload。 */
export function parseDeliver(v: unknown): DeliverPayload | null {
  if (v === null || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (d['kind'] !== 'asset' && d['kind'] !== 'entry') return null;
  const out: DeliverPayload = { kind: d['kind'] };
  for (const k of ['lid', 'asset_key', 'mime', 'filename', 'body', 'data_base64', 'correlation_id'] as const) {
    if (typeof d[k] === 'string') out[k] = d[k] as string;
  }
  return out;
}

export interface ExtChannelCallbacks {
  onProjection?: (p: ContainerProjection) => void;
  onDeliver?: (d: DeliverPayload) => void;
  onWriteResult?: (ok: boolean, correlationId: string | null) => void;
}

/**
 * 子(拡張)側チャネル。`start()` が false なら standalone(ホストなし)。
 * `attach()` / `handleMessage()` はテストおよび特殊トポロジ用に公開。
 */
export class ExtChannel {
  private host: Window | null = null;
  private nonce: string | null = null;

  constructor(private readonly cb: ExtChannelCallbacks) {}

  /** opener / parent をホストとして handshake を開始。 */
  start(): boolean {
    let opener: Window | null = null;
    try {
      opener = window.opener as Window | null;
    } catch {
      opener = null;
    }
    const host = opener ?? (window.parent !== window ? window.parent : null);
    if (!host) return false;
    this.attach(host);
    return true;
  }

  /** ホスト window を固定し hello を送る(テストからも使用)。 */
  attach(host: Window): void {
    this.host = host;
    window.addEventListener('message', (ev) => this.handleMessage(ev));
    try {
      host.postMessage({ pkc: PKC_EXT, v: PKC_EXT_V, t: 'hello' }, targetOrigin());
    } catch {
      /* host torn down */
    }
  }

  /** T2: 書き戻し要求。channel 未確立なら false。 */
  sendWrite(ops: unknown[], lid?: string, correlationId?: string): boolean {
    return this.post({
      t: 'write',
      ops,
      ...(lid !== undefined ? { lid } : {}),
      ...(correlationId !== undefined ? { correlation_id: correlationId } : {}),
    });
  }

  /** 軽量ヒント(「この entry を開いて」等)。pull ではない。 */
  sendHint(kind: string, lid?: string): boolean {
    return this.post({ t: 'hint', kind, ...(lid !== undefined ? { lid } : {}) });
  }

  isEstablished(): boolean {
    return this.nonce !== null;
  }

  private post(msg: Record<string, unknown>): boolean {
    if (!this.host || this.nonce === null) return false;
    try {
      this.host.postMessage({ pkc: PKC_EXT, v: PKC_EXT_V, nonce: this.nonce, ...msg }, targetOrigin());
      return true;
    } catch {
      return false;
    }
  }

  /** 受信処理(テストから ev 風オブジェクトで直接呼べる)。 */
  handleMessage(ev: Pick<MessageEvent, 'data' | 'origin' | 'source'>): void {
    // identity + origin(opaque 同士は 'null' === 'null' で一致)
    if (ev.source !== this.host) return;
    if (ev.origin !== window.location.origin && !(ev.origin === 'null' && window.location.origin === 'null')) return;
    const d = ev.data as Record<string, unknown> | null;
    if (!d || d['pkc'] !== PKC_EXT || d['v'] !== PKC_EXT_V) return;
    if (typeof d['nonce'] !== 'string') return;
    if (this.nonce === null) {
      // 最初の有効な host メッセージで nonce を pin(host は全送信に同梱)
      this.nonce = d['nonce'];
    } else if (d['nonce'] !== this.nonce) {
      return;
    }
    if (d['t'] === 'projection') {
      const p = parseProjection(d['projection']);
      if (p) this.cb.onProjection?.(p);
    } else if (d['t'] === 'deliver') {
      const payload = parseDeliver(d['payload']);
      if (payload) this.cb.onDeliver?.(payload);
    } else if (d['t'] === 'write-result') {
      this.cb.onWriteResult?.(d['ok'] === true, typeof d['correlation_id'] === 'string' ? d['correlation_id'] : null);
    }
  }
}

function targetOrigin(): string {
  const o = window.location.origin;
  return o && o !== 'null' ? o : '*';
}
