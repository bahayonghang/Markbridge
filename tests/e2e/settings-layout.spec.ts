import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const phase = process.env.MARKBRIDGE_LAYOUT_PHASE ?? 'after';
const evidence = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', phase);
const sizes = [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480], [1920, 1080]];
for (const [width, height] of sizes) {
  test(`S02 settings geometry ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const geometry = [];
    await mkdir(evidence, { recursive: true });
    for (const tab of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: tab, exact: true });
      await expect(panel).toBeVisible();
      const measurements = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element || !element.getClientRects().length) return null;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight };
        };
        return { main: box('.app-main'), tabs: box('.settings-tabs'), content: box('.settings-scroll'),
          connection: box('.connection-settings'), sources: box('.connection-sources'), setup: box('.connection-setup'),
          export: box('.export-desk'), documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight };
      });
      geometry.push({ tab, ...measurements });
      expect(measurements.documentWidth).toBe(width); expect(measurements.documentHeight).toBe(height);
      if (phase === 'after') {
        expect(await page.locator('.settings-scroll').evaluate(element => element.scrollTop)).toBe(0);
        await expect(page.getByRole('tablist', { name: '设置分类' })).toHaveAttribute('aria-orientation', 'vertical');
        expect(measurements.tabs!.x + measurements.tabs!.width).toBeLessThanOrEqual(measurements.content!.x);
        if (tab === 'Chrome 连接') {
          const { connection, sources, setup } = measurements;
          expect(connection!.width).toBeGreaterThan(0);
          if (connection!.width >= 960) {
            expect(sources!.x + sources!.width).toBeLessThanOrEqual(setup!.x);
            expect(Math.abs(sources!.y - setup!.y)).toBeLessThanOrEqual(1);
          } else expect(sources!.y + sources!.height).toBeLessThanOrEqual(setup!.y);
        }
        const overflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth);
        expect(overflow).toBe(false);
      }
      await page.screenshot({ path: join(evidence, `settings-${tab}-${width}x${height}.png`) });
      const controls = panel.locator('button:visible,input:visible,select:visible,summary:visible');
      for (const control of await controls.all()) {
        await control.scrollIntoViewIfNeeded();
        const rect = await control.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(measurements.main!.x);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
        if (phase === 'after') expect(rect!.x).toBeGreaterThanOrEqual(measurements.content!.x);
      }
    }
    await writeFile(join(evidence, `geometry-${width}x${height}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
  });
}

test('S02 vertical tabs retain library, AI and semantic inputs without implicit effects', async ({ page }) => {
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByLabel('搜索标题或网址').fill('Guidelines');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await page.getByLabel('备注', { exact: true }).fill('S02 未保存备注');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.includes('ai_settings'))).toBe(false);
  const connection = page.getByRole('tab', { name: 'Chrome 连接', exact: true });
  await connection.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'AI', exact: true })).toBeFocused();
  await page.getByLabel('模型', { exact: true }).fill('未保存的 AI 模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  await page.getByLabel('向量模型', { exact: true }).fill('未保存的向量模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).focus();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: '备份导出' })).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: '通用' })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(page.getByRole('tab', { name: '备份导出' })).toBeFocused();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('未保存的 AI 模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  await expect(page.getByLabel('向量模型', { exact: true })).toHaveValue('未保存的向量模型');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('S02 未保存备注');
  const calls = await page.evaluate(() => ({ ordinary: (window as unknown as { __r01calls: string[] }).__r01calls, semantic: (window as unknown as { __semanticCalls: string[] }).__semanticCalls }));
  expect(calls.ordinary.filter(call => ['save_export', 'test_ai', 'preview_edit', 'apply', 'apply_batch', 'content_preview', 'tag_set_note', 'organize'].includes(call))).toEqual([]);
  expect(calls.semantic.filter(call => call !== 'settings')).toEqual([]);
});

for (const scenario of ['preview', 'loading'] as const) {
  test(`S02 keyboard reaches disabled and empty panels during ${scenario}`, async ({ page }) => {
    if (scenario === 'loading') await mockBridge(page, 'loading');
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const name of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      if (scenario === 'preview' && name === 'AI') {
        await page.mouse.move(0, 0);
        const selectedFill = await tab.evaluate(element => getComputedStyle(element).backgroundColor);
        await tab.hover();
        expect(await tab.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(selectedFill);
      }
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await page.keyboard.press('Tab');
      await expect(panel).toBeFocused();
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      await page.keyboard.press('Shift+Tab');
      await expect(tab).toBeFocused();
      if (scenario === 'preview' && (name === 'AI' || name === '语义检索')) {
        const controls = panel.locator('input,select,button');
        expect(await controls.count()).toBeGreaterThan(0);
        for (const control of await controls.all()) await expect(control).toBeDisabled();
      }
      if (scenario === 'preview' && name === '备份导出') {
        await expect(panel.getByText('请先选择可用的书签来源，再导出缓存。')).toBeVisible();
        await expect(panel.locator('input,select,button')).toHaveCount(0);
      }
    }
  });
}

for (const [width, height] of sizes) {
  test(`S02 ignored source and long file source ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
    await page.evaluate(() => {
      const fixture = window as unknown as { __s02state: (patch: unknown) => void; __r07patch: (patch: unknown) => void };
      fixture.__r07patch({ displayName: '资料名称与英文 LongReference'.repeat(4) });
      fixture.__s02state({ mirrors: [{ mirrorSourceId: 'mirror-long', displayName: '只读文件资料'.repeat(8), association: 'independent', pairedProfileId: null, fileStatus: 'stale', watching: true, nodeCount: 19, revision: 3, lastSyncedAt: null, errorCode: null, canWriteBrowser: false }] });
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    expect(await page.locator('.settings-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `pending-${width}x${height}.png`) });
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 建议', exact: true })).toBeInViewport();
    expect(await page.locator('.settings-scroll').evaluate(element => element.scrollTop)).toBe(0);
    await page.getByRole('tab', { name: '备份导出' }).click();
    await page.getByLabel('书签来源').selectOption('mirror:mirror-long');
    await expect(page.getByText('此文件来源没有本地侧车数据。')).toBeVisible();
    await expect(page.getByRole('button', { name: '导出侧车 JSON' })).toHaveCount(0);
    expect(await page.locator('#library-source').count()).toBe(1);
    await page.screenshot({ path: join(evidence, `mirror-export-${width}x${height}.png`) });
  });
}
