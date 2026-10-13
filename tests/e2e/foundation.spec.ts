import { expect, test } from '@playwright/test';

import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';


for (const size of [{ width: 1100, height: 760 }, { width: 640, height: 480 }]) {
  test(`browser preview ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: '未连接 · 只读' })).toHaveText('未连接 · 只读');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '跳至内容' })).toBeFocused();
    await expect(page.getByText(/浏览器预览 · 仅显示界面/)).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('button', { name: '启动连接' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '生成配对串' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/browser-preview-${size.width}x${size.height}.png`, fullPage: true });

  });

  test(`connection diagnostics mock ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page);
    await page.setViewportSize(size);
    await page.goto('/?harness=bridge');
    await expect(page.getByRole('status').filter({ hasText: '已连接 Chrome' })).toHaveText('已连接 Chrome');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByText('27', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/browser-diagnostics-mock-${size.width}x${size.height}.png`, fullPage: true });
    await page.getByRole('button', { name: '重新连接' }).click();
    await expect(page.locator('.workspace-heading .connection')).toHaveText('核对中 · 只读');
    await page.getByRole('button', { name: '吊销配对' }).click();
    await page.getByRole('button', { name: '确认吊销配对', exact: true }).click();
    await expect(page.locator('.workspace-heading .connection')).toHaveText('未配对 · 只读');
    await expect(page.getByText('27', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '吊销配对' })).toBeDisabled();
  });
}

test('startup failure hides raw backend details', async ({ page }) => {
  await mockBridge(page, 'startup-error');
  await page.goto('/?harness=bridge');
  await expect(page.getByRole('alert')).toContainText('无法读取启动状态');
  await expect(page.getByText('sensitive-raw-error')).toHaveCount(0);
});

test('port conflict allows an edited retry without exposing rejection details', async ({ page }) => {
  await mockBridge(page, 'port-conflict');
  await page.goto('/?harness=bridge');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '启动连接' })).toBeEnabled();
  await page.getByText('高级：连接端口', { exact: true }).click();
  await page.getByLabel('端口').fill('70000');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByRole('alert')).toContainText('1024–65535');
  await page.getByLabel('端口').fill('49153');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByRole('alert')).toContainText('请检查端口是否占用');
  await page.getByLabel('端口').fill('49154');
  await page.getByRole('button', { name: '启动连接' }).click();
  await expect(page.getByText('127.0.0.1:49154', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
