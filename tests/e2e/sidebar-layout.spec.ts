import { expect, test, type Page } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const LAYOUT_KEY = 'markbridge.layout-preferences.v1';
const UI_KEY = 'markbridge.ui-preferences.v2';

async function noOverflow(page: Page) {
  const actual = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(actual).toEqual(viewport);
}

async function sidebarWidth(page: Page): Promise<number> {
  const box = (await page.locator('.app-sidebar').boundingBox())!;
  return Math.round(box.width);
}

for (const theme of ['light', 'dark'] as const) {
  test(`T1 wide default 256px sidebar, 14px gap, splitter hover/focus visibility, and zero blur (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(({ key, theme }) => {
      localStorage.setItem(key, JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 }));
    }, { key: UI_KEY, theme });
    await mockBridge(page, 'library');
    await page.goto('/');
    await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector('.app-sidebar')!;
      const main = document.querySelector('.app-main')!;
      const sidebarBox = sidebar.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const nonBlurred = [...document.querySelectorAll('.app-sidebar, .app-main, .well-group, .output-well, .library-row')]
        .map((node) => getComputedStyle(node).backdropFilter);
      return {
        sidebarWidth: Math.round(sidebarBox.width),
        gap: Math.round(mainBox.x - (sidebarBox.x + sidebarBox.width)),
        nonBlurred,
      };
    });
    expect(geometry.sidebarWidth).toBe(256);
    expect(geometry.gap).toBe(14);
    expect(geometry.nonBlurred.every((value) => value === 'none')).toBe(true);

    const splitter = page.getByRole('separator', { name: '调整侧栏宽度' });
    await expect(splitter).toBeVisible();
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    await expect(splitter).toHaveAttribute('aria-controls', 'app-sidebar');
    await expect(splitter).toHaveAttribute('aria-valuemin', '200');
    await expect(splitter).toHaveAttribute('aria-valuemax', '420');
    await expect(splitter).toHaveAttribute('aria-valuenow', '256');

    await page.mouse.move(10, 10);
    await expect.poll(() => splitter.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('0');

    await splitter.hover();
    await expect.poll(() => splitter.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');

    await page.mouse.move(10, 10);
    await expect.poll(() => splitter.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('0');

    await page.locator('.connection-pill').focus();
    await page.keyboard.press('Tab');
    await expect(splitter).toBeFocused();
    await expect.poll(() => splitter.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');
    await noOverflow(page);
  });
}

test('T1 splitter pointer drag, Escape cancel, double-click reset, keyboard resize, and dynamic viewport clamp', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockBridge(page, 'library');
  await page.goto('/');
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

  const splitter = page.getByRole('separator', { name: '调整侧栏宽度' });

  // Pointer drag +84px -> 340px persisted on release
  const box1 = (await splitter.boundingBox())!;
  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await page.mouse.down();
  await page.mouse.move(box1.x + box1.width / 2 + 84, box1.y + box1.height / 2, { steps: 5 });
  await expect.poll(() => sidebarWidth(page)).toBe(340);
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', '340');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LAYOUT_KEY)).toEqual({
    version: 1,
    sidebarWidthPx: 340,
    sidebarCollapsed: false,
  });

  // Pointer drag preview + Escape cancel restores 340px without saving
  const box2 = (await splitter.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 + 60, box2.y + box2.height / 2, { steps: 5 });
  await expect.poll(() => sidebarWidth(page)).toBe(400);
  await page.keyboard.press('Escape');
  await expect.poll(() => sidebarWidth(page)).toBe(340);
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(340);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).sidebarWidthPx, LAYOUT_KEY)).toBe(340);

  // Drag past max clamps to 420px and keeps main >= 480px
  const box3 = (await splitter.boundingBox())!;
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.mouse.move(box3.x + box3.width / 2 + 300, box3.y + box3.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(420);
  expect((await page.locator('.app-main').boundingBox())!.width).toBeGreaterThanOrEqual(480);

  // Dynamic clamp on narrower viewport (860x760 -> max 338px, main >= 480px)
  await page.setViewportSize({ width: 860, height: 760 });
  await expect.poll(() => sidebarWidth(page)).toBe(338);
  expect((await page.locator('.app-main').boundingBox())!.width).toBeGreaterThanOrEqual(480);
  await noOverflow(page);

  // Widening back restores persisted 420px
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => sidebarWidth(page)).toBe(420);

  // Double-click resets to 256px
  await splitter.dblclick();
  await expect.poll(() => sidebarWidth(page)).toBe(256);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).sidebarWidthPx, LAYOUT_KEY)).toBe(256);

  // Keyboard resize: ArrowRight, Shift+ArrowRight, ArrowLeft, Shift+ArrowLeft, End, Home
  await page.locator('.connection-pill').focus();
  await page.keyboard.press('Tab');
  await expect(splitter).toBeFocused();
  await page.keyboard.press('ArrowRight');
  expect(await sidebarWidth(page)).toBe(272);
  await expect(splitter).toHaveAttribute('aria-valuenow', '272');

  await page.keyboard.press('Shift+ArrowRight');
  expect(await sidebarWidth(page)).toBe(304);

  await page.keyboard.press('ArrowLeft');
  expect(await sidebarWidth(page)).toBe(288);

  await page.keyboard.press('Shift+ArrowLeft');
  expect(await sidebarWidth(page)).toBe(256);

  await page.keyboard.press('End');
  expect(await sidebarWidth(page)).toBe(420);
  await expect(splitter).toHaveAttribute('aria-valuenow', '420');

  await page.keyboard.press('Home');
  expect(await sidebarWidth(page)).toBe(200);
  await expect(splitter).toHaveAttribute('aria-valuenow', '200');
});

test('T1 wide icon-rail collapse, floating folder overlay, Ctrl+B avoidance, and medium-width collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, sidebarWidthPx: 340, sidebarCollapsed: false }));
  }, LAYOUT_KEY);
  await mockBridge(page, 'library');
  await page.goto('/');
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
  expect(await sidebarWidth(page)).toBe(340);

  // Click collapse button -> 64px icon rail
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect.poll(() => sidebarWidth(page)).toBe(64);
  const collapsedGap = await page.evaluate(() => {
    const sidebarBox = document.querySelector('.app-sidebar')!.getBoundingClientRect();
    const mainBox = document.querySelector('.app-main')!.getBoundingClientRect();
    return Math.round(mainBox.x - (sidebarBox.x + sidebarBox.width));
  });
  expect(collapsedGap).toBe(14);
  await expect(page.getByRole('separator', { name: '调整侧栏宽度' })).not.toBeVisible();
  await expect(page.locator('.brand-mark')).not.toBeVisible();
  await expect(page.locator('.brand strong')).not.toBeVisible();
  await expect(page.locator('.nav-button span').first()).not.toBeVisible();
  await expect(page.locator('.connection-pill span')).not.toBeVisible();
  await expect(page.locator('.folder-pane')).not.toBeVisible();

  const folderToggle = page.getByRole('button', { name: '文件夹', exact: true });
  await expect(folderToggle).toBeVisible();
  await folderToggle.click();

  const folderOverlay = page.locator('.folder-pane.is-open');
  await expect(folderOverlay).toBeVisible();
  await expect(page.getByRole('treeitem', { name: '书签栏' })).toBeFocused();
  const overlayStyle = await folderOverlay.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const listStyle = getComputedStyle(document.querySelector('.library')!);
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      borderRadius: style.borderRadius,
      backdropFilter: style.backdropFilter,
      libraryVisibility: listStyle.visibility,
    };
  });
  expect(overlayStyle.left).toBe(92);
  expect(overlayStyle.top).toBe(70);
  expect(overlayStyle.width).toBe(320);
  expect(overlayStyle.borderRadius).toBe('16px');
  expect(overlayStyle.backdropFilter).toBe('blur(20px) saturate(1.15)');
  expect(overlayStyle.libraryVisibility).toBe('visible');
  await expect(page.locator('.list-pane')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(folderOverlay).not.toBeVisible();
  await expect(folderToggle).toBeFocused();

  // Ctrl+B inside input must NOT toggle collapse
  const search = page.getByLabel('搜索标题或网址');
  await search.focus();
  await page.keyboard.press('Control+b');
  expect(await sidebarWidth(page)).toBe(64);

  // Ctrl+B outside editable controls expands back to custom 340px width
  await page.getByRole('heading', { name: '书签', level: 1 }).focus();
  await page.keyboard.press('Control+b');
  await expect.poll(() => sidebarWidth(page)).toBe(340);

  // Medium width (860x760) non-floating collapse and folder overlay
  await page.setViewportSize({ width: 860, height: 760 });
  await page.keyboard.press('Control+b');
  await expect.poll(() => sidebarWidth(page)).toBe(64);
  await folderToggle.click();
  await expect(folderOverlay).toBeVisible();
  const mediumOverlayBox = (await folderOverlay.boundingBox())!;
  expect(Math.round(mediumOverlayBox.x)).toBe(64);
  expect(Math.round(mediumOverlayBox.y)).toBe(56);
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(folderOverlay).not.toBeVisible();
  await page.keyboard.press('Control+b');
  await expect.poll(() => sidebarWidth(page)).toBe(338);
  await noOverflow(page);
});

test('T1 persists across reload, isolates from appearance reset, and recovers from corrupted storage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockBridge(page, 'library');
  await page.goto('/');
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

  // Persist custom width 340px and collapsed state
  const splitter = page.getByRole('separator', { name: '调整侧栏宽度' });
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 84, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect.poll(() => sidebarWidth(page)).toBe(64);

  // Reload restores collapsed state and remembers 340px width when expanded
  await page.reload();
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
  expect(await sidebarWidth(page)).toBe(64);
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect.poll(() => sidebarWidth(page)).toBe(340);

  // 「恢复默认外观」 must not touch markbridge.layout-preferences.v1
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认外观', exact: true }).click();
  const stored = await page.evaluate(({ layoutKey, uiKey }) => ({
    layout: JSON.parse(localStorage.getItem(layoutKey)!),
    ui: JSON.parse(localStorage.getItem(uiKey)!),
  }), { layoutKey: LAYOUT_KEY, uiKey: UI_KEY });
  expect(stored.ui).toEqual({ version: 2, theme: 'system', font: { kind: 'preset', value: 'system' }, fontSizePx: 14 });
  expect(stored.layout).toEqual({ version: 1, sidebarWidthPx: 340, sidebarCollapsed: false });
  expect(await sidebarWidth(page)).toBe(340);

  // Corrupted JSON silently falls back to 256px expanded
  await page.evaluate((key) => localStorage.setItem(key, '{corrupted'), LAYOUT_KEY);
  await page.reload();
  await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
  expect(await sidebarWidth(page)).toBe(256);
  await expect(page.getByRole('button', { name: '收起侧栏' })).toBeVisible();
});

for (const persistedCollapsed of [false, true]) {
  test(`T1 keeps zero overflow at 640x480 minimum viewport (persistedCollapsed=${persistedCollapsed})`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.addInitScript(({ key, collapsed }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, sidebarWidthPx: 380, sidebarCollapsed: collapsed }));
    }, { key: LAYOUT_KEY, collapsed: persistedCollapsed });
    await mockBridge(page, 'library');
    await page.goto('/');
    await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

    expect(await sidebarWidth(page)).toBe(64);
    await expect(page.locator('.sidebar-collapse-button')).not.toBeVisible();
    await expect(page.getByRole('separator', { name: '调整侧栏宽度' })).not.toBeVisible();
    await expect(page.locator('.brand-mark')).toBeVisible();
    await noOverflow(page);

    const folderButton = page.getByRole('button', { name: '文件夹', exact: true });
    await folderButton.click();
    await expect(page.locator('.folder-pane.is-open')).toBeVisible();
    expect(await page.locator('.library').evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await expect(folderButton).toBeFocused();
    await noOverflow(page);
  });
}
