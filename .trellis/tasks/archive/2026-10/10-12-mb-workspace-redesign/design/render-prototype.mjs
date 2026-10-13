import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('.', import.meta.url);
const output = new URL('./screenshots', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const network = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
const report = { kind: 'design-prototype-only', browser: browser.version(), layouts: [], interactions: [], errors, network };
async function shot(name) {
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const e = document.querySelector(selector);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, overflowX: document.documentElement.scrollWidth > innerWidth, overflowY: document.documentElement.scrollHeight > innerHeight, sidebar: rect('.sidebar'), main: rect('.main'), list: rect('.rows'), detail: rect('.inspector'), row: rect('.row') };
  });
  assert.equal(geometry.overflowX, false, `${name}: horizontal overflow`);
  assert.equal(geometry.overflowY, false, `${name}: body vertical overflow`);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)), fullPage: true });
  report.layouts.push({ name, ...geometry });
}
try {
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
    await page.setViewportSize({ width, height });
    await page.goto(new URL('workspace-prototype.html', root).href);
    await shot(`workspace-${width}x${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('#query').fill('Tauri');
  assert.equal(await page.locator('[data-row]').count(), 1);
  report.interactions.push('Search narrows the sample list');
  await page.locator('#query').fill('');
  await page.locator('[data-pick="0"]').check();
  await page.locator('[data-pick="1"]').check();
  assert.equal(await page.locator('.batchbar strong').innerText(), '已选 2 项');
  await shot('multi-selection');
  await page.locator('[data-action="move"]').click();
  assert.equal(await page.locator('#dialog').isVisible(), true);
  await page.locator('#cancel').click();
  report.interactions.push('Selection toolbar and move-review dialog; cancel writes nothing');
  await page.locator('[data-action="clear-picks"]').click();
  await page.locator('[data-nav="settings"]').click();
  await shot('settings');
  await page.setViewportSize({ width: 640, height: 480 });
  await shot('compact-settings');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-tab="AI"]').click();
  assert.match(await page.locator('#surface').innerText(), /默认关闭/);
  report.interactions.push('Settings tabs and AI off state');
  await page.locator('[data-nav="history"]').click();
  await shot('history');
  await page.locator('[data-nav="organize"]').click();
  await shot('organize');
  await page.locator('[data-action="scene"]').click();
  await shot('onboarding');
  await page.setViewportSize({ width: 640, height: 480 });
  await shot('compact-onboarding');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="scene"]').click();
  await shot('offline');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.locator('[data-row="0"]').click();
  await shot('compact-detail');
  await page.locator('.backdetail').click();
  assert.equal(await page.locator('.listpane').isVisible(), true);
  report.interactions.push('Compact detail replaces content and returns to list');
  assert.equal(errors.length, 0);
  assert.equal(network.length, 0);
  await writeFile(new URL('render-report.json', root), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ screenshots: report.layouts.length, interactions: report.interactions.length, errors, networkRequests: network.length }));
} finally {
  await browser.close();
}
