import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = process.cwd();
const task = resolve(root, '.trellis/tasks/10-25-mb-g03-glass-acceptance');
const application = process.env.MARKBRIDGE_BASELINE === '1' ? resolve(root, 'runs/airy-glass-baseline') : root;
const port = Number(process.env.MARKBRIDGE_DEV_PORT || 14941);

export default defineConfig({
  testDir: process.env.MARKBRIDGE_SCROLL_BENCHMARK === '1' ? task : resolve(root, 'tests/e2e'),
  testMatch: process.env.MARKBRIDGE_SCROLL_BENCHMARK === '1' ? 'scroll-benchmark.spec.ts' : '**/*.spec.ts',
  outputDir: resolve(root, 'test-results/glass-g03'),
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, channel: 'msedge' },
  webServer: {
    command: `node "${root}/node_modules/vite/bin/vite.js"`,
    cwd: resolve(application, 'apps/desktop'),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: { MARKBRIDGE_DEV_PORT: String(port) },
  },
});
