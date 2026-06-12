/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { listZip, readZip, readZipFile } from '../../tools/shared/zip';
import { makeZip } from '../helpers/make-zip';

const dec = new TextDecoder();

describe('listZip / readZip', () => {
  it('stored と deflate の両方を列挙・展開できる', async () => {
    const zip = makeZip([
      { name: 'a.txt', data: 'hello stored' },
      { name: 'dir/b.xml', data: '<x>こんにちは</x>'.repeat(50), deflate: true },
    ]);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.xml']);
    expect(entries[0]?.method).toBe(0);
    expect(entries[1]?.method).toBe(8);

    const a = await readZip(zip, entries[0]!);
    expect(dec.decode(a!)).toBe('hello stored');
    const b = await readZip(zip, entries[1]!);
    expect(dec.decode(b!)).toBe('<x>こんにちは</x>'.repeat(50));
  });

  it('readZipFile は名前完全一致で引く(無ければ null)', async () => {
    const zip = makeZip([{ name: 'xl/workbook.xml', data: '<workbook/>', deflate: true }]);
    expect(dec.decode((await readZipFile(zip, 'xl/workbook.xml'))!)).toBe('<workbook/>');
    expect(await readZipFile(zip, 'nope.xml')).toBeNull();
  });

  it('ZIP でない入力・空入力は [] / null(throw しない)', async () => {
    expect(listZip(new Uint8Array(0))).toEqual([]);
    expect(listZip(new TextEncoder().encode('not a zip at all, just text'))).toEqual([]);
    expect(await readZipFile(new Uint8Array([1, 2, 3]), 'x')).toBeNull();
  });

  it('未対応 compression method は null', async () => {
    const zip = makeZip([{ name: 'a', data: 'x' }]);
    const e = { ...listZip(zip)[0]!, method: 99 };
    expect(await readZip(zip, e)).toBeNull();
  });
});
