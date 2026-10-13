import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';

test('empty directory creation uses independent drafts and preview cancellation never writes', async ({ page }) => {
  await mockBridge(page, 'editing'); await page.goto('/');
  await page.getByRole('treeitem', { name: '书签栏', exact: true }).click();
  await page.getByRole('option', { name: /Human Interface Guidelines/, exact: false }).first().click();
  await expect(page.getByLabel('新标题', { exact: true })).toHaveValue('Human Interface Guidelines');
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  await page.getByRole('treeitem', { name: '空目录', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue(''); await expect(page.getByLabel('网址', { exact: true })).toHaveValue('');
  await page.getByLabel('名称', { exact: true }).fill('独立的新书签'); await page.getByLabel('网址', { exact: true }).fill('https://example.com/new');
  await page.getByRole('button', { name: '文件夹', exact: true }).last().click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('');
  await page.getByLabel('名称', { exact: true }).fill('新建阅读目录'); await page.getByRole('button', { name: '预览新文件夹' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'apply'))).toEqual([]);
  await page.getByRole('button', { name: '书签', exact: true }).last().click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('独立的新书签');
  await page.getByRole('button', { name: '预览新书签' }).click(); await page.getByRole('button', { name: '确认变更', exact: true }).click();
  await expect(page.getByText('回执已确认。', { exact: true })).toBeVisible();
});

for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
  test(`batch destination and reviewed diff remain reachable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockBridge(page, 'editing'); await page.goto('/');
    if (width < 800) await page.getByRole('button', { name: '文件夹', exact: true }).first().click();
    await page.getByRole('treeitem', { name: '书签栏', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true }).check();
    await page.getByRole('button', { name: '移动所选', exact: true }).click();
    await page.locator('.batch-edit-desk .folder-picker > summary').click();
    await page.getByLabel('搜索文件夹路径').fill('阅读归档');
    await page.getByRole('option', { name: /书签栏 \/ 阅读归档/ }).click();
    await page.getByRole('button', { name: '预览批量移动', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认批量变更' })).toBeVisible();
    await page.getByRole('button', { name: '确认批量变更', exact: true }).scrollIntoViewIfNeeded();
    await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `r04-editing-${width}x${height}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '确认批量变更', exact: true }).click();
    await expect(page.getByText('全部回执已确认', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'apply_batch').length)).toBe(1);
  });
}
