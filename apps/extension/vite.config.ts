import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({ build: {
  sourcemap: false,
  rollupOptions: {
    input: {
      popup: fileURLToPath(new URL('index.html', import.meta.url)),
      options: fileURLToPath(new URL('options.html', import.meta.url)),
      worker: fileURLToPath(new URL('src/worker.ts', import.meta.url)),
    },
    output: { entryFileNames: chunk => chunk.name === 'worker' ? 'worker.js' : 'assets/[name]-[hash].js' },
  },
} });
