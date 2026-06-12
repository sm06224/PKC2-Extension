import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const dir = dirname(fileURLToPath(import.meta.url));
const pdfjsPkg = JSON.parse(
  readFileSync(resolve(dir, '../../node_modules/pdfjs-dist/package.json'), 'utf8'),
) as { version: string };

// Classic IIFE — runs when injected via document.write (see shared recipe).
export default defineConfig({
  define: {
    __PDFJS_VERSION__: JSON.stringify(pdfjsPkg.version),
  },
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    // pdf.js + inline worker は大きい — 単一オフラインファイルが目的。
    chunkSizeWarningLimit: 6000,
    lib: {
      entry: resolve(dir, 'src/main.ts'),
      name: 'PkcPdfViewer',
      formats: ['iife'],
      fileName: () => 'tool.js',
    },
  },
});
