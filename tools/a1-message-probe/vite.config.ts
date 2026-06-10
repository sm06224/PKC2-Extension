import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Build as a **classic IIFE** (not an ES module) so the single-file HTML
// runs when injected via `document.write` (the PKC2 launcher path) on every
// browser — a `type="module"` script does not execute that way in Firefox.
export default defineConfig({
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(dir, 'src/main.ts'),
      name: 'PkcMessageProbe',
      formats: ['iife'],
      fileName: () => 'tool.js',
    },
  },
});
