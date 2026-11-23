import { expect, test, type Page } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
const sizes = [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }];

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
}

for (const size of sizes) {
  test(`R01 shell and settings ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page, 'library');
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('footer.status-bar')).toHaveCount(0);
    const navButtons = page.locator('.app-sidebar nav.primary-navigation[aria-label="主导航"] > button.nav-button');
    await expect(navButtons).toHaveText(['书签', '整理', '语义检索', '操作历史', '设置']);
    await expect(page.locator('.sidebar-library')).toBeVisible();
    const pill = page.locator('.app-sidebar > button.connection-pill');
    await expect(pill).toBeVisible();
    await expect(pill.locator('svg.workspace-icon')).toHaveCount(1);
    await expect(pill.locator('.dot, .status-dot, .indicator')).toHaveCount(0);
    await expect(pill).toHaveAttribute('aria-label', /已连接 Chrome/);
    const navBox = (await navButtons.last().boundingBox())!;
    const pillBox = (await pill.boundingBox())!;
    expect(pillBox.y).toBeGreaterThan(navBox.y + navBox.height);

    await expect(page.getByRole('option', { name: /Human Interface Guidelines/ }).first()).toBeVisible();
    await expect(page.getByLabel('端口', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('启用 AI')).toHaveCount(0);
    const searchBox = await page.getByLabel('搜索标题或网址').boundingBox();
    const detailButton = await page.getByRole('button', { name: '详情', exact: true }).boundingBox();
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(detailButton!.x);
    if (size.width < 800) {
      const folderButton = page.getByRole('button', { name: '文件夹', exact: true });
      const folderBox = await folderButton.boundingBox();
      expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(folderBox!.x);
      await folderButton.click();
      await expect(page.getByRole('treeitem', { name: '书签栏' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeVisible();
      await expect(page.getByLabel('搜索标题或网址')).not.toBeVisible();
      await page.keyboard.press('Escape');
      await expect(folderButton).toBeFocused();
      await expect(page.getByLabel('搜索标题或网址')).toBeVisible();
    }
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible();
    expect(await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).evaluate((element) => element.getBoundingClientRect().width)).toBe(16);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-library-${size.width}x${size.height}.png` });
    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-detail-${size.width}x${size.height}.png` });
    await page.getByRole('button', { name: '关闭详情，返回列表' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    await page.getByLabel('搜索标题或网址').fill('Guidelines');
    await page.getByRole('button', { name: '整理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '整理书签' })).toBeVisible();
    await expect(page.locator('.sidebar-library')).toHaveAttribute('hidden', '');
    await noOverflow(page);
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await expect(page.getByText('还没有操作记录。')).toBeVisible();
    await expect(page.locator('.sidebar-library')).toHaveAttribute('hidden', '');
    await pill.click();
    await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Chrome 连接', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.sidebar-library')).toHaveAttribute('hidden', '');
    await expect(page.getByLabel('端口', { exact: true })).toHaveCount(0);
    await expect(page.getByText('127.0.0.1:49153', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: '通用' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('tab', { name: 'Chrome 连接' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
    await expect(page.getByLabel('启用 AI')).not.toBeChecked();
    expect(await page.getByLabel('启用 AI').evaluate((element) => element.getBoundingClientRect().width)).toBe(16);
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-ai-${size.width}x${size.height}.png` });
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(page.locator('.sidebar-library')).not.toHaveAttribute('hidden', '');
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
    await expect(page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true })).not.toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => ['test_ai', 'inspect', 'check_links', 'organize', 'apply'].includes(call)))).toEqual([]);
  });
}

test('R01 keeps checkbox keys and focus independent from row actions', async ({ page }) => {
  await mockBridge(page, 'library');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  const checkbox = page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'open_url'))).toEqual([]);
});

test('R01 keeps edit drafts on navigation and stops hidden content previews', async ({ page }) => {
  await mockBridge(page, 'library');
  await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByLabel('新标题', { exact: true }).fill('尚未保存的标题');
  await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
  const reads = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'content_preview').length);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByLabel('端点', { exact: true }).fill('http://localhost:11434');
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.getByText('还没有操作记录。')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'content_preview').length)).toBe(reads);
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('新标题', { exact: true })).toHaveValue('尚未保存的标题');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('tab', { name: '通用', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('端点', { exact: true })).toHaveValue('http://localhost:11434');
});

test('R01 reduced motion keeps pointer presses still and keyboard focus visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '书签', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳至内容' });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px');
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await settings.hover();
  await page.mouse.down();
  expect(await settings.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
});

