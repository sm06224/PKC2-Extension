/**
 * 依存ゼロの最小 ZIP リーダー(F3/F4/F5 の Office Open XML 用)。
 *
 * 対応: central directory 走査 / stored(0)/ deflate(8、`DecompressionStream`
 * — Chrome 80+ / Firefox 113+ / Safari 16.4+ / Node 18+)。
 * 非対応(明示): ZIP64 / 暗号化 / data descriptor のみのサイズ(central
 * directory の値を正とする)/ CRC 検証(整合しない XML は後段の DOMParser
 * が落とすため二重検証しない)。
 *
 * 防御: entry 数・展開サイズに上限。壊れた入力では throw せず [] / null。
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  headerOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const MAX_ENTRIES = 4096;
/** 1 entry の展開上限(Office XML には十分、zip bomb 防御)。 */
const MAX_UNCOMPRESSED = 64 * 1024 * 1024;

/** central directory を列挙。ZIP でなければ []。Pure. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const scanEnd = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanEnd; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const nameDecoder = new TextDecoder('utf-8', { fatal: false });
  for (let i = 0; i < count && i < MAX_ENTRIES; i++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(off + 10, true);
    const compressedSize = view.getUint32(off + 20, true);
    const uncompressedSize = view.getUint32(off + 24, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const headerOffset = view.getUint32(off + 42, true);
    const name = nameDecoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, headerOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** raw deflate を展開(cap 超過 / 破損は null)。drawio 圧縮形式でも使用。 */
export async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array | null> {
  try {
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(data.slice());
        c.close();
      },
    });
    // lib.dom の DecompressionStream は BufferSource 型で pipeThrough と噛み合わないため明示
    const ds = new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>;
    const reader = src.pipeThrough(ds).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** entry を展開。未対応 method / 破損 / 上限超過は null。 */
export async function readZip(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array | null> {
  if (e.uncompressedSize > MAX_UNCOMPRESSED) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = e.headerOffset;
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOCAL) return null;
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  if (start + e.compressedSize > bytes.length) return null;
  const data = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.slice();
  if (e.method === 8) return inflateRaw(data, MAX_UNCOMPRESSED);
  return null;
}

/** 名前指定の展開(完全一致)。無ければ null。 */
export async function readZipFile(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const e = listZip(bytes).find((x) => x.name === name);
  return e ? readZip(bytes, e) : null;
}
