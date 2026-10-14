import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'layout-review');

for (const theme of ['light', 'dark']) {
  test(`C03 minimum 20px ${theme} keeps keyboard returns and source-bound drafts across export`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
    await mockBridge(page, 'sources');
    await page.goto('/');
    const folder = page.getByRole('button', { name: '文件夹', exact: true });
    await folder.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem', { name: '书签栏', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(folder).toBeFocused();

    await page.getByLabel('搜索标题或网址').fill('Guidelines');
    await expect(page.getByRole('status').filter({ hasText: '已加载 4 / 4 项' })).toBeVisible();
    const selected = page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true });
    await selected.focus();
    await page.keyboard.press('Space');
    await expect(selected).toBeChecked();
    await expect(selected).toBeFocused();
    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    await page.getByRole('tab', { name: '标签备注', exact: true }).click();
    const draft = `C03 ${theme}：最小窗口下保留未保存备注。`;
    await page.getByLabel('备注', { exact: true }).fill(draft);
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.getByRole('button', { name: '备份导出', exact: true }).click();
    const source = page.getByRole('combobox', { name: '书签来源', exact: true });
    await expect(source).toHaveValue('profile:profile-test');
    await source.focus();
    await source.selectOption('profile:profile-second');
    const confirm = page.getByRole('dialog', { name: '切换书签来源？' });
    await expect(confirm).toBeVisible();
    const cancel = confirm.getByRole('button', { name: '留在当前页面', exact: true });
    await expect(cancel).toBeFocused();
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${theme}-20-minimum-source-confirm.png`) });
    await page.keyboard.press('Escape');
    await expect(source).toBeFocused();
    await expect(source).toHaveValue('profile:profile-test');
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(page.getByRole('heading', { name: '书签', exact: true, level: 1 })).toBeFocused();
    await expect(page.getByLabel('备注', { exact: true })).toHaveValue(draft);
    const close = page.getByRole('button', { name: '关闭详情，返回列表', exact: true });
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
    await expect(selected).toBeChecked();
    const result = await page.evaluate(() => ({
      calls: (window as unknown as { __r01calls: string[] }).__r01calls,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    expect(result.calls.filter(call => ['content_preview', 'tag_set_note', 'save_export', 'apply', 'apply_batch', 'test_ai', 'suggest_ai', 'organize', 'check_links'].includes(call))).toEqual([]);
    expect([result.width, result.height]).toEqual([640, 480]);
    await page.screenshot({ path: join(output, `${theme}-20-minimum-restored.png`) });
    await writeFile(join(output, `${theme}-20-minimum.json`), `${JSON.stringify({ theme, fontSizePx: 20, viewport: { width: 640, height: 480 }, result }, null, 2)}\n`);
  });
}
