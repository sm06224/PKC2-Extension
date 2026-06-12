/** @vitest-environment happy-dom */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  cellsToSvg,
  extractPages,
  labelText,
  parseMxGraph,
  parseStyle,
  safeSvgColor,
  wrapMxfile,
} from '../../tools/f8-drawio-editor/src/drawio';
import { pickDrawioEntries } from '../../tools/f8-drawio-editor/src/main';
import type { ContainerProjection } from '../../tools/shared/ext-channel';

const MODEL = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="2" value="開始" style="rounded=1;fillColor=#1a2413;strokeColor=#7fbf3f" vertex="1" parent="1">
    <mxGeometry x="40" y="40" width="120" height="50" as="geometry"/>
  </mxCell>
  <mxCell id="3" value="&lt;b&gt;丸&lt;/b&gt;" style="ellipse;fillColor=#161c12" vertex="1" parent="1">
    <mxGeometry x="240" y="140" width="100" height="60" as="geometry"/>
  </mxCell>
  <mxCell id="4" value="flow" style="strokeColor=#8aa07a" edge="1" parent="1" source="2" target="3"/>
</root></mxGraphModel>`;

function compressedDrawio(xml: string): string {
  const deflated = deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8'));
  return `<mxfile><diagram id="p1" name="圧縮ページ">${deflated.toString('base64')}</diagram></mxfile>`;
}

describe('extractPages', () => {
  it('生 mxGraphModel は単一ページとして通す', async () => {
    const pages = await extractPages(MODEL);
    expect(pages!.length).toBe(1);
    expect(pages![0]!.xml).toContain('<mxGraphModel');
  });

  it('mxfile + inline diagram', async () => {
    const pages = await extractPages(`<mxfile><diagram name="ページA"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>`);
    expect(pages!.length).toBe(1);
    expect(pages![0]!.name).toBe('ページA');
    expect(pages![0]!.xml).toContain('mxGraphModel');
  });

  it('圧縮 diagram(base64 + raw deflate + URI encode)を展開できる', async () => {
    const pages = await extractPages(compressedDrawio(MODEL));
    expect(pages!.length).toBe(1);
    expect(pages![0]!.name).toBe('圧縮ページ');
    expect(pages![0]!.xml).toContain('value="開始"');
  });

  it('drawio でないテキストは null', async () => {
    expect(await extractPages('just some text')).toBeNull();
    expect(await extractPages('<html><body/></html>')).toBeNull();
  });
});

describe('parseMxGraph / parseStyle', () => {
  it('セル・style・geometry・edge の source/target', () => {
    const cells = parseMxGraph(MODEL)!;
    const v = cells.find((c) => c.id === '2')!;
    expect(v.vertex).toBe(true);
    expect(v.style['rounded']).toBe('1');
    expect(v.geometry).toEqual({ x: 40, y: 40, w: 120, h: 50 });
    const e = cells.find((c) => c.id === '4')!;
    expect(e.edge).toBe(true);
    expect(e.source).toBe('2');
    expect(e.target).toBe('3');
    expect(parseStyle('ellipse;fillColor=#fff')).toEqual({ ellipse: '', fillColor: '#fff' });
  });

  it('mxGraphModel でない XML は null', () => {
    expect(parseMxGraph('<other/>')).toBeNull();
  });
});

describe('cellsToSvg', () => {
  it('rect / ellipse / line / ラベル textContent(HTML タグ除去)', () => {
    const svg = cellsToSvg(parseMxGraph(MODEL)!);
    expect(svg.querySelectorAll('rect').length).toBe(1);
    expect(svg.querySelectorAll('ellipse').length).toBe(1);
    expect(svg.querySelectorAll('line').length).toBe(1);
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('開始');
    expect(texts).toContain('丸'); // <b> はタグ除去
    expect(svg.querySelector('b')).toBeNull();
  });

  it('safeSvgColor は #hex / none のみ通す', () => {
    expect(safeSvgColor('#7fbf3f', '#000')).toBe('#7fbf3f');
    expect(safeSvgColor('none', '#000')).toBe('none');
    expect(safeSvgColor('url(javascript:x)', '#000')).toBe('#000');
    expect(safeSvgColor(undefined, '#abc')).toBe('#abc');
  });

  it('labelText は HTML をテキスト化', () => {
    expect(labelText('plain')).toBe('plain');
    expect(labelText('<div>A<script>x</script></div>')).toContain('A');
  });
});

describe('wrapMxfile', () => {
  it('非圧縮 mxfile に包み、ページ名をエスケープ', () => {
    const out = wrapMxfile([{ name: 'a"<b>', xml: '<mxGraphModel><root/></mxGraphModel>' }]);
    expect(out).toContain('<mxfile');
    expect(out).toContain('name="a&quot;&lt;b&gt;"');
    expect(out).toContain('<mxGraphModel><root/></mxGraphModel>');
  });
});

describe('pickDrawioEntries', () => {
  it('mime / 拡張子で抽出', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 't',
      entries: [
        { lid: 'a', title: 'd1', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/vnd.jgraph.mxfile' },
        { lid: 'b', title: 'd2', archetype: 'attachment', created_at: '', updated_at: '', filename: 'arch.DRAWIO' },
        { lid: 'c', title: 'x', archetype: 'attachment', created_at: '', updated_at: '', filename: 'x.xml' },
      ],
      relations: [], stats: { totalEntries: 3, byArchetype: {}, totalRelations: 0, totalAssets: 3 },
    };
    expect(pickDrawioEntries(p).map((e) => e.lid)).toEqual(['a', 'b']);
  });
});
