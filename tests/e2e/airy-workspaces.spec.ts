import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
import { contrastRatio, renderedContrastColors } from './contrast';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'airy-workspaces');

async function readable(locator: Locator) {
  const colors = await renderedContrastColors(locator);
  for (const fill of colors.fill) expect(contrastRatio(colors.ink, fill)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark']) for (const forcedColors of ['none', 'active'] as const) {
  test(`airy history state labels remain readable when selected ${theme} ${forcedColors}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
    await mockBridge(page, 'library'); await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __r06history: unknown[] }).__r06history = ['applied', 'uncertain', 'failed', 'rolled_back'].map((state, index) => ({ operationId: `glass-${index}`, kind: 'move', createdAt: 1791800000000 - index * 60000, state, affected: index + 1, errorCode: null, conflicts: [] }));
    });
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    for (const [state, label] of [['applied', '已完成'], ['uncertain', '结果不确定'], ['failed', '执行失败'], ['rolled_back', '已撤销']]) {
      const summary = page.locator('.history-summary').filter({ has: page.locator(`.state-${state}`) });
      await expect(summary.locator('.history-state')).toHaveText(label);
      await summary.click();
      await readable(summary.locator('.history-state'));
      await readable(summary.locator('.secondary'));
    }
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${theme}-history-${forcedColors}.png`) });
  });
}

for (const theme of ['light', 'dark']) for (const [width, height, size] of [[1440, 900, 14], [640, 480, 20]]) {
  test(`airy outputs distinguish cached content and export outcomes ${theme} ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ theme, size }) => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: size })), { theme, size });
    await mockBridge(page, 'details'); await page.goto('/');
    await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter(call => call === 'content_preview'))).toEqual([]);
    await page.getByRole('tab', { name: '内容预览', exact: true }).click();
    const preview = page.getByRole('region', { name: '内容预览', exact: true });
    await expect(preview.getByText(/离线缓存 ·/)).toBeVisible();
    const summary = preview.getByLabel('缓存正文', { exact: true });
    await expect(summary).toContainText('<script>不执行页面脚本</script>');
    await readable(summary); await readable(preview.locator('.library-detail-title'));
    expect(await summary.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    await mkdir(output, { recursive: true });
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${theme}-${width}-cached-content.png`) });

    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.getByRole('button', { name: '备份导出', exact: true }).click();
    const desk = page.getByRole('region', { name: '备份导出', exact: true });
    for (const status of ['cancelled', 'failed', 'saved']) {
      await page.evaluate(status => { (window as unknown as { __r06saveStatus: string }).__r06saveStatus = status; }, status);
      await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
      if (status === 'saved') {
        const saved = desk.getByText('文件已保存到所选位置。', { exact: true });
        await expect(saved).toBeVisible(); await readable(saved);
        await saved.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `${theme}-${width}-saved-export.png`) });
      } else {
        await expect(desk.locator('.export-result')).toHaveCount(0);
        await expect(desk.getByText(status === 'cancelled' ? '已取消保存，没有生成文件。' : '文件未保存。请检查目标位置的权限和可用空间，然后重试。', { exact: true })).toBeVisible();
      }
    }
    const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
    expect(calls.filter(call => call === 'content_preview')).toHaveLength(1);
    expect(calls.filter(call => ['apply', 'apply_batch', 'apply_ai', 'check_links', 'organize', 'suggest_ai'].includes(call))).toEqual([]);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([width, height]);
  });
}
