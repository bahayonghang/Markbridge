import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

function selectedDevPort() {
  if (process.env.MARKBRIDGE_DEV_PORT) return Number(process.env.MARKBRIDGE_DEV_PORT);
  const raw = execFileSync(process.execPath, ['scripts/dev-port.mjs'], { encoding: 'utf8' })
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim();
  const port = Number(raw);
  if (!Number.isInteger(port)) throw new Error('DEV_PORT_INVALID');
  process.env.MARKBRIDGE_DEV_PORT = String(port);
  return port;
}

const port = selectedDevPort();
const baseURL = `http://127.0.0.1:${port}`;
process.env.PLAYWRIGHT_TEST_BASE_URL = baseURL;

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL, headless: true },
  webServer: {
    command: 'pnpm --filter @markbridge/desktop dev',
    url: baseURL,
    reuseExistingServer: false,
    env: { ...process.env, MARKBRIDGE_DEV_PORT: String(port) },
  },
});
