import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['apps/desktop/src/**/*.test.tsx', 'apps/extension/src/**/*.test.ts', 'packages/protocol/src/**/*.test.ts'],
  },
});
