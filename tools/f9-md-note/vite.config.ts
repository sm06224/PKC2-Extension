import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const dir = dirname(fileURLToPath(import.meta.url));
const mermaidPkg = JSON.parse(
  readFileSync(resolve(dir, '../../node_modules/mermaid/package.json'), 'utf8'),
) as { version: string };

// Classic IIFE — runs when injected via document.write (see shared recipe).
export default defineConfig({
  define: {
    __MERMAID_VERSION__: JSON.stringify(mermaidPkg.version),
  },
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    // mermaid is large; a single offline file is the whole point here.
    chunkSizeWarningLimit: 4000,
    lib: {
      entry: resolve(dir, 'src/main.ts'),
      name: 'PkcMdNote',
      formats: ['iife'],
      fileName: () => 'tool.js',
    },
  },
});
