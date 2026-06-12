/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { charCount, parseDocx } from '../../tools/f3-docx-viewer/src/docx';
import { pickDocxEntries, renderBlocks } from '../../tools/f3-docx-viewer/src/main';
import type { ContainerProjection } from '../../tools/shared/ext-channel';
import { makeZip } from '../helpers/make-zip';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fixtureDocx(): Uint8Array {
  return makeZip([
    {
      name: 'word/document.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>議事録</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>1 行目</w:t><w:br/><w:t>2 行目</w:t><w:tab/><w:t>タブ後</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>箇条書き項目</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:delText>消された文</w:delText></w:r>
      <w:r><w:t>残った文</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>項目</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>値</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>担当</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>佐藤</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
    },
  ]);
}

describe('parseDocx', () => {
  it('見出し / 段落(br・tab)/ 箇条書き / 表 / delText 除外', async () => {
    const blocks = await parseDocx(fixtureDocx());
    expect(blocks).not.toBeNull();
    expect(blocks![0]).toEqual({ kind: 'heading', level: 1, text: '議事録' });
    expect(blocks![1]).toEqual({ kind: 'para', text: '1 行目\n2 行目\tタブ後' });
    expect(blocks![2]).toEqual({ kind: 'list', text: '箇条書き項目' });
    expect(blocks![3]).toEqual({ kind: 'para', text: '残った文' });
    expect(blocks![4]).toEqual({ kind: 'table', rows: [['項目', '値'], ['担当', '佐藤']] });
  });

  it('docx でない入力は null(throw しない)', async () => {
    expect(await parseDocx(makeZip([{ name: 'a.txt', data: 'x' }]))).toBeNull();
    expect(await parseDocx(new TextEncoder().encode('plain'))).toBeNull();
  });

  it('charCount は空白を除いて数える', () => {
    expect(charCount([
      { kind: 'para', text: 'a b\nc' },
      { kind: 'table', rows: [['de', 'f ']] },
    ])).toBe(6);
  });
});

describe('renderBlocks', () => {
  it('textContent で描画(HTML 注入されない)', async () => {
    const blocks = await parseDocx(fixtureDocx());
    const dom = renderBlocks(blocks!);
    expect(dom.querySelector('.pkc-docx-h1')?.textContent).toBe('議事録');
    expect(dom.querySelector('.pkc-docx-li')?.textContent).toBe('• 箇条書き項目');
    expect(dom.querySelectorAll('table tr').length).toBe(2);
  });

  it('悪意あるテキストもタグ化されない', () => {
    const dom = renderBlocks([{ kind: 'para', text: '<img src=x onerror=alert(1)>' }]);
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.textContent).toContain('<img');
  });
});

describe('pickDocxEntries', () => {
  it('mime / 拡張子で抽出', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 't',
      entries: [
        { lid: 'a', title: 'w1', archetype: 'attachment', created_at: '', updated_at: '', mime: MIME_DOCX },
        { lid: 'b', title: 'w2', archetype: 'attachment', created_at: '', updated_at: '', filename: 'report.DOCX' },
        { lid: 'c', title: 'x', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/pdf' },
      ],
      relations: [], stats: { totalEntries: 3, byArchetype: {}, totalRelations: 0, totalAssets: 3 },
    };
    expect(pickDocxEntries(p).map((e) => e.lid)).toEqual(['a', 'b']);
  });
});
