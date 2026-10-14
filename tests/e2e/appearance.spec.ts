import { expect, test, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const key = 'markbridge.ui-preferences.v1';
const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'appearance');
const sizes = [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480], [1920, 1080]];
const categories = ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出'];
for (const theme of ['light', 'dark']) for (const fontSize of ['standard', 'large']) for (const [width, height] of sizes) {
  test(`S03 appearance ${theme} ${fontSize} ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ key, theme, fontSize }) => localStorage.setItem(key, JSON.stringify({ version: 1, theme, font: 'system', fontSize })), { key, theme, fontSize });
    await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
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
      expect(measured.rootText).toBe(fontSize === 'large' ? '15px' : '13px');
      expect(measured.documentWidth).toBe(width); expect(measured.documentHeight).toBe(height);
      expect(measured.tabs.right).toBeLessThanOrEqual(measured.content.x);
      expect(measured.content.scrollTop).toBe(0);
      for (const control of measured.controls) { expect(control.x).toBeGreaterThanOrEqual(measured.content.x - 1); expect(control.right).toBeLessThanOrEqual(measured.content.right + 1); }
      geometry.push({ tab, ...measured });
      await page.screenshot({ path: join(output, `${theme}-${fontSize}-${tab}-${width}x${height}.png`) });
      const last = panel.locator('button,input,select,textarea').last();
      if (await last.count()) { await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport(); }
    }
    await writeFile(join(output, `${theme}-${fontSize}-${width}x${height}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    await page.getByRole('button', { name: '吊销配对', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: /^吊销“.+”的配对？$/ })).toBeVisible();
    await page.screenshot({ path: join(output, `${theme}-${fontSize}-confirmation-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '吊销配对', exact: true }).first()).toBeFocused();
  });
}

test('S03 system changes, explicit theme, all fonts/sizes and reset preserve data without implicit business calls', async ({ page }) => {
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
    await page.getByLabel('字体', { exact: true }).selectOption(font);
    for (const fontSize of ['small', 'standard', 'large']) {
      await page.getByLabel('字号', { exact: true }).selectOption(fontSize);
      const css = await page.locator('.appearance-sample p').first().evaluate(node => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize }));
      expect(css.size).toBe({ small: '12px', standard: '13px', large: '15px' }[fontSize]); measurements.push({ selectedFont: font, fontSize, ...css });
      expect(css.font).toContain(font === 'song' ? 'SimSun' : font === 'yahei' ? 'Microsoft YaHei UI' : 'Segoe UI Variable Text');
    }
  }
  await page.evaluate(() => localStorage.setItem('unrelated-local-setting', 'keep'));
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('字体', { exact: true })).toHaveValue('song');
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue('large');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await expect(page.getByLabel('字体', { exact: true })).toHaveValue('system');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-local-setting'))).toBe('keep');
  const calls = await page.evaluate(() => ({ bridge: (window as unknown as { __r01calls: string[] }).__r01calls, semantic: (window as unknown as { __semanticCalls: string[] }).__semanticCalls }));
  for (const forbidden of ['suggest_ai', 'content_preview', 'check_links', 'apply', 'save_config']) expect(calls.bridge).not.toContain(forbidden);
  expect(calls.semantic).toEqual([]);
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'font-size-css.json'), JSON.stringify(measurements, null, 2));
});

test('S03 preserves unknown version and applies storage failure truthfully', async ({ page }) => {
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

for (const rowCount of [24, 120]) test(`S03 hidden library font resize keeps visible row/offset, selection, note draft, checkbox focus and last item (${rowCount} rows)`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (rowCount === 120) await page.addInitScript(() => {
    (window as unknown as { __r03nodes: unknown[] }).__r03nodes = Array.from({ length: 120 }, (_, index) => ({
      chromeId: String(index + 10), parentId: '1', position: index, kind: 'bookmark',
      title: index === 0 ? 'Human Interface Guidelines' : `S03 Reference ${index + 1}`,
      url: `https://example.com/reference/${index}`,
    }));
  });
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  const savedNote = await page.getByLabel('备注', { exact: true }).inputValue();
  await page.getByLabel('备注', { exact: true }).fill('S03 保留的未保存备注');
  const list = page.getByRole('listbox', { name: '书签列表', exact: true });
  await list.evaluate(node => { node.scrollTop = 10 * 52 + 9; });
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(529);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('字号', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(609);
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('S03 保留的未保存备注');
  await expect(page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).first()).toBeChecked();
  const visible = list.getByRole('option').filter({ has: page.locator('.library-title') });
  expect(await visible.first().evaluate(node => node.getBoundingClientRect().height)).toBe(60);
  const active = page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first();
  await active.focus(); await page.keyboard.press('End');
  await expect(page.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('S03 保留的未保存备注');
  await page.getByLabel('备注', { exact: true }).fill(savedNote);
  await active.focus(); await page.keyboard.press('End');
  await expect(page.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿并继续' }).click();
  const last = list.locator(`[aria-posinset="${rowCount}"]`); await expect(last).toBeInViewport();
  await last.locator('input[type="checkbox"]').focus(); await page.keyboard.press('Space');
  await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  for (const fontSize of ['standard', 'large']) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('字号', { exact: true }).selectOption(fontSize);
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(last).toBeInViewport();
    await expect.poll(() => list.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(1);
  }
  await last.locator('input[type="checkbox"]').focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Home');
  await expect(list.locator('[aria-posinset="1"]')).toBeInViewport();
});

