import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'captions');

for (const fontSize of [12, 14, 20]) {
  test(`C02 auxiliary captions remain readable at ${fontSize} minimum window`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.addInitScript(fontSize => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme: 'light', font: { kind: 'preset', value: 'system' }, fontSizePx: fontSize })), fontSize);
    await mockBridge(page, 'library'); await page.goto('/');
    await page.getByRole('button', { name: '文件夹', exact: true }).first().click();
    await page.getByRole('treeitem', { name: '书签栏', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true }).check();
    await page.getByRole('button', { name: '移动所选', exact: true }).click();
    await page.locator('.batch-edit-desk .folder-picker > summary').click();
    const folderCaption = page.locator('.batch-edit-desk .folder-choice small').first();
    await expect(folderCaption).toBeVisible();
    await folderCaption.scrollIntoViewIfNeeded();
    const folder = await folderCaption.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const row = node.closest('.library-row')!.getBoundingClientRect();
      return { fontSize: parseFloat(getComputedStyle(node).fontSize), top: bounds.top - row.top, bottom: bounds.bottom - row.top, rowHeight: row.height };
    });
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${fontSize}-folder-640x480.png`) });
    await page.getByRole('button', { name: '整理', exact: true }).click();
    await page.getByRole('button', { name: '检查重复', exact: true }).click();
    const duplicate = page.locator('.duplicate-group small').first();
    await expect(duplicate).toBeVisible();
    const duplicateSize = await duplicate.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await duplicate.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${fontSize}-maintenance-640x480.png`) });
    await page.getByRole('button', { name: '检查链接', exact: true }).click();
    const links = page.locator('.link-results small').first();
    await expect(links).toBeVisible();
    const linkSize = await links.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await writeFile(join(output, `${fontSize}.json`), JSON.stringify({ fontSize, folder, duplicateSize, linkSize }, null, 2));
    expect.soft(folder.fontSize).toBeGreaterThanOrEqual(12);
    expect.soft(duplicateSize).toBeGreaterThanOrEqual(12);
    expect.soft(linkSize).toBeGreaterThanOrEqual(12);
    expect(folder.top).toBeGreaterThanOrEqual(0);
    expect(folder.bottom).toBeLessThanOrEqual(folder.rowHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
  });
}
