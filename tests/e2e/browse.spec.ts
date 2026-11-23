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
    expect(await crumbs.evaluate((node) => {
      if (!(node instanceof HTMLElement)) throw new Error('EXPECTED_HTML_BREADCRUMBS');
      return node.offsetHeight - node.clientHeight;
    })).toBe(16);
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

test('T2 decoupled folder tree chevrons, keyboard navigation, 8-level indent, smart toggle, and refresh persistence', async ({ page }) => {
  await page.addInitScript(() => {
    const folders = Array.from({ length: 9 }, (_, index) => ({
      chromeId: `f-${index + 1}`,
      parentId: index === 0 ? '1' : `f-${index}`,
      position: 0,
      kind: 'folder',
      title: `第${index + 1}层目录`,
      url: null,
    }));
    const siblingLeaf = { chromeId: 'f-leaf', parentId: '1', position: 1, kind: 'folder', title: '平级叶目录', url: null };
    const bookmarks = [
      { chromeId: 'bm-home', parentId: '1', position: 2, kind: 'bookmark', title: '首页指南', url: 'https://example.invalid/home' },
      { chromeId: 'bm-deep', parentId: 'f-2', position: 1, kind: 'bookmark', title: '深层书签', url: 'https://example.invalid/deep' },
      { chromeId: 'bm-leaf', parentId: 'f-leaf', position: 0, kind: 'bookmark', title: '叶目录书签', url: 'https://example.invalid/leaf' },
    ];
    Object.assign(window, { __r03nodes: [...folders, siblingLeaf, ...bookmarks] });
  });
  await mockBridge(page, 'sources');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const rootRow = page.getByRole('treeitem', { name: '书签栏', exact: true });
  const firstLevelRow = page.getByRole('treeitem', { name: '第1层目录', exact: true });
  const leafRow = page.getByRole('treeitem', { name: '平级叶目录', exact: true });
  await expect(firstLevelRow).toBeVisible();
  await expect(leafRow).toBeVisible();

  // AC1: 24x24 chevron vs equal spacer alignment & 40px folder row height & chevron transform
  const rootChevron = rootRow.locator('button.tree-chevron');
  const firstChevron = firstLevelRow.locator('button.tree-chevron');
  const leafSpacer = leafRow.locator('.tree-chevron-spacer');
  await expect(firstChevron).toHaveAttribute('aria-label', '展开 第1层目录');
  await expect(firstChevron).toHaveAttribute('aria-expanded', 'false');
  await expect(firstChevron).toHaveAttribute('tabindex', '-1');
  await expect(leafRow.locator('button.tree-chevron')).toHaveCount(0);
  await expect(leafSpacer).toHaveAttribute('aria-hidden', 'true');

  const firstChevronBox = (await firstChevron.boundingBox())!;
  const leafSpacerBox = (await leafSpacer.boundingBox())!;
  expect(Math.round(firstChevronBox.width)).toBe(24);
  expect(Math.round(firstChevronBox.height)).toBe(24);
  expect(Math.round(leafSpacerBox.width)).toBe(24);
  expect((await firstLevelRow.boundingBox())!.height).toBe(40);

  const firstIconX = (await firstLevelRow.locator('.tree-icon').boundingBox())!.x;
  const leafIconX = (await leafRow.locator('.tree-icon').boundingBox())!.x;
  expect(firstIconX).toBeCloseTo(leafIconX, 1);

  expect(await rootChevron.locator('.workspace-icon').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  expect(await firstChevron.locator('.workspace-icon').evaluate((el) => getComputedStyle(el).transform)).toBe('none');

  // AC2: Chevron click preserves active folder, query, and checked bookmarks
  await leafRow.click();
  await expect(leafRow).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('搜索标题或网址').fill('叶目录书签');
  const leafBookmarkCheck = page.getByRole('checkbox', { name: '选择 叶目录书签', exact: true });
  await leafBookmarkCheck.check();
  await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible();

  await firstChevron.click();
  await expect(page.getByRole('treeitem', { name: '第2层目录', exact: true })).toBeVisible();
  await expect(leafRow).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('叶目录书签');
  await expect(leafBookmarkCheck).toBeChecked();

  // AC3: Single-click selects without expanding; dblclick toggles; breadcrumb expands ancestors
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await firstChevron.click();
  await expect(page.getByRole('treeitem', { name: '第2层目录', exact: true })).toHaveCount(0);

  await firstLevelRow.click();
  await expect(firstLevelRow).toHaveAttribute('aria-selected', 'true');
  await expect(firstLevelRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('treeitem', { name: '第2层目录', exact: true })).toHaveCount(0);

  await firstLevelRow.dblclick();
  const secondLevelRow = page.getByRole('treeitem', { name: '第2层目录', exact: true });
  await expect(secondLevelRow).toBeVisible();
  await expect(firstLevelRow).toHaveAttribute('aria-expanded', 'true');
  await firstLevelRow.dblclick();
  await expect(secondLevelRow).toHaveCount(0);

  // Navigate to 第2层目录 via list dblclick -> collapses 书签栏 & 第1层目录 -> click breadcrumb 第2层目录
  await page.getByRole('option', { name: /第2层目录/ }).dblclick();
  await expect(secondLevelRow).toHaveAttribute('aria-selected', 'true');
  await expect(secondLevelRow).toHaveAttribute('aria-expanded', 'false');
  await firstChevron.click();
  await rootChevron.click();
  await expect(firstLevelRow).toHaveCount(0);
  await page.getByRole('navigation', { name: '当前目录' }).getByRole('button', { name: '第2层目录', exact: true }).click();
  await expect(secondLevelRow).toBeVisible();
  await expect(secondLevelRow).toHaveAttribute('aria-selected', 'true');
  await expect(secondLevelRow).toHaveAttribute('aria-expanded', 'false');

  // AC4: Tab focus into tree causes zero side effects, Arrow/Home/End/Enter work cleanly
  await page.getByLabel('搜索标题或网址').fill('深层');
  await firstChevron.click();
  await rootChevron.click();
  await expect(firstLevelRow).toHaveCount(0);
  const headerToggle = page.locator('.folder-tree-action');
  await headerToggle.focus();
  await page.keyboard.press('Tab');
  await expect(rootRow).toBeFocused();
  await expect(rootRow).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('深层');

  await page.keyboard.press('ArrowRight');
  await expect(firstLevelRow).toBeVisible();
  await expect(rootRow).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(firstLevelRow).toBeFocused();
  await expect(firstLevelRow).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('');
  await page.keyboard.press('ArrowRight');
  await expect(secondLevelRow).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(secondLevelRow).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(firstLevelRow).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(secondLevelRow).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(leafRow).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rootRow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rootRow).toHaveAttribute('aria-selected', 'true');

  // AC5: Smart Collapse All / Expand All + 8-level 14px indent cap + indent guides
  await page.getByRole('button', { name: '全部收起', exact: true }).click();
  await expect(rootRow).toHaveAttribute('aria-expanded', 'false');
  await expect(firstLevelRow).toHaveCount(0);

  await page.getByRole('button', { name: '全部展开', exact: true }).click();
  const eighthLevelRow = page.getByRole('treeitem', { name: '第8层目录', exact: true });
  const ninthLevelRow = page.getByRole('treeitem', { name: '第9层目录', exact: true });
  await expect(ninthLevelRow).toBeVisible();
  await expect(ninthLevelRow).toHaveAttribute('aria-level', '10');
  expect(await firstLevelRow.locator('.tree-row-content').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('14px');
  expect(await eighthLevelRow.locator('.tree-row-content').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('112px');
  expect(await ninthLevelRow.locator('.tree-row-content').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('112px');
  await expect(firstLevelRow.locator('.tree-indent-guide')).toHaveCount(1);
  await expect(eighthLevelRow.locator('.tree-indent-guide')).toHaveCount(8);
  await expect(ninthLevelRow.locator('.tree-indent-guide')).toHaveCount(8);

  // AC6: Collapse-all survives revision refresh; switching source resets to expanded roots
  await page.getByRole('button', { name: '全部收起', exact: true }).click();
  await expect(rootRow).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => (window as unknown as { __r07patch: (patch: Record<string, unknown>) => void }).__r07patch({}));
  await expect(rootRow).toHaveAttribute('aria-expanded', 'false');
  await expect(firstLevelRow).toHaveCount(0);

  await page.getByLabel('书签来源').selectOption('profile:profile-second');
  await expect(rootRow).toHaveAttribute('aria-expanded', 'true');
  await expect(firstLevelRow).toBeVisible();
});

test('T2 chevron respects prefers-reduced-motion', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __r03nodes: [{ chromeId: 'f-1', parentId: '1', position: 0, kind: 'folder', title: '子目录', url: null }] });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockBridge(page, 'library');
  await page.goto('/');
  const chevronIcon = page.getByRole('treeitem', { name: '书签栏', exact: true }).locator('button.tree-chevron .workspace-icon');
  await expect(chevronIcon).toBeVisible();
  expect(await chevronIcon.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});
