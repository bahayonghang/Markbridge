import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../../../../tests/e2e',
  outputDir: './test-results',
  use: { baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL, headless: true },
});
