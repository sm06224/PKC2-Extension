/**
 * テスト用の最小 ZIP ライタ(stored / deflate)。shared/zip.ts のリーダーが
 * 参照するフィールドのみ埋める(CRC は 0 のまま — リーダーは検証しない)。
 */
import { deflateRawSync } from 'node:zlib';

export interface ZipInput {
  name: string;
  data: Uint8Array | string;
  deflate?: boolean;
}

export function makeZip(files: ZipInput[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const nameB = enc.encode(f.name);
    const comp = f.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = f.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameB.length + comp.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    local.set(comp, 30 + nameB.length);
    locals.push(local);

    const cd = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameB, 46);
    centrals.push(cd);

    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let o = 0;
  for (const p of [...locals, ...centrals, eocd]) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