for (const scenario of ['loading', 'cache-error', 'empty', 'readonly'] as const) {
  test(`R01 distinct ${scenario} state`, async ({ page }) => {
    await mockBridge(page, scenario);
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto('/');
    if (scenario === 'loading') await expect(page.getByText('正在读取书签。').first()).toBeVisible();
    if (scenario === 'cache-error') await expect(page.getByRole('alert')).toContainText('无法读取书签');
    if (scenario === 'empty') await expect(page.getByText('此资料还没有书签。')).toBeVisible();
    if (scenario === 'readonly') {
      await expect(page.getByText(/扩展未连接/)).toBeVisible();
      await expect(page.getByText(/缓存时间：/)).toBeVisible();
      await page.getByText('来源状态与恢复', { exact: true }).click();
      await expect(page.getByRole('button', { name: '检查连接设置', exact: true })).toBeVisible();
      await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
      await expect(page.getByRole('button', { name: '预览修改' })).toBeDisabled();
    }
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/shell-${scenario}-1100x760.png` });
  });
}

test('T4 deduplicates connection status, compacts healthy library header to reclaim >=50px list height, and aligns sidebar brand/nav icons with 8px concentric radii', async ({ page }) => {
  await mockBridge(page, 'library');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

  // 1. Expanded sidebar: .workspace-heading .connection is visually clipped (1x1, inset(50%)), .connection-pill span is visible, role="status" reachable
  const expandedConn = await page.locator('.workspace-heading .connection').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { width: rect.width, height: rect.height, clipPath: style.clipPath, role: el.getAttribute('role'), text: el.textContent };
  });
  expect(expandedConn.role).toBe('status');
  expect(expandedConn.text).toBe('已连接 Chrome');
  expect(expandedConn.width).toBeLessThanOrEqual(1);
  expect(expandedConn.height).toBeLessThanOrEqual(1);
  expect(expandedConn.clipPath).toBe('inset(50%)');
  await expect(page.locator('.connection-pill span')).toBeVisible();
  await expect(page.locator('.connection-pill span')).toHaveText('已连接 Chrome');

  // 2. Sidebar left-axis alignment (brand-mark x === all 5 nav-button icon x within 1px) & DA4 8px concentric inner radius (20px paper - 12px padding)
  const sidebarAlignment = await page.evaluate(() => {
    const sidebarStyle = getComputedStyle(document.querySelector('.app-sidebar')!);
    const brandX = document.querySelector('.brand-mark')!.getBoundingClientRect().x;
    const navIcons = [...document.querySelectorAll('.primary-navigation > .nav-button svg.workspace-icon')].map((el) => el.getBoundingClientRect().x);
    const navRadii = [...document.querySelectorAll('.primary-navigation > .nav-button')].map((el) => getComputedStyle(el).borderRadius);
    const folderRowRadius = getComputedStyle(document.querySelector('.folder-pane .library-row')!).borderRadius;
    const pillRadius = getComputedStyle(document.querySelector('.connection-pill')!).borderRadius;
    return {
      paperRadius: sidebarStyle.borderRadius,
      paperPaddingLeft: sidebarStyle.paddingLeft,
      brandX,
      navIcons,
      navRadii,
      folderRowRadius,
      pillRadius,
    };
  });
  expect(sidebarAlignment.paperRadius).toBe('20px');
  expect(sidebarAlignment.paperPaddingLeft).toBe('12px');
  expect(sidebarAlignment.navIcons).toHaveLength(5);
  for (const iconX of sidebarAlignment.navIcons) {
    expect(Math.abs(iconX - sidebarAlignment.brandX)).toBeLessThanOrEqual(1);
  }
  for (const r of sidebarAlignment.navRadii) expect(r).toBe('8px');
  expect(sidebarAlignment.folderRowRadius).toBe('8px');
  expect(sidebarAlignment.pillRadius).toBe('8px');

  // 3. Healthy live source: compact single-line guidance, zero shortcut noise, >=50px vertical list height reclaimed vs 578px pre-T4 baseline
  const compactGuidance = page.locator('details.source-guidance.source-guidance-compact');
  await expect(compactGuidance).toBeVisible();
  expect(await compactGuidance.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
  await expect(compactGuidance.locator('summary')).toHaveText('实时同步 · 已完成全树核对');
  await expect(page.locator('.library-status')).toHaveCount(0);
  const metaText = await page.locator('.library-list-meta').textContent();
  expect(metaText).toContain('已加载 24 / 24 项');
  expect(metaText).not.toContain('Ctrl+A');
  expect(metaText).not.toContain('Ctrl+End');
  expect(await page.locator('body').textContent()).not.toContain('按 Chrome 顺序');
  expect(await page.locator('body').textContent()).not.toContain('方向键浏览，Enter 打开');

  const virtualRowsBox = (await page.locator('.list-pane .virtual-rows').boundingBox())!;
  // Pre-T4 baseline at 1440x900 (14px font) was 578px in live mode and 538px in local mode
  expect(virtualRowsBox.height - 578).toBeGreaterThanOrEqual(50);
  expect(virtualRowsBox.height).toBeGreaterThanOrEqual(635);

  // Collapsed sidebar (Ctrl+B): .workspace-heading .connection becomes visibly rendered (width > 10)
  await page.keyboard.press('Control+b');
  const collapsedConn = await page.locator('.workspace-heading .connection').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, clipPath: getComputedStyle(el).clipPath };
  });
  expect(collapsedConn.width).toBeGreaterThan(10);
  expect(collapsedConn.height).toBeGreaterThan(10);
  expect(collapsedConn.clipPath).toBe('none');

  // Expand back via button -> clipped again
  await page.getByRole('button', { name: '展开侧栏' }).click();
  expect(await page.locator('.workspace-heading .connection').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);

  // Narrow viewport (<800px): .workspace-heading .connection becomes visibly rendered (width > 10)
  await page.setViewportSize({ width: 640, height: 760 });
  const narrowConn = await page.locator('.workspace-heading .connection').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, clipPath: getComputedStyle(el).clipPath };
  });
  expect(narrowConn.width).toBeGreaterThan(10);
  expect(narrowConn.height).toBeGreaterThan(10);
  expect(narrowConn.clipPath).toBe('none');
  await noOverflow(page);
});

