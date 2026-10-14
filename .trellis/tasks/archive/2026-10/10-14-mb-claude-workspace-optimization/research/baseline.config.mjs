import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../../../tests/e2e',
  outputDir: './baseline/test-results',
  use: { baseURL: 'http://127.0.0.1:1437', headless: true },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1437 --strictPort',
    cwd: '../../../../apps/desktop',
    url: 'http://127.0.0.1:1437',
    reuseExistingServer: false,
    timeout: 20000,
    env: { MARKBRIDGE_DEV_PORT: '1437' },
  },
});
