import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }]) {
  test(`R02 onboarding and read-only route ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    const onboarding = page.getByRole('region', { name: '首次接入' });
    await expect(onboarding).toBeVisible();
    await expect(page.getByLabel('端口', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '启动连接' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '生成配对串' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认配对' })).toHaveCount(0);
    await expect(page.getByLabel('启用 AI')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重试监听', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '启用本地 Skills 书签库', exact: true })).toBeDisabled();
    await expect(page.getByLabel('用户数据目录')).not.toBeVisible();
    await page.screenshot({ path: `${evidence}/onboarding-${size.width}x${size.height}.png` });
    await page.getByText('其他接入方式：只读文件来源', { exact: true }).click();
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
  await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
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
  await expect(page.locator('.connection-pill span')).toHaveText('未连接 · 只读');
  await expect(page.getByRole('button', { name: '预览修改' })).toBeDisabled();
  await page.screenshot({ path: `${evidence}/selected-offline-other-live.png` });
  const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
  expect(calls).not.toContain('apply');
  expect(errors).toEqual([]);
});

test('R02 ignore requires confirmation, Escape restores focus, and resume restores cached browsing', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/');
  await page.locator('.connection-pill').click();
  await expect(page.getByRole('tab', { name: 'Chrome 连接', exact: true })).toHaveAttribute('aria-selected', 'true');
  const ignore = page.getByRole('button', { name: '断开并忽略', exact: true });
  await ignore.click();
  await expect(page.getByRole('dialog')).toContainText('本机缓存、标签和备注都会保留');
  await expect(page.getByRole('button', { name: '留在当前页面' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ignore).toBeFocused();
  await expect(page.getByText('实时同步', { exact: true })).toBeVisible();
  await ignore.click();
  await page.screenshot({ path: `${evidence}/ignore-confirmation.png` });
  await page.getByRole('button', { name: '确认断开并忽略', exact: true }).click();
  await expect(page.locator('.workspace-heading .connection')).toHaveText('已忽略 · 只读');
  await expect(page.locator('.connection-pill span')).toHaveText('已忽略 · 只读');
  await page.getByRole('button', { name: '恢复连接', exact: true }).click();
  await expect(page.locator('.workspace-heading .connection')).toHaveText('未连接 · 只读');
  await expect(page.locator('.connection-pill span')).toHaveText('未连接 · 只读');
});

test('T7 zero-click onboarding auto-enters workbench without yanking Settings, and supports rename & writePaused', async ({ page }) => {
  await mockBridge(page, 'onboarding');
  await page.goto('/');
  await expect(page.getByRole('region', { name: '首次接入' })).toBeVisible();
  await expect(page.getByText('127.0.0.1:49153', { exact: true })).toBeVisible();
  await expect(page.locator('.connection-pill span')).toHaveText('监听就绪 · :49153');

  // When first live Chrome profile arrives during initial onboarding, auto-enter workbench and skip ignored profiles.
  await page.evaluate(() => {
    (window as unknown as { __s02state: (patch: unknown) => void }).__s02state({
      profiles: [
        { profileId: 'profile-ignored', instanceId: 'instance-ignored', displayName: '旧资料', connection: 'ignored', writePaused: false, ignored: true, nodeCount: 3, revision: 1, lastSyncedAt: null, errorCode: null },
        { profileId: 'profile-test', instanceId: 'instance-test', displayName: '测试研究资料', connection: 'live', writePaused: false, ignored: false, nodeCount: 27, revision: 8, lastSyncedAt: null, errorCode: null },
      ],
    });
  });
  await expect(page.getByRole('heading', { level: 1, name: '书签', exact: true })).toBeVisible();
  await expect(page.getByLabel('书签来源')).toHaveValue('profile:profile-test');
  await expect(page.locator('.connection-pill span')).toHaveText('已连接 Chrome');

  // Inline rename validation and submission, plus immediate writePaused toggle.
  await page.locator('.connection-pill').click();
  const renameInput = page.getByLabel('资料名称', { exact: true }).last();
  await renameInput.fill('   ');
  await page.getByRole('button', { name: '保存名称', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('1–128');

  await renameInput.fill('  工作资料  ');
  await page.getByRole('button', { name: '保存名称', exact: true }).last().click();
  await expect(page.getByRole('heading', { level: 3, name: '工作资料', exact: true })).toBeVisible();

  const targetCard = page.getByRole('article').filter({ hasText: '工作资料' });
  await targetCard.getByRole('button', { name: '暂停写入（只读）', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(targetCard.getByText('已暂停写入（只读保护）', { exact: true })).toBeVisible();
  await expect(page.locator('.connection-pill span')).toHaveText('已暂停写入 · 只读');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.locator('.library-toolbar').getByText(/已暂停写入（只读保护）/)).toBeVisible();
  await page.locator('.source-guidance details > summary').click();
  await expect(page.locator('.source-guidance').getByRole('button', { name: '检查连接设置', exact: true })).toBeVisible();
  await page.locator('.source-guidance').getByRole('button', { name: '检查连接设置', exact: true }).click();
  await targetCard.getByRole('button', { name: '恢复写入', exact: true }).click();
  await expect(page.locator('.connection-pill span')).toHaveText('已连接 Chrome');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.locator('details.source-guidance.source-guidance-compact > summary')).toHaveText('实时同步 · 已完成全树核对');
});

test('T7 keeps user in Settings when first Chrome profile arrives while viewing Settings', async ({ page }) => {
  await mockBridge(page, 'onboarding');
  await page.goto('/');
  await expect(page.getByRole('region', { name: '首次接入' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __s02state: (patch: unknown) => void }).__s02state({
      profiles: [{ profileId: 'profile-test', instanceId: 'instance-test', displayName: '测试研究资料', connection: 'live', writePaused: false, ignored: false, nodeCount: 27, revision: 8, lastSyncedAt: null, errorCode: null }],
    });
  });
  await expect(page.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
  await expect(page.locator('.connection-pill span')).toHaveText('已连接 Chrome');
});
