/**
 * record:offer body assembly for Mermaid sources — pure and testable.
 *
 * The source is offered as a **text entry with a ```mermaid fence**: PKC2
 * renders it as a code block (its markdown dialect is frozen and has no
 * mermaid rendering), and this tool can round-trip the fenced source back
 * into the editor later. Saving the rendered SVG as an attachment is NOT
 * possible in v1 (offers cannot carry assets, spec §6.3 — see SR-13/14/15).
 */

const FENCE = '```';

export function buildMermaidOfferBody(source: string): string {
  // Avoid premature fence termination if the source itself contains ```.
  const safe = source.replace(/```/g, '~~~');
  return `${FENCE}mermaid\n${safe}\n${FENCE}\n`;
}

/** Extract a fenced mermaid source back out of a body (round-trip). */
export function extractMermaidSource(body: string): string | null {
  const m = /```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(body);
  return m ? (m[1] ?? null) : null;
}

/** Default entry title: diagram type + first meaningful line. */
export function defaultTitle(source: string): string {
  const firstLine = source.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  const head = firstLine.split(/\s+/)[0] || 'mermaid';
  return `Mermaid: ${head}`;
}
