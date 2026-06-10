/**
 * Shared post-build single-file packager (mirrors the official graph
 * extension's `build-singlefile.mjs` in the PKC2 repo).
 *
 * Usage: node build/singlefile.mjs <tool-dir-name>
 *
 * Reads the tool's Vite lib output (`tools/<name>/dist/tool.js` IIFE + the
 * extracted CSS) and `tools/<name>/tool.config.json`, then emits a single
 * self-contained HTML into the repo-root `dist/`. The JS goes into a
 * **classic** `<script>` (NOT `type="module"`): a classic script runs when
 * the HTML is injected via `document.write` (the PKC2 launcher path) on
 * every browser, including Firefox.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) {
  console.error('usage: node build/singlefile.mjs <tool-dir-name>');
  process.exit(1);
}

const toolDir = resolve(root, 'tools', name);
const dist = resolve(toolDir, 'dist');
const config = JSON.parse(readFileSync(resolve(toolDir, 'tool.config.json'), 'utf8'));

const files = readdirSync(dist);
const cssFile = files.find((f) => f.endsWith('.css'));

const js = readFileSync(resolve(dist, 'tool.js'), 'utf8')
  // A literal </script> inside the bundle would close the tag early.
  .replace(/<\/script>/gi, '<\\/script>');
const css = cssFile ? readFileSync(resolve(dist, cssFile), 'utf8') : '';

const html = `<!doctype html>
<html lang="ja" data-pkc-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${config.title}</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="${config.rootId}"></div>
    <script>
${js}
    </script>
  </body>
</html>
`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist', config.out);
writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`wrote ${out} (${kb} KB, single-file, classic script)`);
