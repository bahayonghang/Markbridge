import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }]) {
  test(`13 diagnostic export is explicit and keyboard accessible ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page);
    await page.setViewportSize(size);
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const region = page.getByRole('region', { name: '诊断导出' });
    const button = region.getByRole('button', { name: '导出诊断 JSON' });
    await button.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls)).not.toContain('save_diagnostics');
    await expect(region).toContainText('不含书签内容、资料名称、本机路径、密钥或模型配置');
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(region.getByRole('status')).toHaveText('诊断文件已保存到所选位置。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(40);
    expect(bounds?.height).toBeGreaterThanOrEqual(40);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: `${evidence}/diagnostics-after-${size.width}x${size.height}.png` });
  });
}

test('13 cancellation and safe failures remain distinct from saving, with retry', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const region = page.getByRole('region', { name: '诊断导出' });
  const button = region.getByRole('button', { name: '导出诊断 JSON' });
  for (const status of ['cancelled', 'failed', 'rejected', 'saved']) {
    await page.evaluate((value) => { (window as unknown as { __t13DiagnosticStatus: string }).__t13DiagnosticStatus = value; }, status);
    await button.click();
    if (status === 'cancelled') await expect(region.getByRole('status')).toHaveText('已取消保存，没有生成诊断文件。');
    else if (status === 'saved') await expect(region.getByRole('status')).toHaveText('诊断文件已保存到所选位置。');
    else await expect(region.getByRole('alert')).toContainText('诊断文件未保存。');
    await expect(region).not.toContainText('sk-secret');
    await expect(region).not.toContainText('C:/private');
  }
  await page.screenshot({ path: `${evidence}/diagnostics-retry.png` });
});