for (const theme of ['light', 'dark']) {
  test(`S03 ${theme} contrast uses rendered semantic colors`, async ({ page }) => {
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ version: 1, theme, font: 'system', fontSize: 'standard' })), { key, theme });
    await mockBridge(page, 'sources'); await page.goto('/');
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
      const luminance = (hex: string) => {
        const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const pairs: [string, string, number][] = [
        ['ink', 'surface', 4.5], ['muted', 'surface', 4.5], ['muted', 'sidebar', 4.5], ['blue', 'selected', 4.5],
        ['danger', 'surface', 4.5], ['caution', 'surface', 4.5], ['disabled-ink', 'disabled-surface', 4.5],
        ['primary-ink', 'primary-fill', 4.5], ['primary-ink', 'primary-hover', 4.5],
        ['control-border', 'surface', 3], ['control-border', 'disabled-surface', 3], ['blue', 'surface', 3], ['blue', 'selected', 3],
        ['primary-border', 'surface', 3], ['primary-border', 'canvas', 3],
      ];
      return pairs.map(([foreground, background, minimum]) => { const a = luminance(color(foreground)), b = luminance(color(background)); return { foreground, background, foregroundColor: color(foreground), backgroundColor: color(background), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum }; });
    });
    for (const pair of contrast) expect(pair.ratio, `${pair.foreground}/${pair.background}`).toBeGreaterThanOrEqual(pair.minimum);
    const renderedConsumers: { name: string; foreground: string; background: string; ratio: number; minimum: number }[] = [];
    async function checkConsumer(name: string, locator: Locator, boundary = false, focus = false) {
      const colors = await locator.evaluate(node => {
        function background(element: Element | null): string {
          for (let current = element; current; current = current.parentElement) {
            const color = getComputedStyle(current).backgroundColor;
            if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
          }
          throw new Error('VISIBLE_BACKGROUND_NOT_FOUND');
        }
        const style = getComputedStyle(node);
        return { ink: style.color, fill: background(node), outside: background(node.parentElement), border: style.borderColor, borderStyle: style.borderStyle, outline: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      const pairs: [string, string, string, number][] = [['text', colors.ink, colors.fill, 4.5]];
      if (boundary) { expect(colors.borderStyle).toBe('solid'); pairs.push(['boundary', colors.border, colors.outside, 3]); }
      if (focus) { expect(colors.outlineStyle).toBe('solid'); expect(parseFloat(colors.outlineWidth)).toBeGreaterThanOrEqual(2); pairs.push(['focus', colors.outline, colors.outside, 3]); }
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)?.map(Number);
        if (!values || values.length !== 3) throw new Error(`EXPECTED_OPAQUE_RGB: ${color}`);
        const rgb = values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      for (const [state, foreground, background, minimum] of pairs) {
        const a = luminance(foreground), b = luminance(background);
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        expect(ratio, `${theme} ${name} ${state}`).toBeGreaterThanOrEqual(minimum);
        renderedConsumers.push({ name: `${name} ${state}`, foreground, background, ratio, minimum });
      }
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const category = page.getByRole('tab', { name: 'Chrome 连接', exact: true });
    await category.click();
    await checkConsumer('selected category', category);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
    await expect(category).toBeFocused();
    await checkConsumer('selected category keyboard', category, false, true);
    await checkConsumer('text control', page.getByLabel('资料名称', { exact: true }), true);
    const disabled = page.getByRole('button', { name: '连接已启动', exact: true });
    await expect(disabled).toBeDisabled();
    await checkConsumer('disabled listener', disabled, true);
    const primary = page.getByRole('button', { name: '生成配对串', exact: true });
    const before = await primary.evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor, ink: getComputedStyle(node).color }));
    await checkConsumer('primary normal', primary, true);
    await primary.hover();
    expect(await primary.evaluate(node => getComputedStyle(node).borderColor)).toBe(before.border);
    await checkConsumer('primary hover', primary, true);
    await page.getByRole('button', { name: '吊销配对', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /^吊销“.+”的配对？$/ });
    const confirm = dialog.getByRole('button', { name: '确认吊销配对', exact: true });
    await checkConsumer('confirmation action', confirm, true);
    await page.keyboard.press('Tab'); await expect(confirm).toBeFocused();
    await checkConsumer('confirmation keyboard', confirm, true, true);
    await page.keyboard.press('Escape');
    await mkdir(output, { recursive: true }); await writeFile(join(output, `${theme}-contrast.json`), JSON.stringify({ contrast, renderedPrimary: before, renderedConsumers }, null, 2));
  });
  for (const scenario of ['empty', 'loading', 'cache-error', 'startup-error'] as const) {
    test(`S03 ${theme} large minimum ${scenario} states`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 480 });
      await page.addInitScript(({ key, theme }) => localStorage.setItem(key, JSON.stringify({ version: 1, theme, font: 'system', fontSize: 'large' })), { key, theme });
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
        await expect(page.getByRole('button', { name: '连接已启动', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '连接已启动', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `${theme}-large-disabled-${scenario}-640x480.png`) });
      }
    });
  }
}
