import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const before = process.env.MARKBRIDGE_LAYOUT_PHASE === 'before';
const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'workspace-layout');
const sizes = [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480], [1920, 1080], [2549, 1356]];

async function inspect(page: Page, scope: Locator, name: string, file: string) {
  const geometry = await scope.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>('button,input,select,textarea,summary')]
      .filter(control => control.getClientRects().length).map(control => {
        const rect = control.getBoundingClientRect();
        return { label: control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40), x: rect.x, right: rect.right, width: rect.width };
      });
    return { x: bounds.x, right: bounds.right, width: bounds.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, controls,
      documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  if (!before) {
    expect(geometry.documentWidth, name).toBe(geometry.viewportWidth);
    expect(geometry.documentHeight, name).toBe(geometry.viewportHeight);
    expect(geometry.scrollWidth, name).toBeLessThanOrEqual(geometry.clientWidth + 1);
    for (const control of geometry.controls) {
      expect(control.x, `${name}: ${control.label}`).toBeGreaterThanOrEqual(geometry.x - 1);
      expect(control.right, `${name}: ${control.label}`).toBeLessThanOrEqual(geometry.right + 1);
    }
    const last = scope.locator('button:visible,input:visible,select:visible,textarea:visible,summary:visible').last();
    if (await last.count()) {
      await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
      const visible = await last.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        let top = 0, bottom = innerHeight;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
            const rect = parent.getBoundingClientRect(); top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
          }
        }
        return { top: bounds.top - top, bottom: bottom - bounds.bottom };
      });
      expect(visible.top, `${name}: action top`).toBeGreaterThanOrEqual(-1);
      expect(visible.bottom, `${name}: action bottom`).toBeGreaterThanOrEqual(-1);
    }
  }
  // Restore the same top-of-pane framing before both baseline and final captures.
  await scope.evaluate(element => {
    element.scrollTop = 0;
    const scroller = element.closest('.settings-scroll,.workspace-page');
    if (scroller) scroller.scrollTop = 0;
  });
  await page.screenshot({ path: join(output, `${file}-${name}.png`) });
  return { name, ...geometry };
}

