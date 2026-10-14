import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const key = 'markbridge.ui-preferences.v2';
const legacyKey = 'markbridge.ui-preferences.v1';
const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'font-picker');
for (const theme of ['light', 'dark']) test(`C02 ${theme} installed font preview keyboard apply cancel and bounded1000 list at20px640x480`, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.addInitScript(({ key, theme }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 }));
    (window as unknown as { __c02Fonts: unknown }).__c02Fonts = { status: 'ready', families: [{ family: 'Arial', displayName: 'Arial' }, { family: 'Microsoft YaHei UI', displayName: '微软雅黑 UI' }, ...Array.from({ length: 1000 }, (_, index) => ({ family: `Synthetic Font ${index}`, displayName: `Synthetic Font ${index}` }))] };
  }, { key, theme });
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __c02FontCalls?: number }).__c02FontCalls ?? 0)).toBe(0);
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  const globalFont = await page.locator('.appearance-sample').evaluate(node => getComputedStyle(node).fontFamily);
  const trigger = page.getByRole('button', { name: '选择字体', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: '选择字体' });
  const search = dialog.getByLabel('搜索已安装字体'); await expect(search).toBeFocused();
  await expect(dialog.getByText('找到 1002 个字体族')).toBeVisible();
  expect(await dialog.getByRole('option').count()).toBeLessThan(20);
  await search.fill('YaHei'); await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('微软雅黑'); await expect(dialog.getByRole('option')).toHaveCount(1);
  await search.fill('Arial'); await search.press('ArrowDown');
  const arial = dialog.getByRole('option', { name: 'Arial' }); await expect(arial).toBeFocused();
  await expect(arial).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.font-picker-sample p[lang="en"]').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Arial');
  expect(await arial.evaluate(node => getComputedStyle(node).fontFamily)).toBe(globalFont);
  expect(await page.locator('.appearance-sample').evaluate(node => getComputedStyle(node).fontFamily)).toBe(globalFont);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); expect(await page.evaluate(() => (window as unknown as { __c02FontCalls: number }).__c02FontCalls)).toBe(1);
  await search.fill('Arial'); await search.press('ArrowDown');
  await dialog.getByRole('button', { name: '刷新字体列表' }).click();
  await expect(search).toHaveValue('Arial'); await expect(arial).toHaveAttribute('aria-selected', 'true');
  const apply = dialog.getByRole('button', { name: '使用此字体' }); await apply.scrollIntoViewIfNeeded(); await expect(apply).toBeInViewport();
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(640); expect(bounds!.height).toBeLessThanOrEqual(480);
  await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, `${theme}-20-640x480-actions.png`) });
  await apply.focus(); await apply.press('Enter'); await expect(dialog).not.toBeVisible();
  await expect(page.locator('#ui-font-current')).toHaveText('Arial');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key); expect(saved.font).toEqual({ kind: 'installed', family: 'Arial' });
  const calls = await page.evaluate(() => ({ font: (window as unknown as { __c02FontCalls: number }).__c02FontCalls, business: (window as unknown as { __r01calls: string[] }).__r01calls }));
  expect(calls).toEqual({ font: 2, business: [] });
  await writeFile(join(output, `${theme}-20-640x480.json`), JSON.stringify({ bounds, saved, calls, fixture: 'synthetic catalog; not native font existence evidence' }, null, 2));
});

for (const font of ['system', 'yahei', 'song']) for (const [fontSize, px] of [['small', 12], ['standard', 13], ['large', 15]] as const) test(`C02 legacy ${font} ${fontSize} migrates read-only and reset preserves v1`, async ({ page }) => {
  const legacy = JSON.stringify({ version: 1, theme: 'dark', font, fontSize });
  await page.addInitScript(({ legacyKey, legacy }) => localStorage.setItem(legacyKey, legacy), { legacyKey, legacy });
  await mockBridge(page, 'sources'); await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue(String(px));
  await expect(page.locator('html')).toHaveAttribute('data-font', font);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue('14');
  expect(await page.evaluate(legacyKey => localStorage.getItem(legacyKey), legacyKey)).toBe(legacy);
});

test('C02 font failures empty catalogs late close/reopen and missing-font recovery stay truthful', async ({ page }) => {
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ version: 2, theme: 'light', font: { kind: 'installed', family: 'Synthetic Missing Family' }, fontSizePx: 14 }));
    (window as unknown as { __c02FontLoad: unknown }).__c02FontLoad = () => new Promise(resolve => { (window as unknown as { __c02Resolve: unknown }).__c02Resolve = resolve; });
  }, key);
  await mockBridge(page, 'sources'); await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).click();
  const trigger = page.getByRole('button', { name: '选择字体', exact: true });
  await trigger.click(); await page.keyboard.press('Escape'); await trigger.click();
  expect(await page.evaluate(() => (window as unknown as { __c02FontCalls: number }).__c02FontCalls)).toBe(1);
  await page.evaluate(() => { const state = window as unknown as { __c02Resolve: (result: unknown) => void; __c02FontLoad: () => Promise<unknown> }; state.__c02FontLoad = async () => ({ status: 'unavailable', reason: 'enumeration_failed' }); state.__c02Resolve({ status: 'ready', families: [] }); });
  await expect(page.getByText(/无法读取字体列表/)).toBeVisible();
  await expect(page.getByText('所选字体当前不可用，已使用备用字体。')).not.toBeVisible();
  await page.evaluate(() => { (window as unknown as { __c02FontLoad: () => Promise<unknown> }).__c02FontLoad = async () => ({ status: 'ready', families: [] }); });
  await page.getByRole('button', { name: '刷新字体列表' }).click(); await expect(page.getByText('未找到已安装字体，可使用兼容预设。')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用此字体' })).toBeDisabled(); await page.keyboard.press('Escape');
  await expect(page.getByText('所选字体当前不可用，已使用备用字体。')).toBeVisible();
  await trigger.click();
  await page.evaluate(() => { (window as unknown as { __c02FontLoad: () => Promise<unknown> }).__c02FontLoad = async () => ({ status: 'ready', families: [{ family: 'Synthetic Missing Family', displayName: 'Recovered fixture' }] }); });
  await page.getByRole('button', { name: '刷新字体列表' }).click(); await expect(page.getByRole('option', { name: /Recovered fixture/ })).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByText('所选字体当前不可用，已使用备用字体。')).not.toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).font.family, key)).toBe('Synthetic Missing Family');
});
