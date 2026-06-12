/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { parsePptx } from '../../tools/f4-pptx-viewer/src/pptx';
import { pickPptxEntries, renderSlides } from '../../tools/f4-pptx-viewer/src/main';
import type { ContainerProjection } from '../../tools/shared/ext-channel';
import { makeZip } from '../helpers/make-zip';

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function fixturePptx(): Uint8Array {
  return makeZip([
    {
      name: 'ppt/presentation.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<p:presentation ${P_NS}>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      deflate: true,
      data: `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="t" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="t" Target="slides/slide2.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/slides/slide1.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<p:sld ${P_NS}>
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>四半期報告</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:txBody>
        <a:p><a:r><a:t>売上は</a:t></a:r><a:r><a:t>前年比 +12%</a:t></a:r></a:p>
        <a:p><a:r><a:t>課題: 在庫</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`,
    },
    {
      name: 'ppt/slides/slide2.xml',
      deflate: true,
      data: `<?xml version="1.0"?>
<p:sld ${P_NS}>
  <p:cSld><p:spTree>
    <p:graphicFrame>
      <a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>表セル A</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>
    </p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`,
    },
  ]);
}

describe('parsePptx', () => {
  it('スライド順・タイトル(ctrTitle)・ラン連結・表テキスト', async () => {
    const slides = await parsePptx(fixturePptx());
    expect(slides).not.toBeNull();
    expect(slides!.length).toBe(2);
    expect(slides![0]).toEqual({ title: '四半期報告', lines: ['売上は前年比 +12%', '課題: 在庫'] });
    expect(slides![1]).toEqual({ title: '', lines: ['表セル A'] });
  });

  it('pptx でない入力は null(throw しない)', async () => {
    expect(await parsePptx(makeZip([{ name: 'a.txt', data: 'x' }]))).toBeNull();
    expect(await parsePptx(new TextEncoder().encode('plain'))).toBeNull();
  });
});

describe('renderSlides', () => {
  it('textContent で描画(HTML 注入されない)', () => {
    const dom = renderSlides([{ title: '<b>t</b>', lines: ['<script>x</script>'] }]);
    expect(dom.querySelector('b')).toBeNull();
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.querySelector('.pkc-pptx-slidetitle')?.textContent).toBe('<b>t</b>');
  });
});

describe('pickPptxEntries', () => {
  it('mime / 拡張子で抽出', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 't',
      entries: [
        { lid: 'a', title: 'p1', archetype: 'attachment', created_at: '', updated_at: '', mime: MIME_PPTX },
        { lid: 'b', title: 'p2', archetype: 'attachment', created_at: '', updated_at: '', filename: 'deck.PPTX' },
        { lid: 'c', title: 'x', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/pdf' },
      ],
      relations: [], stats: { totalEntries: 3, byArchetype: {}, totalRelations: 0, totalAssets: 3 },
    };
    expect(pickPptxEntries(p).map((e) => e.lid)).toEqual(['a', 'b']);
  });
});