for (const theme of ['light', 'dark']) for (const [width, height] of [[640, 480], [1100, 760], [2549, 1356]]) {
  test(`C03 onboarding ${theme} 20 ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
    await page.goto('/');
    const content = page.locator('.settings-content');
    await expect(page.getByRole('region', { name: '首次接入' })).toBeVisible();
    await mkdir(output, { recursive: true });
    const file = `${theme}-20-${width}x${height}`;
    await inspect(page, content, 'onboarding', file);
    await page.getByRole('button', { name: '只读浏览文件' }).click();
    await expect(page.getByLabel('用户数据目录')).toBeVisible();
    await inspect(page, content, 'onboarding-readonly', file);
  });
}

for (const theme of ['light', 'dark']) for (const fontSize of [12, 14, 20]) for (const [width, height] of sizes) {
  if (fontSize === 12 && width !== 640 && width !== 2549) continue;
  if (fontSize === 12 && height === 760) continue;
  test(`C03 workspace ${theme} ${fontSize} ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ theme, fontSize }) => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: fontSize })), { theme, fontSize });
    await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('.list-pane .library-row').first()).toBeVisible();
    await mkdir(output, { recursive: true });
    const file = `${theme}-${fontSize}-${width}x${height}`;
    const measurements = [];
    measurements.push(await inspect(page, page.locator('.library-toolbar'), 'library', file));
    if (!before) {
      const search = (await page.getByLabel('搜索标题或网址').boundingBox())!;
      const button = (await page.getByRole('button', { name: '详情', exact: true }).boundingBox())!;
      expect(search.x + search.width <= button.x + 1 || search.y + search.height <= button.y + 1).toBe(true);
      const list = page.getByRole('listbox', { name: '书签列表', exact: true });
      expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(fontSize === 20 ? 76 : fontSize === 12 ? 52 : 56);
      await expect(list.getByRole('option').first()).toBeInViewport({ ratio: 1 });
      if (width < 800) {
        const folder = page.getByRole('button', { name: '文件夹', exact: true });
        await folder.click();
        const pane = (await page.locator('.folder-pane.is-open').boundingBox())!;
        expect(pane.y + pane.height).toBeLessThanOrEqual(height + 1);
        await page.keyboard.press('Escape'); await expect(folder).toBeFocused();
      }
    }
    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    measurements.push(await inspect(page, page.locator('.detail-pane'), 'detail', file));
    if (!before && width >= 1100) expect((await page.locator('.detail-pane').boundingBox())!.width).toBeCloseTo(Math.min(400, Math.max(312, width * .26)), 0);
    if (!before) {
      await page.locator('.detail-pane').evaluate(element => { element.scrollTop = element.scrollHeight; });
      const heading = (await page.locator('.detail-pane > .pane-heading').boundingBox())!;
      const tabs = (await page.locator('.detail-tabs').boundingBox())!;
      expect(heading.y + heading.height).toBeLessThanOrEqual(tabs.y + 1);
    }
    await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    for (const [button, selector] of [['整理', '.organize-workspace'], ['语义检索', '.semantic-workspace']] as const) {
      await page.getByRole('button', { name: button, exact: true }).click();
      measurements.push(await inspect(page, page.locator(selector), button, file));
      if (!before) expect((await page.locator(selector).boundingBox())!.width).toBeLessThanOrEqual(1040);
    }
    await page.evaluate(() => {
      (window as unknown as { __r06history: unknown[] }).__r06history = ['applied', 'uncertain', 'partial', 'failed', 'rollback_conflict'].map((state, index) => ({ operationId: `layout-${index}`, kind: 'move', createdAt: 1791800000000 - index * 60000, state, affected: index + 1, errorCode: null, conflicts: [] }));
    });
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await expect(page.getByText('结果不确定', { exact: true })).toBeVisible();
    measurements.push(await inspect(page, page.locator('.history-workspace'), 'history', file));
    if (!before) expect((await page.locator('.history-workspace').boundingBox())!.width).toBeLessThanOrEqual(1440);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const name of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      await page.getByRole('tab', { name, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await expect(panel).toBeVisible();
      measurements.push(await inspect(page, panel, `settings-${name}`, file));
      if (!before) {
        expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(name === 'Chrome 连接' ? 1440 : 1040);
        if (name === 'Chrome 连接') {
          const connection = (await page.locator('.connection-settings').boundingBox())!;
          const sources = (await page.locator('.connection-sources').boundingBox())!;
          const setup = (await page.locator('.connection-setup').boundingBox())!;
          if (connection.width >= Math.max(960, 64 * fontSize)) {
            expect(sources.x + sources.width).toBeLessThanOrEqual(setup.x);
            expect(Math.abs(sources.y - setup.y)).toBeLessThanOrEqual(1);
          } else expect(sources.y + sources.height).toBeLessThanOrEqual(setup.y);
        }
        if (name === '通用') {
          const row = panel.locator('.settings-row').first();
          const label = (await row.locator(':scope > :first-child').boundingBox())!;
          const controls = (await row.locator(':scope > :last-child').boundingBox())!;
          if ((await panel.boundingBox())!.width <= Math.max(600, 40 * fontSize)) expect(label.y + label.height).toBeLessThanOrEqual(controls.y);
          else expect(label.x + label.width).toBeLessThanOrEqual(controls.x);
        }
      }
    }
    const calls = await page.evaluate(() => ({ ordinary: (window as unknown as { __r01calls: string[] }).__r01calls, semantic: (window as unknown as { __semanticCalls: string[] }).__semanticCalls }));
    expect(calls.ordinary.filter(call => ['test_ai', 'suggest_ai', 'organize', 'check_links', 'content_preview', 'apply', 'apply_batch', 'save_export'].includes(call))).toEqual([]);
    expect(calls.semantic.filter(call => call !== 'settings' && call !== 'status')).toEqual([]);
    await writeFile(join(output, `${file}.json`), `${JSON.stringify({ phase: before ? 'before' : 'after', theme, fontSize, width, height, measurements }, null, 2)}\n`);
  });
}

test('C03 minimum large-font filters keep keyboard controls reachable and list usable', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.addInitScript(() => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme: 'light', font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })));
  await mockBridge(page, 'sources'); await page.goto('/');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByText('更多搜索范围', { exact: true }).click();
  await page.getByLabel('搜索标题或网址').focus();
  const last = page.getByRole('checkbox', { name: '包含备注', exact: true });
  for (let index = 0; index < 10 && !(await last.evaluate(element => element === document.activeElement)); index += 1) await page.keyboard.press('Tab');
  await expect(last).toBeFocused(); await expect(last).toBeInViewport({ ratio: 1 });
  const toolbar = page.locator('.library-toolbar');
  expect(await toolbar.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0)).toBe(true);
  const list = page.getByRole('listbox', { name: '书签列表', exact: true });
  expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(76);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(list.getByRole('option').first()).toBeInViewport({ ratio: 1 });
});
