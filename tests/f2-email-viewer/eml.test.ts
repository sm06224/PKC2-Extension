/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  decodeQuotedPrintable,
  decodeRfc2047,
  parseEml,
  parseParamHeader,
  unfoldHeaders,
} from '../../tools/f2-email-viewer/src/eml';
import { htmlToText, pickEmlEntries } from '../../tools/f2-email-viewer/src/main';
import type { ContainerProjection } from '../../tools/shared/ext-channel';

const enc = new TextEncoder();
const b64 = (s: string): string => btoa(String.fromCharCode(...enc.encode(s)));

describe('header primitives', () => {
  it('unfoldHeaders は継続行を 1 行に畳む', () => {
    const h = unfoldHeaders('Subject: hello\r\n world\r\nFrom: a@b');
    expect(h).toEqual([['Subject', 'hello world'], ['From', 'a@b']]);
  });

  it('decodeRfc2047: B(base64 UTF-8)と Q(quoted-printable + _)', () => {
    expect(decodeRfc2047(`=?UTF-8?B?${b64('こんにちは')}?=`)).toBe('こんにちは');
    expect(decodeRfc2047('=?UTF-8?Q?hello_=E4=B8=96=E7=95=8C?=')).toBe('hello 世界');
    expect(decodeRfc2047('plain text')).toBe('plain text');
  });

  it('parseParamHeader: 値の小文字化 + quoted param', () => {
    const r = parseParamHeader('Text/HTML; charset="UTF-8"; name="レ.txt"');
    expect(r.value).toBe('text/html');
    expect(r.params['charset']).toBe('UTF-8');
    expect(r.params['name']).toBe('レ.txt');
  });

  it('decodeQuotedPrintable: =XX と soft break', () => {
    expect(new TextDecoder().decode(decodeQuotedPrintable('a=E3=81=82b=\r\nc'))).toBe('aあbc');
  });
});

describe('parseEml', () => {
  it('プレーンテキストメール', () => {
    const eml = enc.encode(
      'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: test\r\nDate: Thu, 12 Jun 2026 10:00:00 +0900\r\n\r\nHello body',
    );
    const m = parseEml(eml);
    expect(m.from).toBe('alice@example.com');
    expect(m.subject).toBe('test');
    expect(m.text).toBe('Hello body');
    expect(m.attachments).toEqual([]);
  });

  it('RFC2047 件名 + base64 UTF-8 本文', () => {
    const eml = enc.encode(
      `Subject: =?UTF-8?B?${b64('請求書のご送付')}?=\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('本文です。\nよろしく。')}`,
    );
    const m = parseEml(eml);
    expect(m.subject).toBe('請求書のご送付');
    expect(m.text).toBe('本文です。\nよろしく。');
  });

  it('multipart/mixed: text + html + 添付(RFC2047 filename)', () => {
    const fnameEnc = `=?UTF-8?B?${b64('資料.pdf')}?=`;
    const eml = enc.encode([
      'Subject: mixed',
      'Content-Type: multipart/mixed; boundary="BB"',
      '',
      '--BB',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain part',
      '--BB',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>html <b>part</b><script>evil()</script></p>',
      '--BB',
      `Content-Type: application/pdf; name="${fnameEnc}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fnameEnc}"`,
      '',
      btoa('PDFDATA'),
      '--BB--',
      '',
    ].join('\r\n'));
    const m = parseEml(eml);
    expect(m.text).toBe('plain part');
    expect(m.htmlSource).toContain('<b>part</b>');
    expect(m.attachments.length).toBe(1);
    expect(m.attachments[0]?.filename).toBe('資料.pdf');
    expect(new TextDecoder().decode(m.attachments[0]!.data)).toBe('PDFDATA');
  });

  it('壊れた入力でも throw しない', () => {
    expect(() => parseEml(enc.encode('garbage without headers'))).not.toThrow();
    expect(() => parseEml(new Uint8Array(0))).not.toThrow();
  });
});

describe('viewer helpers', () => {
  it('htmlToText は script を実行せずテキスト抽出', () => {
    const t = htmlToText('<p>本文 <b>強調</b></p><script>window.__emlPwned=1</script><style>x{}</style>');
    expect(t).toContain('本文 強調');
    expect(t).not.toContain('__emlPwned');
    expect((window as { __emlPwned?: number }).__emlPwned).toBeUndefined();
  });

  it('pickEmlEntries は mime / 拡張子で抽出', () => {
    const p: ContainerProjection = {
      containerId: 'c', title: 't',
      entries: [
        { lid: 'a', title: 'm1', archetype: 'attachment', created_at: '', updated_at: '', mime: 'message/rfc822' },
        { lid: 'b', title: 'm2', archetype: 'attachment', created_at: '', updated_at: '', filename: 'x.EML' },
        { lid: 'c', title: 'pdf', archetype: 'attachment', created_at: '', updated_at: '', mime: 'application/pdf' },
      ],
      relations: [], stats: { totalEntries: 3, byArchetype: {}, totalRelations: 0, totalAssets: 3 },
    };
    expect(pickEmlEntries(p).map((e) => e.lid)).toEqual(['a', 'b']);
  });
});
