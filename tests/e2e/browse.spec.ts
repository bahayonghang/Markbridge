import { expect, test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
  test(`R03 selection and container height ${width}x${height}`, async ({ page }) => {
    await mockBridge(page, 'library');
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/');
    const list = page.getByRole('listbox', { name: '书签列表' });
    await expect(list.getByRole('option').first()).toBeVisible();
    const rowBeforeSelection = await list.getByRole('option').first().boundingBox();
    await list.getByRole('option').nth(0).click({ modifiers: ['Control'] });
    expect((await list.getByRole('option').first().boundingBox())!.y).toBeCloseTo(rowBeforeSelection!.y, 1);
    await list.getByRole('option').nth(2).click({ modifiers: ['Shift'] });
    await expect(list.getByRole('option', { selected: true })).toHaveCount(3);
    await page.keyboard.press('Control+a');
    await expect(page.getByText('已选 24 项', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/browse-selection-${width}x${height}.png` });
    const viewport = await list.boundingBox();
    expect(viewport!.height).toBeGreaterThanOrEqual(52);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    await page.getByLabel('搜索标题或网址').fill('Handbook');
    await expect(page.getByRole('listbox', { name: '搜索结果' }).getByRole('option').first()).toBeVisible();
    await expect(page.getByText('范围已改变，已清除多选。')).toBeVisible();
    await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveCount(0);
    await page.getByRole('button', { name: '清空筛选' }).click();
    await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await expect(page.getByLabel('搜索范围')).toBeVisible();
    await page.getByLabel('搜索范围').selectOption('subtree');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await list.getByRole('option').first().click({ modifiers: ['Control'] });
    await page.getByRole('button', { name: '取消选择', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '当前目录' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled();
  });
}

test('R03 keyboard reaches item 10001 and search match 10001 without rendering the whole library', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __r03nodes: Array.from({ length: 10001 }, (_, index) => ({ chromeId: `wide-${index}`, parentId: '1', position: index, kind: 'bookmark', title: `needle ${index}`, url: `https://example.invalid/${index}` })) });
  });
  await mockBridge(page, 'library');
  await page.goto('/');
  const list = page.getByRole('listbox', { name: '书签列表' });
  await expect(page.getByText(/已加载 200 \/ 10001/)).toBeVisible();
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByText('已选 200 项', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+End');
  await expect(page.getByText(/已加载 10001 \/ 10001/)).toBeVisible();
  const last = list.getByRole('option', { name: /needle 10000/ });
  await expect(last).toBeVisible();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-posinset', '10001');
  await expect(last).toHaveAttribute('aria-setsize', '10001');
  expect(await list.getByRole('option').count()).toBeLessThan(100);
  await page.getByLabel('搜索标题或网址').fill('needle');
  const search = page.getByRole('listbox', { name: '搜索结果' });
  await expect(page.getByText(/已加载 200 \/ 10001/)).toBeVisible();
  await search.getByRole('option').first().focus();
  await page.keyboard.press('Control+End');
  await expect(search.getByRole('option', { name: /needle 10000/ })).toBeFocused();
  await page.screenshot({ path: `${evidence}/browse-10001-last.png` });
});

test('R03 twenty-level Chinese path remains navigable and empty folders open a real create form', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __r03nodes: Array.from({ length: 20 }, (_, index) => ({ chromeId: `folder-${index}`, parentId: index ? `folder-${index - 1}` : '1', position: 0, kind: 'folder', title: `长中文路径阅读资料与研究归档 第${index + 1}层`, url: null })) });
  });
  await mockBridge(page, 'library');
  await page.goto('/');
  await page.getByLabel('搜索标题或网址').fill('第20层');
  const result = page.getByRole('option', { name: /第20层/ });
  await result.dblclick();
  await expect(page.getByText('此文件夹没有书签。')).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: '当前目录' });
  await expect(crumbs.getByRole('button', { name: /第20层/ })).toHaveAttribute('aria-current', 'location');
  await expect(crumbs.getByRole('button', { name: /第20层/ })).toBeInViewport();
  await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-level', '21');
  await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-posinset', '1');
  await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-setsize', '1');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('');
  await page.getByLabel('名称', { exact: true }).fill('新书签');
  await page.getByLabel('网址', { exact: true }).fill('https://example.invalid/new');
  await expect(page.getByRole('button', { name: '预览新书签' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '预览修改' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'apply'))).toEqual([]);
  await page.screenshot({ path: `${evidence}/browse-depth20-create.png` });
});

test('R04 long paths with classic scrollbars keep selection rows stationary and remain keyboard readable in every viewport', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __r03nodes: Array.from({ length: 20 }, (_, index) => ({ chromeId: `folder-${index}`, parentId: index ? `folder-${index - 1}` : '1', position: 0, kind: 'folder', title: `长中文路径阅读资料与研究归档 第${index + 1}层`, url: null })) });
  });
  await mockBridge(page, 'library');
  await page.goto('/');
  await page.addStyleTag({ content: '.library-breadcrumbs::-webkit-scrollbar { height: 16px; } .library-breadcrumbs::-webkit-scrollbar-thumb { background: #606b7c; }' });
  await page.getByLabel('搜索标题或网址').fill('第19层');
  await page.getByRole('option', { name: /第19层/ }).dblclick();
  const row = page.getByRole('option', { name: /第20层/ });
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const crumbs = page.getByRole('navigation', { name: '当前目录' });
    expect(await crumbs.evaluate((node) => node.getBoundingClientRect().height - node.clientHeight)).toBe(16);
    await crumbs.getByRole('button', { name: /第19层/ }).focus();
    await expect(crumbs.getByRole('button', { name: /第19层/ })).toBeInViewport();
    const before = await row.boundingBox();
    await row.click({ modifiers: ['Control'] });
    expect((await row.boundingBox())!.y).toBeCloseTo(before!.y, 1);
    await expect(page.getByRole('navigation', { name: '当前目录' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
    await page.locator('.browse-heading button').last().evaluate((node) => node.focus());
    await expect(page.locator('.browse-heading button').last()).not.toBeFocused();
    const path = page.getByLabel('查看当前目录完整路径');
    await path.click();
    const completePath = page.locator('.selection-path > p');
    await expect(completePath).toContainText('第1层');
    await expect(completePath).toContainText('第19层');
    const bounds = await completePath.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(height!);
    await completePath.focus();
    await page.keyboard.press('End');
    await expect.poll(() => completePath.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    if (width === 640 && height === 480) await page.screenshot({ path: `${evidence}/r04-classic-scrollbar-path-640x480.png` });
    await page.keyboard.press('Escape');
    await expect(path).toBeFocused();
    await expect(completePath).toBeHidden();
    await page.getByRole('button', { name: '取消选择', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '当前目录' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled();
    expect((await row.boundingBox())!.y).toBeCloseTo(before!.y, 1);
  }
});
