/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { colIndex, colLetter, gridToCsv, openXlsx, sheetGrid } from '../../tools/f5-xlsx-viewer/src/xlsx';
import { pickXlsxEntries } from '../../tools/f5-xlsx-viewer/src/main';
import type { ContainerProjection } from '../../tools/shared/ext-channel';
import { makeZip } from '../helpers/make-zip';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fixtureXlsx(): Uint8Array {
  return makeZip([
    {
      name: 'xl/workbook.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="売上" sheetId="1" r:id="rId1"/>
    <sheet name="メモ" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      deflate: true,
      data: `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>品目</t></si>
  <si><r><t>りん</t></r><r><t>ご</t></r><rPh sb="0" eb="3"><t>リンゴ</t></rPh></si>
  <si><t>金額</t></si>
</sst>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>1</v></c>
      <c r="B3" t="b"><v>1</v></c>
      <c r="C3"><v>1280</v></c>
      <c r="D3" t="inlineStr"><is><t>備考</t></is></c>
    </row>
  </sheetData>
</worksheet>`,
    },
    {
      name: 'xl/worksheets/sheet2.xml',
      deflate: true,
      data: '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
    },
  ]);
}

describe('colIndex / colLetter', () => {
  it('往復が一致する', () => {
    expect(colIndex('A1')).toBe(0);
    expect(colIndex('Z9')).toBe(25);
    expect(colIndex('AA10')).toBe(26);
    expect(colIndex('BC12')).toBe(54);
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(54)).toBe('BC');
  });
});

describe('openXlsx / sheetGrid', () => {
  it('シート名と rels 解決、shared strings(rPh 除外)', async () => {
    const file = await openXlsx(fixtureXlsx());
    expect(file).not.toBeNull();
    expect(file!.sheets.map((s) => s.name)).toEqual(['売上', 'メモ']);
    expect(file!.sheets[0]?.path).toBe('xl/worksheets/sheet1.xml');
    expect(file!.shared).toEqual(['品目', 'りんご', '金額']);
  });

  it('セル型(s / b / n / inlineStr)と dense 展開・空行保持', async () => {
    const file = await openXlsx(fixtureXlsx());
    const g = await sheetGrid(file!, 0);
    expect(g).not.toBeNull();
    expect(g!.rows.length).toBe(3); // r=3 まで(空の r=2 を保持)
    expect(g!.rows[0]).toEqual(['品目', '', '金額', '']);
    expect(g!.rows[1]).toEqual(['', '', '', '']);
    expect(g!.rows[2]).toEqual(['りんご', 'TRUE', '1280', '備考']);
    expect(g!.truncatedRows).toBe(false);
  });

  it('空シートは rows 0 件、xlsx でない zip は null', async () => {
    const file = await openXlsx(fixtureXlsx());
    const g = await sheetGrid(file!, 1);
    expect(g!.rows).toEqual([]);
    expect(await openXlsx(makeZip([{ name: 'hello.txt', data: 'x' }]))).toBeNull();
    expect(await openXlsx(new TextEncoder().encode('plain'))).toBeNull();
  });
});

describe('gridToCsv', () => {
  it('カンマ・引用符・改行を quoting', () => {
    expect(gridToCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"');
  });
});

describe('pickXlsxEntries', () => {
  it('mime / 拡張子で抽出', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 't',
      entries: [
        { lid: 'a', title: 'x1', archetype: 'attachment', created_at: '', updated_at: '', mime: MIME_XLSX },
        { lid: 'b', title: 'x2', archetype: 'attachment', created_at: '', updated_at: '', filename: 'kessan.XLSX' },
        { lid: 'c', title: 'pdf', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/pdf' },
      ],
      relations: [], stats: { totalEntries: 3, byArchetype: {}, totalRelations: 0, totalAssets: 3 },
    };
    expect(pickXlsxEntries(p).map((e) => e.lid)).toEqual(['a', 'b']);
  });
});
