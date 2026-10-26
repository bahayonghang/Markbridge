import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
import { compositeBackgrounds, contrastRatio, renderedContrastColors } from './contrast';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'airy-glass');

test('alpha composition keeps the real backdrop and rejects unknown surfaces', () => {
  const layer = (color: string) => ({ color, image: 'none', fieldStart: '', fieldEnd: '', isField: false, backdropFilter: 'none', isPaper: false });
  expect(compositeBackgrounds([layer('rgb(0, 0, 0)'), layer('rgba(255, 255, 255, 0.5)')])[0]).toBe('rgb(127.5, 127.5, 127.5)');
  expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21);
  expect(contrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBeLessThan(4.5);
  expect(() => compositeBackgrounds([layer('rgba(255, 255, 255, 0.5)')])).toThrow('VISIBLE_BACKGROUND_NOT_FOUND');
  expect(() => compositeBackgrounds([{ ...layer('rgb(255, 255, 255)'), image: 'url(unknown.png)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKGROUND');
  expect(() => contrastRatio('rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.5)')).toThrow('CONTRAST_BACKGROUND_NOT_COMPOSITED');
  const field = { ...layer('rgb(0, 0, 0)'), image: 'linear-gradient(160deg, rgb(100, 150, 200), rgb(100, 150, 200))', fieldStart: '#6496c8', fieldEnd: '#6496c8', isField: true };
  const paper = { ...layer('rgba(255, 255, 255, 0.5)'), backdropFilter: 'blur(20px) saturate(1.15)', isPaper: true };
  const saturated = compositeBackgrounds([field, paper])[0].match(/[\d.]+/g)!.map(Number);
  for (const [i, expected] of [174.27875, 203.02875, 231.77875].entries()) expect(saturated[i]).toBeCloseTo(expected, 5);
  expect(() => compositeBackgrounds([field, { ...paper, backdropFilter: 'blur(20px) saturate(2)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, { ...paper, isPaper: false }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, paper, paper])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [959, 760], [960, 760], [640, 480]]) {
    test(`airy paper ${theme} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
      await mockBridge(page, 'details'); await page.goto('/');
      await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
      const material = await page.evaluate(() => {
        const workspace = document.querySelector('.workspace')!;
        const style = getComputedStyle(workspace);
        return {
          filter: style.backdropFilter, fill: style.backgroundColor, radius: style.borderRadius,
          field: getComputedStyle(document.getElementById('root')!).backgroundImage,
          filters: [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).backdropFilter !== 'none').map(node => node.className),
          rows: [...document.querySelectorAll('.library-row')].map(node => ({ fill: getComputedStyle(node).backgroundColor, filter: getComputedStyle(node).backdropFilter })),
          width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        };
      });
      expect(material.field).toContain('linear-gradient(160deg,');
      expect(material.filter).toBe(width >= 960 ? 'blur(20px) saturate(1.15)' : 'none');
      expect(material.filters).toEqual(width >= 960 ? ['workspace'] : []);
      expect(material.fill).toBe(theme === 'light' ? `rgba(255, 255, 255, ${width >= 960 ? '0.78' : '0.96'})` : `rgba(30, 38, 43, ${width >= 960 ? '0.9' : '0.96'})`);
      expect(material.radius).toBe(width >= 960 ? '20px' : '0px');
      expect(material.width).toBe(width); expect(material.height).toBe(height);
      for (const row of material.rows) { expect(row.filter).toBe('none'); expect(row.fill).toMatch(/^rgb\(/); }
      for (const selector of ['.brand strong', '.workspace-heading h1', '.status-bar span', '.list-pane .library-url']) {
        const colors = await renderedContrastColors(page.locator(selector).first());
        for (const back of colors.fill) expect(contrastRatio(colors.ink, back), selector).toBeGreaterThanOrEqual(4.5);
      }
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, `${theme}-${width}x${height}.png`) });
    });
  }

  for (const fallback of ['reduced-transparency', 'unsupported-filter', 'forced-colors'] as const) {
    test(`airy ${theme} ${fallback} fallback`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
      if (fallback === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
      if (fallback === 'reduced-transparency') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      }
      await mockBridge(page, 'details'); await page.goto('/');
      await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
      if (fallback === 'unsupported-filter') {
        // Synthetic capability fixture: remove the enhancement, leaving the real base cascade intact.
        const removed = await page.evaluate(() => {
          let count = 0;
          for (const sheet of document.styleSheets) for (let i = sheet.cssRules.length - 1; i >= 0; i -= 1) {
            const rule = sheet.cssRules[i];
            if (rule instanceof CSSSupportsRule && rule.conditionText.includes('backdrop-filter')) { sheet.deleteRule(i); count += 1; }
          }
          return count;
        });
        expect(removed).toBe(1);
      }
      expect(await page.locator('.workspace').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
      if (fallback === 'reduced-transparency') expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
      if (fallback === 'forced-colors') expect(await page.locator('#root').evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
      else expect(await page.locator('.workspace').evaluate(node => getComputedStyle(node).backgroundColor)).toContain('0.96');
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: '选择字体', exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '选择字体', exact: true })).toBeFocused();
      if (fallback === 'forced-colors') {
        // Keep selected text and its descendants on the same system-colored surface;
        // UA text backplates otherwise hide labels inside manually painted highlights.
        const selected = [page.locator('.nav-button[aria-current="page"]'), page.getByRole('tab', { name: '通用', exact: true }), page.locator('.theme-options [aria-pressed="true"]'), page.locator('.font-size-options [aria-pressed="true"]')];
        for (const control of selected) {
          for (const label of [control, ...await control.locator('span').all()]) {
            expect(await label.evaluate(node => getComputedStyle(node).forcedColorAdjust)).toBe('none');
            const colors = await renderedContrastColors(label);
            for (const back of colors.fill) expect(contrastRatio(colors.ink, back)).toBeGreaterThanOrEqual(4.5);
          }
        }
        const focus = await renderedContrastColors(page.getByRole('button', { name: '选择字体', exact: true }));
        expect(parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
        for (const back of focus.outside) expect(contrastRatio(focus.outline, back)).toBeGreaterThanOrEqual(3);
      }
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, `${theme}-${fallback}.png`) });
    });
  }
}

test('reduced motion and keyboard activation never scale the workspace', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const choice = page.getByRole('button', { name: '深色', exact: true });
  await choice.hover(); await page.mouse.down();
  expect(await choice.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  expect(await page.locator('.workspace').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await choice.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await page.keyboard.down('Space');
  expect(await choice.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  await page.keyboard.up('Space');
});
