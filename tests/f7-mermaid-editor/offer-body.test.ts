import { describe, expect, it } from 'vitest';
import {
  buildMermaidOfferBody,
  defaultTitle,
  extractMermaidSource,
} from '../../tools/f7-mermaid-editor/src/offer-body';

describe('buildMermaidOfferBody', () => {
  it('wraps the source in a mermaid fence', () => {
    expect(buildMermaidOfferBody('graph TD\n  A-->B')).toBe('```mermaid\ngraph TD\n  A-->B\n```\n');
  });

  it('neutralizes embedded fences so the block cannot be terminated early', () => {
    const body = buildMermaidOfferBody('graph TD\n```\nA-->B');
    expect(body.match(/```/g)?.length).toBe(2); // only ours
    expect(body).toContain('~~~');
  });
});

describe('extractMermaidSource (round-trip)', () => {
  it('recovers the source from a built body', () => {
    const src = 'sequenceDiagram\n  A->>B: hi';
    expect(extractMermaidSource(buildMermaidOfferBody(src))).toBe(src);
  });

  it('returns null when no mermaid fence exists', () => {
    expect(extractMermaidSource('# just text')).toBeNull();
  });
});

describe('defaultTitle', () => {
  it('uses the diagram type keyword', () => {
    expect(defaultTitle('graph TD\n A-->B')).toBe('Mermaid: graph');
    expect(defaultTitle('\n  sequenceDiagram\n')).toBe('Mermaid: sequenceDiagram');
  });
  it('falls back for empty sources', () => {
    expect(defaultTitle('')).toBe('Mermaid: mermaid');
  });
});
