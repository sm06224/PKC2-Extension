import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Classic IIFE — runs when injected via document.write (see shared recipe).
export default defineConfig({
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(dir, 'src/main.ts'),
      name: 'PkcRssFetcher',
      formats: ['iife'],
      fileName: () => 'tool.js',
    },
  },
});
