import { expect, test, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
import { contrastRatio, renderedContrastColors } from './contrast';

const key = 'markbridge.ui-preferences.v2';
const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'appearance');
const sizes = [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480], [1920, 1080], [2549, 1356]];
const categories = ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出'];
for (const theme of ['light', 'dark']) for (const fontSize of [12, 14, 20]) for (const [width, height] of sizes) {
  test(`C02 appearance ${theme} ${fontSize} ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ key, theme, fontSize }) => localStorage.setItem(key, JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: fontSize })), { key, theme, fontSize });
    await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
    const row = page.locator('.list-pane .library-row').first();
    await expect(row).toBeVisible();
    const rowGeometry = await row.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const title = node.querySelector('.library-title')!.getBoundingClientRect();
      const caption = node.querySelector('.library-url')!;
      return { rowHeight: bounds.height, titleTop: title.top - bounds.top, captionBottom: caption.getBoundingClientRect().bottom - bounds.top, captionSize: parseFloat(getComputedStyle(caption).fontSize) };
    });
    expect(rowGeometry.rowHeight).toBe(({ 12: 52, 14: 56, 20: 76 } as Record<number, number>)[fontSize]);
    expect(rowGeometry.titleTop).toBeGreaterThanOrEqual(0);
    expect(rowGeometry.captionBottom).toBeLessThanOrEqual(rowGeometry.rowHeight);
    expect(rowGeometry.captionSize).toBeGreaterThanOrEqual(12);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
    await mkdir(output, { recursive: true });
    const geometry = [];
    for (const tab of categories) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: tab, exact: true });
      await expect(panel).toBeVisible();
      const measured = await page.evaluate(() => {
        const tabs = document.querySelector('.settings-tabs')!.getBoundingClientRect();
        const content = document.querySelector('.settings-scroll')!.getBoundingClientRect();
        const controls = [...document.querySelectorAll<HTMLElement>('.settings-content input,.settings-content select,.settings-content button')].filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, height: r.height, name: node.getAttribute('aria-label') ?? node.textContent }; });
        return { theme: document.documentElement.dataset.theme, rootText: getComputedStyle(document.documentElement).fontSize, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, tabs: { x: tabs.x, right: tabs.right, width: tabs.width }, content: { x: content.x, right: content.right, scrollTop: document.querySelector('.settings-scroll')!.scrollTop }, controls };
      });
      expect(measured.theme).toBe(theme);
      expect(measured.rootText).toBe(`${fontSize}px`);
      expect(measured.documentWidth).toBe(width); expect(measured.documentHeight).toBe(height);
      expect(measured.tabs.right).toBeLessThanOrEqual(measured.content.x);
      expect(measured.content.scrollTop).toBe(0);
      for (const control of measured.controls) { expect(control.x).toBeGreaterThanOrEqual(measured.content.x - 1); expect(control.right).toBeLessThanOrEqual(measured.content.right + 1); }
      geometry.push({ tab, ...measured, rowGeometry });
      await page.screenshot({ path: join(output, `${theme}-${fontSize}-${tab}-${width}x${height}.png`) });
      const last = panel.locator('button,input,select,textarea').last();
      if (await last.count()) { await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport(); }
    }
    await writeFile(join(output, `${theme}-${fontSize}-${width}x${height}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    await page.getByRole('button', { name: '断开并忽略', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: /^断开并忽略“.+”？$/ })).toBeVisible();
    await page.screenshot({ path: join(output, `${theme}-${fontSize}-confirmation-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '断开并忽略', exact: true }).first()).toBeFocused();
  });
}

test('C02 system changes, explicit theme, all fonts/sizes and reset preserve data without implicit business calls', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' }); await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const measurements = [];
  for (const font of ['system', 'yahei', 'song']) {
    await page.getByRole('button', { name: '选择字体', exact: true }).click();
    await page.getByRole('button', { name: ({ system: '系统字体', yahei: '微软雅黑', song: '宋体' } as Record<string, string>)[font], exact: true }).click();
    await page.getByRole('button', { name: '使用此字体', exact: true }).click();
    for (const fontSize of [12, 14, 20]) {
      await page.getByLabel('字号', { exact: true }).fill(String(fontSize));
      await page.getByLabel('字号', { exact: true }).press('Enter');
      const css = await page.locator('.appearance-sample p').first().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize }));
      expect(css.size).toBe(`${fontSize}px`); measurements.push({ selectedFont: font, fontSize, ...css });
      expect(css.font).toContain(font === 'song' ? 'SimSun' : font === 'yahei' ? 'Microsoft YaHei UI' : 'Segoe UI Variable Text');
    }
  }
  await page.getByLabel('字号', { exact: true }).fill('11');
  await page.getByLabel('字号', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toHaveText('请输入 12–20 之间的整数；当前字号保持不变。');
  await page.getByRole('button', { name: '13 px', exact: true }).click();
  await expect(page.getByRole('button', { name: '13 px', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue('13');
  await page.getByLabel('字号', { exact: true }).fill('20');
  await page.getByLabel('字号', { exact: true }).press('Enter');
  await page.evaluate(() => localStorage.setItem('unrelated-local-setting', 'keep'));
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#ui-font-current')).toHaveText('宋体');
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue('20');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await expect(page.locator('#ui-font-current')).toHaveText('系统字体');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-local-setting'))).toBe('keep');
  const calls = await page.evaluate(() => ({ bridge: (window as unknown as { __r01calls: string[] }).__r01calls, semantic: (window as unknown as { __semanticCalls: string[] }).__semanticCalls }));
  for (const forbidden of ['suggest_ai', 'content_preview', 'check_links', 'apply', 'save_config']) expect(calls.bridge).not.toContain(forbidden);
  expect(calls.semantic).toEqual([]);
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'font-size-css.json'), JSON.stringify(measurements, null, 2));
});

test('C02 preserves unknown version and applies storage failure truthfully', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{"version":99,"theme":"dark"}'), key);
  await mockBridge(page, 'sources'); await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '跟随系统' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{"version":99,"theme":"dark"}');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('alert')).toHaveText('当前外观已应用，但未能保存。重启后可能恢复默认。');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{"version":99,"theme":"dark"}');
});

for (const rowCount of [24, 120]) test(`C02 hidden library font resize keeps visible row/offset, selection, note draft, checkbox focus and last item (${rowCount} rows)`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (rowCount === 120) await page.addInitScript(() => {
    (window as unknown as { __r03nodes: unknown[] }).__r03nodes = Array.from({ length: 120 }, (_, index) => ({
      chromeId: String(index + 10), parentId: '1', position: index, kind: 'bookmark',
      title: index === 0 ? 'Human Interface Guidelines' : `C02 Reference ${index + 1}`,
      url: `https://example.com/reference/${index}`,
    }));
  });
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  const savedNote = await page.getByLabel('备注', { exact: true }).inputValue();
  await page.getByLabel('备注', { exact: true }).fill('C02 保留的未保存备注');
  const list = page.getByRole('listbox', { name: '书签列表', exact: true });
  await list.evaluate(node => { node.scrollTop = 10 * 56 + 9; });
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(569);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('字号', { exact: true }).fill('20');
  await page.getByLabel('字号', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(769);
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('C02 保留的未保存备注');
  await expect(page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).first()).toBeChecked();
  const visible = list.getByRole('option').filter({ has: page.locator('.library-title') });
  expect(await visible.first().evaluate(node => node.getBoundingClientRect().height)).toBe(76);
  const active = page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first();
  await active.focus(); await page.keyboard.press('End');
  await expect(page.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('C02 保留的未保存备注');
  await page.getByLabel('备注', { exact: true }).fill(savedNote);
  await active.focus(); await page.keyboard.press('End');
  await expect(page.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿并继续' }).click();
  const last = list.locator(`[aria-posinset="${rowCount}"]`); await expect(last).toBeInViewport();
  await last.locator('input[type="checkbox"]').focus(); await page.keyboard.press('Space');
  await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  for (const fontSize of [14, 20]) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('字号', { exact: true }).fill(String(fontSize));
      await page.getByLabel('字号', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(last).toBeInViewport();
    await expect.poll(() => list.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(1);
  }
  await last.locator('input[type="checkbox"]').focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Home');
  await expect(list.locator('[aria-posinset="1"]')).toBeInViewport();
});

for (const theme of ['light', 'dark']) {
  test(`C02 ${theme} contrast uses rendered semantic colors`, async ({ page }) => {
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), { key, theme });
    await mockBridge(page, 'sources'); await page.goto('/');
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
      const luminance = (hex: string) => {
        const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const pairs: [string, string, number][] = [
        ['ink', 'surface', 4.5], ['muted', 'surface', 4.5], ['muted', 'sidebar', 4.5], ['accent', 'selected', 4.5],
        ['danger', 'surface', 4.5], ['caution', 'surface', 4.5], ['disabled-ink', 'disabled-surface', 4.5],
        ['primary-ink', 'primary-fill', 4.5], ['primary-ink', 'primary-hover', 4.5], ['primary-ink', 'primary-pressed', 4.5],
        ['muted', 'hover', 4.5], ['muted', 'pressed', 4.5], ['muted', 'selected', 4.5],
        ['control-border', 'surface', 3], ['control-border', 'disabled-surface', 3], ['focus', 'surface', 3], ['focus', 'selected', 3],
        ['primary-border', 'surface', 3], ['primary-border', 'canvas', 3],
      ];
      return pairs.map(([foreground, background, minimum]) => { const a = luminance(color(foreground)), b = luminance(color(background)); return { foreground, background, foregroundColor: color(foreground), backgroundColor: color(background), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum }; });
    });
    for (const pair of contrast) expect(pair.ratio, `${pair.foreground}/${pair.background}`).toBeGreaterThanOrEqual(pair.minimum);
    const renderedConsumers: { name: string; foreground: string; background: string; ratio: number; minimum: number }[] = [];
    async function checkConsumer(name: string, locator: Locator, boundary = false, focus = false) {
      const colors = await renderedContrastColors(locator);
      if (boundary) expect(colors.borderStyle).toBe('solid');
      if (focus) { expect(colors.outlineStyle).toBe('solid'); expect(parseFloat(colors.outlineWidth)).toBeGreaterThanOrEqual(2); }
      for (let sample = 0; sample < colors.fill.length; sample += 1) {
        const pairs: [string, string, string, number][] = [['text', colors.ink, colors.fill[sample], 4.5]];
        if (boundary) pairs.push(['boundary', colors.border, colors.outside[sample], 3]);
        if (focus) pairs.push(['focus', colors.outline, colors.outside[sample], 3]);
        for (const [state, foreground, background, minimum] of pairs) {
          const ratio = contrastRatio(foreground, background);
          expect(ratio, `${theme} ${name} ${state} field sample ${sample}`).toBeGreaterThanOrEqual(minimum);
          renderedConsumers.push({ name: `${name} ${state} field sample ${sample}`, foreground, background, ratio, minimum });
        }
      }
    }

    await checkConsumer('library title', page.locator('.list-pane .library-title').first());
    await checkConsumer('library URL', page.locator('.list-pane .library-url').first());
    const libraryNav = page.locator('.app-sidebar').getByRole('button', { name: '书签', exact: true });
    await checkConsumer('selected navigation', libraryNav);
    const bookmark = page.getByRole('option', { name: /Human Interface Guidelines/ }).first();
    await bookmark.click();
    const selectedFill = await bookmark.evaluate(node => getComputedStyle(node).backgroundColor);
    await bookmark.hover();
    expect(await bookmark.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(selectedFill);
    await checkConsumer('selected bookmark hover', bookmark.locator('.library-title'));
    await checkConsumer('selected bookmark URL', bookmark.locator('.library-url'));
    const infoTab = page.getByRole('tab', { name: '信息', exact: true });
    const selectedTabFill = await infoTab.evaluate(node => getComputedStyle(node).backgroundColor);
    await infoTab.hover();
    expect(await infoTab.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(selectedTabFill);
    await checkConsumer('selected detail tab hover', infoTab);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const themeGroup = page.locator('.segmented-control.theme-options');
    await expect(themeGroup).toBeVisible();
    const sizeGroup = page.locator('.segmented-control.font-size-options');
    await expect(sizeGroup.getByRole('button')).toHaveText(['13 px', '14 px', '16 px']);
    const themeChoice = page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true });
    await expect(themeChoice).toHaveCSS('font-weight', '600');
    await expect(themeChoice).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(themeChoice).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(28, 37, 48)');
    await checkConsumer('selected theme', themeChoice);
    await themeChoice.hover();
    await page.mouse.down();
    await checkConsumer('selected theme pressed', themeChoice);
    await page.mouse.up();
    const category = page.getByRole('tab', { name: 'Chrome 连接', exact: true });
    await category.click();
    await checkConsumer('selected category', category);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
    await expect(category).toBeFocused();
    await checkConsumer('selected category keyboard', category, false, true);
    await page.getByText('其他接入方式：只读文件来源', { exact: true }).click();
    const pathInput = page.getByLabel('用户数据目录', { exact: true });
    await expect(pathInput).toHaveCSS('border-radius', '12px');
    await checkConsumer('text control', pathInput, true);
    const disabled = page.getByRole('button', { name: '重新读取', exact: true });
    await expect(disabled).toBeDisabled();
    await checkConsumer('disabled listener', disabled);
    const disabledFill = await disabled.evaluate(node => getComputedStyle(node).backgroundColor);
    await disabled.hover();
    expect(await disabled.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(disabledFill);
    await checkConsumer('disabled listener hover', disabled);
    const enumSubmit = page.getByRole('button', { name: '枚举资料', exact: true });
    await expect(enumSubmit).not.toHaveClass(/primary-button/);
    await expect(enumSubmit).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await checkConsumer('secondary submit normal', enumSubmit);
    await enumSubmit.hover();
    await checkConsumer('secondary submit hover', enumSubmit);
    await page.mouse.down();
    await checkConsumer('secondary submit pressed', enumSubmit);
    await page.mouse.move(0, 0); await page.mouse.up();
    const ordinary = page.getByRole('button', { name: '浏览此资料', exact: true }).first();
    await ordinary.hover(); await checkConsumer('ordinary hover', ordinary);
    await page.mouse.down(); await checkConsumer('ordinary pressed', ordinary);
    await page.mouse.move(0, 0); await page.mouse.up();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    const primary = page.getByRole('button', { name: '保存配置', exact: true });
    await expect(primary).toHaveClass(/primary-button/);
    await expect(primary).toHaveCSS('background-color', theme === 'light' ? 'rgb(31, 108, 176)' : 'rgb(130, 192, 255)');
    const before = await primary.evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor, ink: getComputedStyle(node).color }));
    await checkConsumer('primary normal', primary);
    await primary.hover();
    expect(await primary.evaluate(node => getComputedStyle(node).borderColor)).toBe(before.border);
    await checkConsumer('primary hover', primary);
    await page.mouse.down();
    await checkConsumer('primary pressed', primary);
    await page.mouse.move(0, 0); await page.mouse.up();
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    await page.getByRole('button', { name: '断开并忽略', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /^断开并忽略“.+”？$/ });
    await expect(dialog).toHaveCSS('border-radius', '16px');
    const confirm = dialog.getByRole('button', { name: '确认断开并忽略', exact: true });
    await checkConsumer('confirmation action', confirm, true);
    await checkConsumer('confirmation copy', dialog.locator('p').first());
    await page.keyboard.press('Tab'); await expect(confirm).toBeFocused();
    await checkConsumer('confirmation keyboard', confirm, true, true);
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${theme}-contrast-dialog.png`) });
    await page.keyboard.press('Escape');
    await enumSubmit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await checkConsumer('connection validation error', page.getByRole('alert'));
    for (const scenario of ['readonly', 'loading', 'cache-error', 'startup-error'] as const) {
      await mockBridge(page, scenario); await page.goto('/');
      const state = scenario === 'readonly' ? page.locator('.access-note') : scenario === 'loading'
        ? page.locator('.list-pane').getByRole('status').filter({ hasText: '正在读取书签' })
        : page.getByRole('alert');
      await expect(state).toBeVisible();
      await checkConsumer(`${scenario} state`, state);
    }
    await mkdir(output, { recursive: true }); await writeFile(join(output, `${theme}-contrast.json`), JSON.stringify({ contrast, renderedPrimary: before, renderedConsumers }, null, 2));
  });
  for (const scenario of ['empty', 'loading', 'cache-error', 'startup-error'] as const) {
    test(`C02 ${theme} large minimum ${scenario} states`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 480 });
      await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), { key, theme });
      await mockBridge(page, scenario); await page.goto('/');
      if (scenario === 'startup-error') await expect(page.getByRole('alert')).toContainText('无法读取启动状态');
      else if (scenario === 'cache-error') await expect(page.getByRole('alert')).toContainText('无法读取书签');
      else if (scenario === 'loading') await expect(page.getByRole('status').filter({ hasText: '正在读取书签' })).toBeVisible();
      else await expect(page.getByText('此文件夹没有书签。')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
      await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${theme}-large-${scenario}-640x480.png`) });
      if (scenario !== 'startup-error') {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
        await page.getByText('其他接入方式：只读文件来源', { exact: true }).click();
        await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '重新读取', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `${theme}-large-disabled-${scenario}-640x480.png`) });
      }
    });
  }
}

test('T6 window theme syncs on startup, system changes, explicit theme selection, and reset without console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  const readThemes = () => page.evaluate(() => (window as unknown as { __windowThemes?: string[] }).__windowThemes ?? []);

  await page.emulateMedia({ colorScheme: 'light' });
  await mockBridge(page, 'details');
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const startupThemes = await readThemes();
  expect(startupThemes.length).toBeGreaterThanOrEqual(1);
  expect(startupThemes.every((theme) => theme === 'system')).toBe(true);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const afterDarkMedia = await readThemes();
  expect(afterDarkMedia.length).toBeGreaterThan(startupThemes.length);
  expect(afterDarkMedia.at(-1)).toBe('system');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const afterLight = await readThemes();
  expect(afterLight.at(-1)).toBe('light');

  await page.emulateMedia({ colorScheme: 'light' });
  expect((await readThemes()).length).toBe(afterLight.length);

  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await readThemes()).at(-1)).toBe('dark');

  await page.getByRole('button', { name: '恢复默认外观', exact: true }).click();
  expect((await readThemes()).at(-1)).toBe('system');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
