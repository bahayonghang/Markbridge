import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
  test(`R06 history, full undo review and export outcomes ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockBridge(page, 'library'); await page.goto('/');
    await expect(page.getByRole('option', { name: /Human Interface Guidelines/ }).first()).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __r06history: unknown[] }).__r06history = ['applied', 'uncertain', 'partial', 'failed', 'rollback_conflict', 'rolled_back'].map((state, index) => ({ operationId: `operation-${index}`, kind: index === 0 ? 'delete' : 'move', createdAt: 1791800000000 - index * 60000, state, affected: index === 0 ? 61 : index + 1, errorCode: null, conflicts: [] }));
    });
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await expect(page.getByRole('list', { name: '操作记录' })).toBeVisible();
    await expect(page.getByText('结果不确定', { exact: true })).toBeVisible();
    expect(await page.locator('.history-summary').first().textContent()).not.toContain('operation-');
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `r06-history-${width}x${height}.png`) });
    await page.getByRole('button', { name: '撤销此记录', exact: true }).first().click();
    const steps = page.getByRole('list', { name: '完整撤销差异' });
    await expect(steps.getByRole('listitem')).toHaveCount(61);
    await steps.scrollIntoViewIfNeeded(); await steps.focus(); await page.keyboard.press('End');
    await expect(steps.getByText('之前的标题 60', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消撤销', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(evidence, `r06-undo-${width}x${height}.png`) });
    await page.getByRole('button', { name: '取消撤销', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.includes('apply'))).toBe(false);
    await page.getByRole('button', { name: '备份导出', exact: true }).click();
    await expect(page.getByRole('tab', { name: '备份导出' })).toHaveAttribute('aria-selected', 'true');
    const exportPage = page.locator('.workspace-page').filter({ has: page.getByRole('region', { name: '备份导出' }) });
    await exportPage.evaluate((element) => { element.scrollTop = 0; });
    const title = await page.getByRole('heading', { name: '备份与导出' }).boundingBox();
    const scrollBox = await exportPage.boundingBox();
    const sourceBox = await page.locator('.library-toolbar').boundingBox();
    expect(title!.y).toBeGreaterThanOrEqual(scrollBox!.y);
    expect(title!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);
    await page.screenshot({ path: join(evidence, `r06-export-top-${width}x${height}.png`) });
    for (const status of ['cancelled', 'failed', 'saved']) {
      await page.evaluate((status) => { (window as unknown as { __r06saveStatus: string }).__r06saveStatus = status; }, status);
      await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
      if (status === 'cancelled') await expect(page.getByText('已取消保存，没有生成文件。')).toBeVisible();
      else if (status === 'failed') await expect(page.getByRole('region', { name: '备份导出' }).getByRole('alert')).toContainText('文件未保存');
      else await expect(page.getByText('文件已保存到所选位置。')).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('文件已保存到所选位置。').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `r06-export-result-${width}x${height}.png`) });
  });
}

test('R06 history export navigation retains the selected source and unsaved metadata', async ({ page }) => {
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await page.getByLabel('备注', { exact: true }).fill('R06 未保存备注');
  const source = await page.getByRole('combobox', { name: '书签来源', exact: true }).inputValue();
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await page.getByRole('button', { name: '备份导出', exact: true }).click();
  await expect(page.getByRole('tab', { name: '备份导出' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '备份导出', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '书签来源', exact: true })).toHaveValue(source);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('R06 未保存备注');
  const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
  expect(calls.filter((call) => call === 'save_export' || call === 'tag_set_note' || call === 'apply' || call === 'apply_batch')).toEqual([]);
});
