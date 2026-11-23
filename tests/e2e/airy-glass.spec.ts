import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
import { compositeBackgrounds, contrastRatio, renderedContrastColors, splitTopLevel, type Layer } from './contrast';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'airy-glass');

test('alpha composition keeps the real backdrop and rejects unknown surfaces', () => {
  const layer = (color: string): Layer => ({
    color,
    image: 'none',
    fieldStart: '',
    fieldEnd: '',
    blobStart: '',
    blobEnd: '',
    blobMid: '',
    isField: false,
    backdropFilter: 'none',
    isPaper: false,
  });
  expect(compositeBackgrounds([layer('rgb(0, 0, 0)'), layer('rgba(255, 255, 255, 0.5)')])[0]).toBe('rgb(127.5, 127.5, 127.5)');
  expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21);
  expect(contrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBeLessThan(4.5);
  expect(() => compositeBackgrounds([layer('rgba(255, 255, 255, 0.5)')])).toThrow('VISIBLE_BACKGROUND_NOT_FOUND');
  expect(() => compositeBackgrounds([{ ...layer('rgb(255, 255, 255)'), image: 'url(unknown.png)', isField: true }])).toThrow('UNSUPPORTED_CONTRAST_BACKGROUND');
  expect(() => contrastRatio('rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.5)')).toThrow('CONTRAST_BACKGROUND_NOT_COMPOSITED');

  const fieldImage = [
    'radial-gradient(42rem 32rem at 12% 6%, rgba(210, 231, 254, 0.7), rgba(0, 0, 0, 0) 70%)',
    'radial-gradient(40rem 32rem at 92% 96%, rgba(202, 229, 206, 0.7), rgba(0, 0, 0, 0) 70%)',
    'radial-gradient(30rem 24rem at 82% 10%, rgba(214, 237, 238, 0.7), rgba(0, 0, 0, 0) 70%)',
    'linear-gradient(160deg, rgb(232, 243, 255), rgb(229, 243, 231))',
  ].join(', ');
  const field: Layer = {
    ...layer('rgb(0, 0, 0)'),
    image: fieldImage,
    fieldStart: '#E8F3FF',
    fieldEnd: '#E5F3E7',
    blobStart: 'rgba(210, 231, 254, 0.70)',
    blobEnd: 'rgba(202, 229, 206, 0.70)',
    blobMid: 'rgba(214, 237, 238, 0.70)',
    isField: true,
  };
  const paper: Layer = { ...layer('rgba(255, 255, 255, 0.62)'), isPaper: true };
  const samples = compositeBackgrounds([field, paper]);
  expect(samples).toHaveLength(14);
  const startSample = samples[0].match(/[\d.]+/g)!.map(Number);
  for (const [i, expected] of [246.26, 250.44, 255].entries()) expect(startSample[i]).toBeCloseTo(expected, 2);

  expect(() => compositeBackgrounds([{ ...field, image: 'linear-gradient(160deg, rgb(232, 243, 255), rgb(229, 243, 231))' }])).toThrow('UNSUPPORTED_CONTRAST_BACKGROUND');
  expect(() => compositeBackgrounds([{ ...field, blobStart: 'rgba(255, 0, 0, 0.7)' }])).toThrow('CONTRAST_FIELD_TOKEN_DRIFT');
  expect(() => compositeBackgrounds([field, { ...paper, backdropFilter: 'blur(20px) saturate(1.15)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, paper, { ...layer('rgb(255, 255, 255)'), isRow: true, backdropFilter: 'blur(8px)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [959, 760], [960, 760], [1440, 550], [640, 480]]) {
    test(`airy paper ${theme} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
      await mockBridge(page, 'details');
      await page.goto('/');
      await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

      const material = await page.evaluate(() => {
        const root = document.getElementById('root')!;
        const workspace = document.querySelector('.workspace')!;
        const sidebar = document.querySelector('.app-sidebar')!;
        const main = document.querySelector('.app-main')!;
        const rootStyle = getComputedStyle(root);
        const workspaceStyle = getComputedStyle(workspace);
        const sidebarStyle = getComputedStyle(sidebar);
        const mainStyle = getComputedStyle(main);
        const sidebarBox = sidebar.getBoundingClientRect();
        const mainBox = main.getBoundingClientRect();
        return {
          rootPadding: rootStyle.paddingLeft,
          field: rootStyle.backgroundImage,
          workspaceFill: workspaceStyle.backgroundColor,
          workspaceFilter: workspaceStyle.backdropFilter,
          gap: mainBox.x - (sidebarBox.x + sidebarBox.width),
          sidebarInset: sidebarBox.x,
          sidebar: { fill: sidebarStyle.backgroundColor, filter: sidebarStyle.backdropFilter, radius: sidebarStyle.borderRadius, shadow: sidebarStyle.boxShadow },
          main: { fill: mainStyle.backgroundColor, filter: mainStyle.backdropFilter, radius: mainStyle.borderRadius, shadow: mainStyle.boxShadow },
          filters: [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).backdropFilter !== 'none').map(node => node.className),
          rows: [...document.querySelectorAll('.library-row')].map(node => ({ fill: getComputedStyle(node).backgroundColor, filter: getComputedStyle(node).backdropFilter })),
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        };
      });

      const fieldLayers = splitTopLevel(material.field);
      expect(fieldLayers).toHaveLength(4);
      expect(fieldLayers.slice(0, 3).every(layer => /^radial-gradient\(/.test(layer))).toBe(true);
      expect(fieldLayers[3]).toMatch(/^linear-gradient\(160deg,/);
      expect(material.workspaceFill).toBe('rgba(0, 0, 0, 0)');
      expect(material.workspaceFilter).toBe('none');
      expect(material.filters).toEqual([]);

      const wide = width >= 960 && height >= 551;
      if (wide) {
        expect(material.gap).toBeGreaterThanOrEqual(12);
        expect(material.gap).toBeLessThanOrEqual(16);
        expect(material.sidebarInset).toBeGreaterThanOrEqual(12);
        expect(material.sidebarInset).toBeLessThanOrEqual(16);
        expect(material.sidebar.radius).toBe('20px');
        expect(material.main.radius).toBe('20px');
        expect(material.sidebar.shadow).not.toBe('none');
        expect(material.main.shadow).not.toBe('none');
      } else {
        expect(material.gap).toBe(0);
        expect(material.sidebarInset).toBe(0);
        expect(material.sidebar.radius).toBe('0px');
        expect(material.main.radius).toBe('0px');
        expect(material.sidebar.shadow).toBe('none');
        expect(material.main.shadow).toBe('none');
      }

      const expectedFill = theme === 'light'
        ? (wide ? 'rgba(255, 255, 255, 0.62)' : 'rgba(255, 255, 255, 0.96)')
        : (wide ? 'rgba(28, 37, 48, 0.6)' : 'rgba(28, 37, 48, 0.96)');
      expect(material.sidebar.fill).toBe(expectedFill);
      expect(material.main.fill).toBe(expectedFill);
      expect(material.sidebar.filter).toBe('none');
      expect(material.main.filter).toBe('none');
      expect(material.width).toBe(width);
      expect(material.height).toBe(height);

      for (const row of material.rows) {
        expect(row.filter).toBe('none');
        expect(row.fill).toMatch(/^rgb\(/);
      }

      const selectors = width >= 800
        ? ['.brand strong', '.workspace-heading h1', '.connection-pill span', '.list-pane .library-url']
        : ['.workspace-heading h1', '.connection-pill', '.list-pane .library-url'];
      for (const selector of selectors) {
        const colors = await renderedContrastColors(page.locator(selector).first());
        for (const back of colors.fill) expect(contrastRatio(colors.ink, back), selector).toBeGreaterThanOrEqual(4.5);
      }

      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, `${theme}-${width}x${height}.png`) });
    });
  }

  for (const fallback of ['reduced-transparency', 'forced-colors'] as const) {
    test(`airy ${theme} ${fallback} fallback`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
      if (fallback === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
      if (fallback === 'reduced-transparency') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      }
      await mockBridge(page, 'details');
      await page.goto('/');
      await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

      for (const paperSelector of ['.app-sidebar', '.app-main']) {
        expect(await page.locator(paperSelector).evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
      }
      if (fallback === 'reduced-transparency') {
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
        for (const paperSelector of ['.app-sidebar', '.app-main']) {
          expect(await page.locator(paperSelector).evaluate(node => getComputedStyle(node).backgroundColor)).toContain('0.96');
        }
      }
      if (fallback === 'forced-colors') {
        expect(await page.locator('#root').evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
      }

      for (const selector of ['.brand strong', '.workspace-heading h1', '.connection-pill span', '.list-pane .library-url']) {
        const colors = await renderedContrastColors(page.locator(selector).first());
        for (const back of colors.fill) expect(contrastRatio(colors.ink, back), `${fallback} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }

      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: '选择字体', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '选择字体', exact: true })).toBeFocused();

      if (fallback === 'forced-colors') {
        await page.getByRole('button', { name: '16 px', exact: true }).click();
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
        await page.getByLabel('字号', { exact: true }).fill('20');
        await page.getByLabel('字号', { exact: true }).press('Enter');
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
  await mockBridge(page, 'details');
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const choice = page.getByRole('button', { name: '深色', exact: true });
  await choice.hover();
  await page.mouse.down();
  expect(await choice.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  expect(await page.locator('.workspace').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await choice.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.down('Space');
  expect(await choice.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  await page.keyboard.up('Space');
});
