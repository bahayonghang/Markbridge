import { expect, test, type Page } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
const sizes = [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }];

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
}

for (const size of sizes) {
  test(`R01 shell and settings ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page, 'library');
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('option', { name: /Human Interface Guidelines/ }).first()).toBeVisible();
    await expect(page.getByLabel('端口', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('启用 AI')).toHaveCount(0);
    const searchBox = await page.getByLabel('搜索标题或网址').boundingBox();
    const detailButton = await page.getByRole('button', { name: '详情', exact: true }).boundingBox();
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(detailButton!.x);
    if (size.width < 800) {
      const folderButton = page.getByRole('button', { name: '文件夹', exact: true });
      const folderBox = await folderButton.boundingBox();
      expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(folderBox!.x);
      await folderButton.click();
      await expect(page.getByRole('treeitem', { name: '书签栏' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeVisible();
      await expect(page.getByLabel('搜索标题或网址')).not.toBeVisible();
      await page.keyboard.press('Escape');
      await expect(folderButton).toBeFocused();
      await expect(page.getByLabel('搜索标题或网址')).toBeVisible();
    }
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible();
    expect(await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).evaluate((element) => element.getBoundingClientRect().width)).toBe(16);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-library-${size.width}x${size.height}.png` });
    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-detail-${size.width}x${size.height}.png` });
    await page.getByRole('button', { name: '关闭详情，返回列表' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    await page.getByLabel('搜索标题或网址').fill('Guidelines');
    await page.getByRole('button', { name: '整理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '整理书签' })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await expect(page.getByText('还没有操作记录。')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('端口', { exact: true })).not.toBeVisible();
    await page.getByText('高级：连接端口', { exact: true }).click();
    await expect(page.getByLabel('端口', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Chrome 连接' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
    await expect(page.getByLabel('启用 AI')).not.toBeChecked();
    expect(await page.getByLabel('启用 AI').evaluate((element) => element.getBoundingClientRect().width)).toBe(16);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-ai-${size.width}x${size.height}.png` });
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
    await expect(page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true })).not.toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => ['test_ai', 'inspect', 'check_links', 'organize', 'apply'].includes(call)))).toEqual([]);
  });
}

test('R01 keeps checkbox keys and focus independent from row actions', async ({ page }) => {
  await mockBridge(page, 'library');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  const checkbox = page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'open_url'))).toEqual([]);
});

test('R01 keeps edit drafts on navigation and stops hidden content previews', async ({ page }) => {
  await mockBridge(page, 'library');
  await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByLabel('新标题', { exact: true }).fill('尚未保存的标题');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const reads = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'content_preview').length);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByLabel('端点', { exact: true }).fill('http://localhost:11434');
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.getByText('还没有操作记录。')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'content_preview').length)).toBe(reads);
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('新标题', { exact: true })).toHaveValue('尚未保存的标题');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('端点', { exact: true })).toHaveValue('http://localhost:11434');
});

test('R01 reduced motion keeps pointer presses still and keyboard focus visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '书签', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳至内容' });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px');
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await settings.hover();
  await page.mouse.down();
  expect(await settings.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
});

for (const scenario of ['loading', 'cache-error', 'empty', 'readonly'] as const) {
  test(`R01 distinct ${scenario} state`, async ({ page }) => {
    await mockBridge(page, scenario);
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto('/');
    if (scenario === 'loading') await expect(page.getByText('正在读取书签。').first()).toBeVisible();
    if (scenario === 'cache-error') await expect(page.getByRole('alert')).toContainText('无法读取书签');
    if (scenario === 'empty') await expect(page.getByText('此资料还没有书签。')).toBeVisible();
    if (scenario === 'readonly') {
      await expect(page.getByText(/扩展未连接/)).toBeVisible();
      await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
      await expect(page.getByRole('button', { name: '预览修改' })).toBeDisabled();
    }
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-${scenario}-1100x760.png` });
  });
}
