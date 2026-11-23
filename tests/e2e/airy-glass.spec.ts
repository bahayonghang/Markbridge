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
  expect(() => compositeBackgrounds([field, { ...paper, isOverlay: true, backdropFilter: 'blur(20px) saturate(1.15)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, paper, { ...layer('rgb(255, 255, 255)'), isRow: true, backdropFilter: 'blur(8px)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, paper, { ...layer('rgba(0, 0, 0, 0)'), isRow: true, isOverlay: true, backdropFilter: 'blur(20px) saturate(1.15)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');
  expect(() => compositeBackgrounds([field, paper, { ...layer('rgba(255, 255, 255, 0.82)'), backdropFilter: 'blur(20px) saturate(1.15)' }])).toThrow('UNSUPPORTED_CONTRAST_BACKDROP');

  const lightOverlaySamples = compositeBackgrounds([field, paper, { ...layer('rgba(255, 255, 255, 0.82)'), isOverlay: true, backdropFilter: 'blur(20px) saturate(1.15)' }]);
  expect(lightOverlaySamples).toHaveLength(14);
  for (const back of lightOverlaySamples) {
    expect(contrastRatio('#24303a', back)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#5c6b76', back)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('rgba(36, 48, 58, 0.54)', back)).toBeGreaterThanOrEqual(3);
  }

  const darkFieldImage = [
    'radial-gradient(48rem 36rem at 14% 10%, rgba(27, 43, 60, 0.7), rgba(0, 0, 0, 0) 70%)',
    'radial-gradient(46rem 36rem at 88% 92%, rgba(5, 54, 22, 0.7), rgba(0, 0, 0, 0) 70%)',
    'radial-gradient(36rem 28rem at 80% 14%, rgba(6, 41, 43, 0.7), rgba(0, 0, 0, 0) 70%)',
    'linear-gradient(160deg, rgb(18, 26, 34), rgb(11, 31, 16))',
  ].join(', ');
  const darkField: Layer = {
    ...layer('rgb(0, 0, 0)'),
    image: darkFieldImage,
    fieldStart: '#121a22',
    fieldEnd: '#0b1f10',
    blobStart: 'rgba(27, 43, 60, 0.7)',
    blobEnd: 'rgba(5, 54, 22, 0.7)',
    blobMid: 'rgba(6, 41, 43, 0.7)',
    isField: true,
  };
  const darkPaper: Layer = { ...layer('rgba(28, 37, 48, 0.6)'), isPaper: true };
  const darkOverlaySamples = compositeBackgrounds([darkField, darkPaper, { ...layer('rgba(30, 40, 52, 0.84)'), isOverlay: true, backdropFilter: 'blur(20px) saturate(1.15)' }]);
  expect(darkOverlaySamples).toHaveLength(14);
  for (const back of darkOverlaySamples) {
    expect(contrastRatio('#e7edf3', back)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#a3afbd', back)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('rgba(255, 255, 255, 0.36)', back)).toBeGreaterThanOrEqual(3);
  }
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
        const listPane = document.querySelector('.list-pane')!;
        const detailPane = document.querySelector('.detail-pane')!;
        const searchInput = document.querySelector('#library-search')!;
        const rootStyle = getComputedStyle(root);
        const workspaceStyle = getComputedStyle(workspace);
        const sidebarStyle = getComputedStyle(sidebar);
        const mainStyle = getComputedStyle(main);
        const listPaneStyle = getComputedStyle(listPane);
        const detailPaneStyle = getComputedStyle(detailPane);
        const searchInputStyle = getComputedStyle(searchInput);
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
          main: { fill: mainStyle.backgroundColor, filter: mainStyle.backdropFilter, radius: mainStyle.borderRadius, shadow: mainStyle.boxShadow, borderColor: mainStyle.borderTopColor },
          listPane: { fill: listPaneStyle.backgroundColor, filter: listPaneStyle.backdropFilter },
          detailPane: { fill: detailPaneStyle.backgroundColor, filter: detailPaneStyle.backdropFilter },
          searchInput: { fill: searchInputStyle.backgroundColor, filter: searchInputStyle.backdropFilter },
          dividerColor: getComputedStyle(document.querySelector('.workspace-heading')!).borderBottomColor,
          nonBlurred: [...document.querySelectorAll('.app-sidebar, .app-main, .well-group, .output-well, .library-row')].map(node => getComputedStyle(node).backdropFilter),
          filters: [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).backdropFilter !== 'none').map(node => node.className),
          rows: [...document.querySelectorAll('.library-row')].map(node => ({
            fill: getComputedStyle(node).backgroundColor,
            filter: getComputedStyle(node).backdropFilter,
            active: node.classList.contains('is-active'),
          })),
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
      expect(material.listPane).toEqual({ fill: 'rgba(0, 0, 0, 0)', filter: 'none' });
      expect(material.detailPane).toEqual({ fill: 'rgba(0, 0, 0, 0)', filter: 'none' });
      expect(material.searchInput).toEqual({ fill: 'rgba(0, 0, 0, 0)', filter: 'none' });
      expect(material.nonBlurred.every(value => value === 'none')).toBe(true);
      expect(material.dividerColor).toBe(theme === 'light' ? 'rgba(36, 48, 58, 0.1)' : 'rgba(231, 237, 243, 0.1)');
      if (theme === 'dark' && wide) {
        expect(material.main.borderColor).toBe('rgba(255, 255, 255, 0.12)');
        expect(material.main.shadow).toContain('rgba(255, 255, 255, 0.1)');
      }
      expect(material.width).toBe(width);
      expect(material.height).toBe(height);

      expect(material.rows.some(row => !row.active)).toBe(true);
      for (const row of material.rows) {
        expect(row.filter).toBe('none');
        expect(row.fill).toBe(row.active ? (theme === 'light' ? 'rgb(235, 245, 255)' : 'rgb(35, 50, 66)') : 'rgba(0, 0, 0, 0)');
      }

      const selectors = width >= 800
        ? ['.brand strong', '.workspace-heading h1', '.connection-pill span', '.list-pane .library-title', '.list-pane .library-url']
        : ['.workspace-heading h1', '.connection-pill', '.list-pane .library-title', '.list-pane .library-url'];
      for (const selector of selectors) {
        const colors = await renderedContrastColors(page.locator(selector).first());
        for (const back of colors.fill) expect(contrastRatio(colors.ink, back), selector).toBeGreaterThanOrEqual(4.5);
      }
      const iconColors = await renderedContrastColors(page.locator('.list-pane .library-kind').first());
      for (const back of iconColors.fill) expect(contrastRatio(iconColors.ink, back), '.list-pane .library-kind').toBeGreaterThanOrEqual(3);
      const searchColors = await renderedContrastColors(page.locator('#library-search'));
      expect(searchColors.borderStyle).toBe('solid');
      for (let i = 0; i < searchColors.fill.length; i += 1) {
        expect(contrastRatio(searchColors.ink, searchColors.fill[i]), '#library-search ink').toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(searchColors.border, searchColors.outside[i]), '#library-search border').toBeGreaterThanOrEqual(3);
      }

      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, `${theme}-${width}x${height}.png`) });
    });
  }

  test(`airy frosted overlays, thin scrollbars, and translucent controls (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
    await mockBridge(page, 'details');
    await page.goto('/');
    await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

    const expectedOverlay = theme === 'light' ? 'rgba(255, 255, 255, 0.82)' : 'rgba(30, 40, 52, 0.84)';
    const expectedOverlayFilter = 'blur(20px) saturate(1.15)';
    const expectedRowHover = theme === 'light' ? 'rgba(36, 48, 58, 0.05)' : 'rgba(231, 237, 243, 0.06)';
    const activeBlurredCount = () => page.evaluate(() =>
      [...document.querySelectorAll('*')].filter(node => getComputedStyle(node).backdropFilter !== 'none' && node.getClientRects().length > 0).length,
    );

    expect(await activeBlurredCount()).toBe(0);

    // 1. Ordinary hovered row uses translucent hover wash with zero backdrop blur
    const secondRow = page.locator('.list-pane .library-row').nth(1);
    await secondRow.hover();
    expect(await secondRow.evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, filter: getComputedStyle(node).backdropFilter }))).toEqual({
      fill: expectedRowHover,
      filter: 'none',
    });
    const hoveredUrlColors = await renderedContrastColors(secondRow.locator('.library-url'));
    for (const back of hoveredUrlColors.fill) expect(contrastRatio(hoveredUrlColors.ink, back), 'hovered .library-url').toBeGreaterThanOrEqual(4.5);

    // 2. Detail pane sticky heading and tabs activate frosted overlay while detail pane stays transparent
    await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
    const detailPane = page.locator('.detail-pane');
    await expect(detailPane).toBeVisible();
    expect(await detailPane.evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, filter: getComputedStyle(node).backdropFilter }))).toEqual({
      fill: 'rgba(0, 0, 0, 0)',
      filter: 'none',
    });
    for (const overlaySelector of ['.detail-pane > .pane-heading', '.detail-pane .detail-tabs']) {
      expect(await page.locator(overlaySelector).evaluate(node => ({
        fill: getComputedStyle(node).backgroundColor,
        filter: getComputedStyle(node).backdropFilter,
      })), overlaySelector).toEqual({ fill: expectedOverlay, filter: expectedOverlayFilter });
    }
    expect(await activeBlurredCount()).toBe(2);
    const detailHeadingColors = await renderedContrastColors(page.locator('.detail-pane > .pane-heading h3'));
    for (const back of detailHeadingColors.fill) expect(contrastRatio(detailHeadingColors.ink, back), 'detail heading').toBeGreaterThanOrEqual(4.5);
    const inactiveTabColors = await renderedContrastColors(page.locator('.detail-tabs [role="tab"][aria-selected="false"]').first());
    for (const back of inactiveTabColors.fill) expect(contrastRatio(inactiveTabColors.ink, back), 'detail inactive tab').toBeGreaterThanOrEqual(4.5);

    await page.getByRole('tab', { name: '标签备注', exact: true }).click();
    const noteTextarea = page.getByLabel('备注', { exact: true });
    await expect(noteTextarea).toBeVisible();
    expect(await noteTextarea.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const noteColors = await renderedContrastColors(noteTextarea);
    expect(noteColors.borderStyle).toBe('solid');
    for (let i = 0; i < noteColors.fill.length; i += 1) {
      expect(contrastRatio(noteColors.ink, noteColors.fill[i]), 'textarea ink').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(noteColors.border, noteColors.outside[i]), 'textarea border').toBeGreaterThanOrEqual(3);
    }

    // 3. Selection path popover activates frosted overlay only while open
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    const pathPopover = page.locator('.selection-path > p');
    expect(await pathPopover.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    await page.getByLabel('查看当前目录完整路径').click();
    await expect(pathPopover).toBeVisible();
    expect(await pathPopover.evaluate(node => ({
      fill: getComputedStyle(node).backgroundColor,
      filter: getComputedStyle(node).backdropFilter,
    }))).toEqual({ fill: expectedOverlay, filter: expectedOverlayFilter });
    expect(await activeBlurredCount()).toBeLessThanOrEqual(6);
    const pathColors = await renderedContrastColors(pathPopover);
    for (const back of pathColors.fill) expect(contrastRatio(pathColors.ink, back), 'selection path popover').toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Escape');
    await expect(pathPopover).toBeHidden();
    expect(await pathPopover.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');

    // 4. Floating folder overlay in collapsed icon-rail activates frosted overlay while rows stay unblurred
    await page.getByRole('button', { name: '收起侧栏' }).click();
    await page.getByRole('button', { name: '文件夹', exact: true }).click();
    const folderOverlay = page.locator('.folder-pane.is-open');
    await expect(folderOverlay).toBeVisible();
    expect(await folderOverlay.evaluate(node => ({
      fill: getComputedStyle(node).backgroundColor,
      filter: getComputedStyle(node).backdropFilter,
    }))).toEqual({ fill: expectedOverlay, filter: expectedOverlayFilter });
    expect(await activeBlurredCount()).toBeLessThanOrEqual(6);
    expect(await folderOverlay.locator('.library-row').first().evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '展开侧栏' }).click();

    // 5. Font picker dialog activates frosted overlay while its inner list and search box stay transparent
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '选择字体', exact: true }).click();
    const fontPicker = page.getByRole('dialog');
    await expect(fontPicker).toBeVisible();
    expect(await fontPicker.evaluate(node => ({
      fill: getComputedStyle(node).backgroundColor,
      filter: getComputedStyle(node).backdropFilter,
    }))).toEqual({ fill: expectedOverlay, filter: expectedOverlayFilter });
    expect(await activeBlurredCount()).toBe(1);
    expect(await page.locator('.font-catalog-list').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const fontSearch = fontPicker.locator('input[type="search"]');
    expect(await fontSearch.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const fontTitleColors = await renderedContrastColors(fontPicker.locator('h2'));
    for (const back of fontTitleColors.fill) expect(contrastRatio(fontTitleColors.ink, back), 'font picker h2').toBeGreaterThanOrEqual(4.5);
    const fontSearchColors = await renderedContrastColors(fontSearch);
    expect(fontSearchColors.borderStyle).toBe('solid');
    for (let i = 0; i < fontSearchColors.fill.length; i += 1) {
      expect(contrastRatio(fontSearchColors.ink, fontSearchColors.fill[i]), 'font search ink').toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fontSearchColors.border, fontSearchColors.outside[i]), 'font search border').toBeGreaterThanOrEqual(3);
    }
    await page.keyboard.press('Escape');

    // 6. Confirmation dialog activates frosted overlay
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    await page.getByRole('button', { name: '断开并忽略', exact: true }).first().click();
    const confirmDialog = page.getByRole('dialog', { name: /^断开并忽略“.+”？$/ });
    await expect(confirmDialog).toBeVisible();
    expect(await confirmDialog.evaluate(node => ({
      fill: getComputedStyle(node).backgroundColor,
      filter: getComputedStyle(node).backdropFilter,
    }))).toEqual({ fill: expectedOverlay, filter: expectedOverlayFilter });
    expect(await activeBlurredCount()).toBe(1);
    const confirmCopyColors = await renderedContrastColors(confirmDialog.locator('p').first());
    for (const back of confirmCopyColors.fill) expect(contrastRatio(confirmCopyColors.ink, back), 'confirmation dialog p').toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Escape');

    // 7. Custom thin scrollbars use 7px transparent track and themed rounded thumb
    const scrollbar = await page.locator('.settings-scroll').evaluate(node => {
      const bar = getComputedStyle(node, '::-webkit-scrollbar');
      const track = getComputedStyle(node, '::-webkit-scrollbar-track');
      const thumb = getComputedStyle(node, '::-webkit-scrollbar-thumb');
      return {
        width: bar.width,
        height: bar.height,
        trackBg: track.backgroundColor,
        thumbBg: thumb.backgroundColor,
        thumbRadius: thumb.borderRadius,
      };
    });
    expect(scrollbar).toEqual({
      width: '7px',
      height: '7px',
      trackBg: 'rgba(0, 0, 0, 0)',
      thumbBg: theme === 'light' ? 'rgba(36, 48, 58, 0.22)' : 'rgba(231, 237, 243, 0.2)',
      thumbRadius: '999px',
    });
  });

  for (const fallback of ['reduced-transparency', 'prefers-contrast', 'forced-colors'] as const) {
    test(`airy ${theme} ${fallback} fallback`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
      if (fallback === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
      if (fallback === 'prefers-contrast') await page.emulateMedia({ contrast: 'more' });
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
      if (fallback === 'reduced-transparency' || fallback === 'prefers-contrast') {
        const mediaQuery = fallback === 'reduced-transparency' ? '(prefers-reduced-transparency: reduce)' : '(prefers-contrast: more)';
        expect(await page.evaluate(q => matchMedia(q).matches, mediaQuery)).toBe(true);
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

      await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
      for (const overlaySelector of ['.detail-pane > .pane-heading', '.detail-pane .detail-tabs']) {
        const style = await page.locator(overlaySelector).evaluate(node => ({
          fill: getComputedStyle(node).backgroundColor,
          filter: getComputedStyle(node).backdropFilter,
        }));
        expect(style.filter, `${fallback} ${overlaySelector}`).toBe('none');
        if (fallback === 'reduced-transparency' || fallback === 'prefers-contrast') {
          expect(style.fill, `${fallback} ${overlaySelector}`).toContain('0.96');
        }
      }

      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: '选择字体', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
      if (fallback === 'reduced-transparency' || fallback === 'prefers-contrast') {
        expect(await dialog.evaluate(node => getComputedStyle(node).backgroundColor)).toContain('0.96');
      }
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
