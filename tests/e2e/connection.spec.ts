import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }]) {
  test(`R02 onboarding and read-only route ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('region', { name: '首次接入' })).toBeVisible();
    await expect(page.getByLabel('端口', { exact: true })).not.toBeVisible();
    await expect(page.getByLabel('启用 AI')).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/onboarding-${size.width}x${size.height}.png` });
    await page.getByText('高级：连接端口', { exact: true }).click();
    await expect(page.getByLabel('端口', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '启动连接', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '只读浏览文件' }).click();
    await expect(page.getByLabel('用户数据目录')).toBeVisible();
    await expect(page.getByRole('button', { name: '枚举资料' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    await page.screenshot({ path: `${evidence}/onboarding-readonly-${size.width}x${size.height}.png` });
  });
}

test('R02 source-switch confirmation keeps focus and separates identical Chrome IDs', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mockBridge(page, 'sources');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByLabel('新标题').fill('当前资料的未确认输入');
  await page.getByLabel('书签来源').focus();
  await page.getByLabel('书签来源').selectOption('profile:profile-second');
  await expect(page.getByRole('dialog', { name: '切换书签来源？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '留在当前页面' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('书签来源')).toBeFocused();
  await expect(page.getByLabel('书签来源')).toHaveValue('profile:profile-test');
  await expect(page.getByLabel('新标题')).toHaveValue('当前资料的未确认输入');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('article').filter({ hasText: '另一份资料' }).getByRole('button', { name: '浏览此资料' }).click();
  await expect(page.getByRole('dialog', { name: '切换书签来源？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('书签来源')).toBeFocused();
  await expect(page.getByLabel('新标题')).toHaveValue('当前资料的未确认输入');
  await page.getByLabel('书签来源').selectOption('profile:profile-second');
  await page.getByRole('button', { name: '清除当前输入并切换' }).click();
  await expect(page.getByLabel('书签来源')).toHaveValue('profile:profile-second');
  await page.getByRole('option', { name: /另一份资料 10/ }).click();
  await expect(page.getByLabel('新标题')).toHaveValue('另一份资料 10');
  await page.evaluate(() => (window as unknown as { __r02disconnect: () => void }).__r02disconnect());
  await expect(page.locator('.workspace-heading .connection')).toHaveText('未连接 · 只读');
  await expect(page.getByRole('button', { name: '预览修改' })).toBeDisabled();
  await page.screenshot({ path: `${evidence}/selected-offline-other-live.png` });
  const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
  expect(calls).not.toContain('apply');
  expect(errors).toEqual([]);
});

test('R02 revocation requires a second action and Escape returns to its trigger', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const revoke = page.getByRole('button', { name: '吊销配对', exact: true });
  await revoke.click();
  await expect(page.getByRole('dialog')).toContainText('本机缓存、标签和备注都会保留');
  await expect(page.getByRole('button', { name: '留在当前页面' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(revoke).toBeFocused();
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await revoke.click();
  await page.screenshot({ path: `${evidence}/revoke-confirmation.png` });
  await page.getByRole('button', { name: '确认吊销配对', exact: true }).click();
  await expect(page.locator('.workspace-heading .connection')).toHaveText('未配对 · 只读');
});
