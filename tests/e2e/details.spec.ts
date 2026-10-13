import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';

for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
  test(`R05 detail sections keep long content and offline metadata usable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockBridge(page, 'details'); await page.goto('/');
    await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
    await expect(page.getByRole('tab', { name: '信息', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.includes('content_preview'))).toBe(false);
    await page.getByRole('tab', { name: '标签备注' }).click();
    await page.getByLabel('备注', { exact: true }).fill('离线阅读笔记：整理工具应保持内容优先。');
    await page.getByRole('button', { name: '保存备注', exact: true }).click();
    await expect(page.getByText('备注尚未保存', { exact: true })).toBeHidden();
    await page.getByLabel('添加标签', { exact: true }).fill('阅读清单');
    await page.getByRole('button', { name: '添加标签', exact: true }).click();
    await expect(page.getByRole('list', { name: '当前标签' })).toContainText('阅读清单');
    await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '详情', exact: true }).click();
    await expect(page.getByLabel('备注', { exact: true })).toHaveValue('离线阅读笔记：整理工具应保持内容优先。');
    await page.locator('.detail-pane').evaluate((element) => { element.scrollTop = 0; });
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `r05-details-${width}x${height}.png`) });
    await page.getByRole('tab', { name: '内容预览' }).click();
    await expect(page.getByText(/离线缓存 ·/)).toBeVisible();
    await expect(page.locator('.preview-summary')).toContainText('<script>不执行页面脚本</script>');
    expect(await page.locator('.content-preview script').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '在 Chrome 中打开', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '在 Chrome 中打开', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
    const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
    expect(calls.filter((call) => call === 'apply' || call === 'apply_batch')).toEqual([]);
  });
}

test('R05 unsaved metadata has a focused keep/discard choice before changing items', async ({ page }) => {
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await page.getByLabel('备注', { exact: true }).fill('尚未保存');
  await page.getByRole('option', { name: /选择 设计系统里的留白与秩序/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '放弃未保存的本地草稿？' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: '留在当前页面' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('尚未保存');
  await page.getByRole('option', { name: /选择 设计系统里的留白与秩序/ }).first().click();
  await dialog.getByRole('button', { name: '放弃草稿并继续' }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  await page.getByRole('button', { name: '标签', exact: true }).click();
  await expect(page.getByRole('region', { name: '共同标签与备注' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '内容预览' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览修改' })).toHaveCount(0);
});
