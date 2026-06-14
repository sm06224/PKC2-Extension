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
 * Security — 公式 graph 拡張(PKC2#823)と同じ TOFU gate:
 *  - **Tier S(sandbox 既定、PKC2#821)では host push の `ev.source` が
 *    parent と一致しない**(拡張は popup shell 内の sandboxed iframe で、
 *    push は host main window から直接届く)。そのため受信は
 *    「最初の有効な projection で source + nonce を pin」(TOFU)とし、
 *    以後は pin した source 同一性 + nonce 一致で検証する
 *  - origin は自分が非 opaque(Tier T same-origin popup)の場合のみ厳格比較。
 *    Tier S では自 origin が 'null'(opaque)になり比較が成立しない
 *  - 送信先は opener(Tier T)/ parent(Tier S の shell)。targetOrigin は
 *    自 origin が非 opaque ならそれに pin、opaque なら '*'
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
  mime?: string;
  filename?: string;
  asset_size?: number;
  /** 親 folder の lid(structural)。 */
  folder?: string;
  /**
   * archetype==='todo' のみ: host が body から派生(PKC2#831 / RFC #830 R1)。
   * **description は含まない**(data-minimization)。date/archived は値がある時のみ。
   */
  todo?: { status: 'open' | 'done'; date?: string; archived?: boolean };
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
  /** host 側の選択変更(`t:'selected'`、graph/filer が focus を追従)。 */
  onSelected?: (lid: string) => void;
}

/**
 * 子(拡張)側チャネル。`start()` が false なら standalone(ホストなし)。
 * `attach()` / `handleMessage()` はテストおよび特殊トポロジ用に公開。
 */
export class ExtChannel {
  /** 送信先(Tier T = opener / Tier S = shell parent)。 */
  private target: Window | null = null;
  /** TOFU で pin した host window(ev.source。Tier S では target と別)。 */
  private hostSource: unknown = null;
  private nonce: string | null = null;

  constructor(private readonly cb: ExtChannelCallbacks) {}

  /** opener / parent へ handshake を開始。 */
  start(): boolean {
    let opener: Window | null = null;
    try {
      opener = window.opener as Window | null;
    } catch {
      opener = null;
    }
    const target = opener ?? (window.parent !== window ? window.parent : null);
    if (!target) return false;
    this.attach(target);
    return true;
  }

  /** 送信先 window を固定し hello を送る(テストからも使用)。 */
  attach(target: Window): void {
    this.target = target;
    window.addEventListener('message', (ev) => this.handleMessage(ev));
    try {
      target.postMessage({ pkc: PKC_EXT, v: PKC_EXT_V, t: 'hello' }, targetOrigin());
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
    if (!this.target || this.nonce === null) return false;
    try {
      this.target.postMessage({ pkc: PKC_EXT, v: PKC_EXT_V, nonce: this.nonce, ...msg }, targetOrigin());
      return true;
    } catch {
      return false;
    }
  }

  /** 受信処理(テストから ev 風オブジェクトで直接呼べる)。 */
  handleMessage(ev: Pick<MessageEvent, 'data' | 'origin' | 'source'>): void {
    const d = ev.data as Record<string, unknown> | null;
    if (!d || d['pkc'] !== PKC_EXT || d['v'] !== PKC_EXT_V) return;
    if (typeof d['nonce'] !== 'string') return;
    // origin: 自分が非 opaque(Tier T same-origin)の場合のみ厳格比較できる
    const own = window.location.origin;
    if (own && own !== 'null' && ev.origin !== own) return;
    if (this.nonce === null) {
      // TOFU: 最初の有効な **projection** で host(source)+ nonce を pin。
      // Tier S では push の ev.source が parent と一致しないため(PKC2#821)、
      // 公式 graph 拡張(PKC2#823)と同じく最初の projection を信頼の起点にする。
      if (d['t'] !== 'projection') return;
      const p = parseProjection(d['projection']);
      if (!p) return;
      this.hostSource = ev.source;
      this.nonce = d['nonce'];
      this.cb.onProjection?.(p);
      return;
    }
    if (ev.source !== this.hostSource || d['nonce'] !== this.nonce) return;
    if (d['t'] === 'projection') {
      const p = parseProjection(d['projection']);
      if (p) this.cb.onProjection?.(p);
    } else if (d['t'] === 'deliver') {
      const payload = parseDeliver(d['payload']);
      if (payload) this.cb.onDeliver?.(payload);
    } else if (d['t'] === 'write-result') {
      this.cb.onWriteResult?.(d['ok'] === true, typeof d['correlation_id'] === 'string' ? d['correlation_id'] : null);
    } else if (d['t'] === 'selected') {
      if (typeof d['lid'] === 'string') this.cb.onSelected?.(d['lid']);
    }
  }
}

function targetOrigin(): string {
  const o = window.location.origin;
  return o && o !== 'null' ? o : '*';
}
