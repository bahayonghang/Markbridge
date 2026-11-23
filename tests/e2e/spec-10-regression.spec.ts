import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { contrastRatio, renderedContrastColors, splitTopLevel } from './contrast';
import { mockBridge } from './mock-bridge';

const SCREENSHOT_DIR = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'spec-10');
const LAYOUT_KEY = 'markbridge.layout-preferences.v1';
const UI_KEY = 'markbridge.ui-preferences.v2';

const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1100, 760],
  [960, 760],
  [959, 760],
  [640, 760],
  [1100, 480],
  [640, 480],
] as const;

const WORKSPACES = [
  ['书签', 'library'],
  ['整理', 'organize'],
  ['语义检索', 'semantic'],
  ['操作历史', 'history'],
  ['设置', 'settings'],
] as const;

const SETTINGS_TABS = [
  ['通用', 'general'],
  ['Chrome 连接', 'connection'],
  ['AI', 'ai'],
  ['语义检索', 'semantic'],
  ['备份导出', 'export'],
] as const;

async function expectNoOverflow(page: Page, width: number, height: number, context: string) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
  expect(dims.scrollWidth, `${context} horizontal overflow`).toBe(width);
  expect(dims.innerWidth, `${context} innerWidth`).toBe(width);
  expect(dims.scrollHeight, `${context} vertical overflow`).toBe(height);
  expect(dims.innerHeight, `${context} innerHeight`).toBe(height);
}

async function expectReadableText(locator: Locator, label: string, minRatio = 4.5) {
  const colors = await renderedContrastColors(locator);
  for (const fill of colors.fill) {
    expect(contrastRatio(colors.ink, fill), label).toBeGreaterThanOrEqual(minRatio);
  }
}

async function expectControlBoundary(locator: Locator, label: string) {
  const colors = await renderedContrastColors(locator);
  expect(colors.borderStyle, `${label} borderStyle`).toBe('solid');
  for (let i = 0; i < colors.fill.length; i += 1) {
    expect(contrastRatio(colors.ink, colors.fill[i]!), `${label} ink`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.border, colors.outside[i]!), `${label} border`).toBeGreaterThanOrEqual(3);
  }
}

test.describe('Spec #10 end-to-end visual & functional regression suite', () => {
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors, 'zero console errors').toEqual([]);
    expect(pageErrors, 'zero uncaught page errors').toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const [width, height] of VIEWPORTS) {
      test(`Matrix ${theme} ${width}x${height} across 12/14/20px, 5 workspaces & 5 settings tabs`, async ({ page }) => {
        await mkdir(SCREENSHOT_DIR, { recursive: true });
        await page.setViewportSize({ width, height });
        await page.addInitScript(
          ({ key, themeVal }) => {
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 2,
                theme: themeVal,
                font: { kind: 'preset', value: 'system' },
                fontSizePx: 14,
              }),
            );
          },
          { key: UI_KEY, themeVal: theme },
        );
        await mockBridge(page, 'sources');
        await page.goto('/');
        await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
        await page.evaluate(() => {
          (window as unknown as { __r06history: unknown[] }).__r06history = [
            {
              operationId: 'spec10-op-1',
              kind: 'update',
              createdAt: 1791800000000,
              state: 'applied',
              affected: 2,
              errorCode: null,
              conflicts: [],
            },
          ];
        });

        const wide = width >= 960 && height >= 551;

        // 1. Translucent dual floating papers (>=960x551) vs opaque fallback (<960 or <551), zero blur on papers/wells/rows, transparent panes/rows/inputs
        const material = await page.evaluate(() => {
          const root = document.getElementById('root')!;
          const workspace = document.querySelector('.workspace')!;
          const sidebar = document.querySelector('.app-sidebar')!;
          const main = document.querySelector('.app-main')!;
          const listPane = document.querySelector('.list-pane')!;
          const searchInput = document.querySelector('#library-search')!;
          const sidebarStyle = getComputedStyle(sidebar);
          const mainStyle = getComputedStyle(main);
          const listPaneStyle = getComputedStyle(listPane);
          const searchStyle = getComputedStyle(searchInput);
          const sidebarBox = sidebar.getBoundingClientRect();
          const mainBox = main.getBoundingClientRect();
          const nonBlurred = [
            ...document.querySelectorAll('.app-sidebar, .app-main, .well-group, .output-well, .library-row'),
          ].map((el) => getComputedStyle(el).backdropFilter);
          const ordinaryRow = [...document.querySelectorAll('.list-pane .library-row')].find(
            (el) => !el.classList.contains('is-active'),
          );
          return {
            field: getComputedStyle(root).backgroundImage,
            workspaceBg: getComputedStyle(workspace).backgroundColor,
            gap: mainBox.x - (sidebarBox.x + sidebarBox.width),
            sidebarInset: sidebarBox.x,
            sidebarFill: sidebarStyle.backgroundColor,
            mainFill: mainStyle.backgroundColor,
            sidebarRadius: sidebarStyle.borderRadius,
            mainRadius: mainStyle.borderRadius,
            listPaneBg: listPaneStyle.backgroundColor,
            listPaneFilter: listPaneStyle.backdropFilter,
            searchBg: searchStyle.backgroundColor,
            ordinaryRowBg: ordinaryRow ? getComputedStyle(ordinaryRow).backgroundColor : null,
            nonBlurred,
            activeBlurredCount: [...document.querySelectorAll('*')].filter(
              (el) => getComputedStyle(el).backdropFilter !== 'none' && el.getClientRects().length > 0,
            ).length,
          };
        });

        const fieldLayers = splitTopLevel(material.field);
        expect(fieldLayers).toHaveLength(4);
        expect(material.workspaceBg).toBe('rgba(0, 0, 0, 0)');
        expect(material.nonBlurred.every((v) => v === 'none')).toBe(true);
        expect(material.listPaneBg).toBe('rgba(0, 0, 0, 0)');
        expect(material.listPaneFilter).toBe('none');
        expect(material.searchBg).toBe('rgba(0, 0, 0, 0)');
        expect(material.ordinaryRowBg).toBe('rgba(0, 0, 0, 0)');
        expect(material.activeBlurredCount).toBeLessThanOrEqual(6);

        const expectedPaperFill =
          theme === 'light'
            ? wide
              ? 'rgba(255, 255, 255, 0.62)'
              : 'rgba(255, 255, 255, 0.96)'
            : wide
              ? 'rgba(28, 37, 48, 0.6)'
              : 'rgba(28, 37, 48, 0.96)';
        expect(material.sidebarFill).toBe(expectedPaperFill);
        expect(material.mainFill).toBe(expectedPaperFill);
        if (wide) {
          expect(material.gap).toBeGreaterThanOrEqual(12);
          expect(material.gap).toBeLessThanOrEqual(16);
          expect(material.sidebarInset).toBeGreaterThanOrEqual(12);
          expect(material.sidebarInset).toBeLessThanOrEqual(16);
          expect(material.sidebarRadius).toBe('20px');
          expect(material.mainRadius).toBe('20px');
        } else {
          expect(material.gap).toBe(0);
          expect(material.sidebarInset).toBe(0);
          expect(material.sidebarRadius).toBe('0px');
          expect(material.mainRadius).toBe('0px');
        }

        // 4. Connection status deduplication, healthy compact guidance, reclaimed >=50px list height, sidebar alignment & DA4 8px radii
        const connInfo = await page.evaluate(() => {
          const headerConn = document.querySelector('.workspace-heading .connection')!;
          const connRect = headerConn.getBoundingClientRect();
          const connStyle = getComputedStyle(headerConn);
          const brandMark = document.querySelector('.brand-mark')!;
          const brandX = brandMark.getBoundingClientRect().x;
          const navIconsX = [...document.querySelectorAll('.primary-navigation > .nav-button svg.workspace-icon')].map(
            (el) => el.getBoundingClientRect().x,
          );
          const navRadii = [...document.querySelectorAll('.primary-navigation > .nav-button')].map(
            (el) => getComputedStyle(el).borderRadius,
          );
          const pillRadius = getComputedStyle(document.querySelector('.connection-pill')!).borderRadius;
          const compactDetails = document.querySelector<HTMLDetailsElement>(
            'details.source-guidance.source-guidance-compact',
          );
          const virtualRows = document.querySelector('.list-pane .virtual-rows')!;
          return {
            role: headerConn.getAttribute('role'),
            width: connRect.width,
            height: connRect.height,
            clipPath: connStyle.clipPath,
            brandX,
            navIconsX,
            navRadii,
            pillRadius,
            compactOpen: compactDetails ? compactDetails.open : null,
            virtualRowsHeight: virtualRows.getBoundingClientRect().height,
          };
        });
        expect(connInfo.role).toBe('status');
        expect(connInfo.compactOpen).toBe(false);
        if (width >= 800) {
          expect(connInfo.width).toBeLessThanOrEqual(1);
          expect(connInfo.height).toBeLessThanOrEqual(1);
          expect(connInfo.clipPath).toBe('inset(50%)');
          await expect(page.locator('.connection-pill span')).toBeVisible();
          for (const iconX of connInfo.navIconsX) {
            expect(Math.abs(iconX - connInfo.brandX)).toBeLessThanOrEqual(1);
          }
          for (const r of connInfo.navRadii) expect(r).toBe('8px');
          expect(connInfo.pillRadius).toBe('8px');
        } else {
          expect(connInfo.width).toBeGreaterThan(10);
          expect(connInfo.height).toBeGreaterThan(10);
          expect(connInfo.clipPath).toBe('none');
        }
        if (width === 1440 && height === 900) {
          expect(connInfo.virtualRowsHeight - 578).toBeGreaterThanOrEqual(50);
        }

        // Verify detail pane transparency and <= 6 frosted overlays
        await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
        await expect(page.locator('.detail-pane')).toBeVisible();
        const detailCheck = await page.evaluate(() => {
          const detail = document.querySelector('.detail-pane')!;
          const heading = document.querySelector('.detail-pane > .pane-heading')!;
          const tabs = document.querySelector('.detail-pane .detail-tabs')!;
          const blurredCount = [...document.querySelectorAll('*')].filter(
            (el) => getComputedStyle(el).backdropFilter !== 'none' && el.getClientRects().length > 0,
          ).length;
          return {
            detailBg: getComputedStyle(detail).backgroundColor,
            detailFilter: getComputedStyle(detail).backdropFilter,
            headingFilter: getComputedStyle(heading).backdropFilter,
            tabsFilter: getComputedStyle(tabs).backdropFilter,
            blurredCount,
          };
        });
        expect(detailCheck.detailBg).toBe('rgba(0, 0, 0, 0)');
        expect(detailCheck.detailFilter).toBe('none');
        expect(detailCheck.headingFilter).toBe('blur(20px) saturate(1.15)');
        expect(detailCheck.tabsFilter).toBe('blur(20px) saturate(1.15)');
        expect(detailCheck.blurredCount).toBeLessThanOrEqual(6);
        await expectReadableText(page.locator('.detail-pane > .pane-heading h3'), 'detail heading');
        await page.getByRole('button', { name: '关闭详情，返回列表' }).click();

        await expectReadableText(page.locator('.workspace-heading h1'), 'library h1');
        await expectReadableText(page.locator('.list-pane .library-title').first(), 'library title');
        await expectReadableText(page.locator('.list-pane .library-url').first(), 'library url');
        await expectReadableText(page.locator('.list-pane .library-kind').first(), 'library icon', 3);
        await expectControlBoundary(page.locator('#library-search'), 'library search');

        // Traverse all 5 primary workspaces & capture screenshots
        for (const [wsLabel, wsSlug] of WORKSPACES) {
          await page.getByRole('button', { name: wsLabel, exact: true }).click();
          await expectNoOverflow(page, width, height, `${theme} ${width}x${height} ${wsSlug}`);
          await expectReadableText(page.locator('.workspace-heading h1'), `${wsSlug} h1`);
          await page.screenshot({
            path: join(SCREENSHOT_DIR, `${theme}-14-${width}x${height}-ws-${wsSlug}.png`),
          });
        }

        // Traverse all 5 Settings tabs, verify T5 3-tier buttons, rename gap, summaries, heading weights, contrast & screenshots
        for (const [tabLabel, tabSlug] of SETTINGS_TABS) {
          await page.getByRole('tab', { name: tabLabel, exact: true }).click();
          const panel = page.getByRole('tabpanel', { name: tabLabel, exact: true });
          await expect(panel).toBeVisible();
          await expectNoOverflow(page, width, height, `${theme} ${width}x${height} settings-${tabSlug}`);

          const t5Metrics = await page.evaluate(() => {
            const p = document.querySelector('.settings-content > [role="tabpanel"]:not([hidden])')!;
            const headings = [...document.querySelectorAll('.workspace-heading h1'), ...p.querySelectorAll('h2, h3')];
            const weights = headings.map((h) => getComputedStyle(h).fontWeight);
            const summaries = [...p.querySelectorAll('details > summary')].map((s) => ({
              listStyleType: getComputedStyle(s).listStyleType,
              hasChevron: Boolean(s.querySelector(':scope > svg.workspace-icon')),
            }));
            const secondaryCount = document.querySelectorAll('.secondary-button').length;
            const profileCards = [...p.querySelectorAll('.profile-well')].map((card) => ({
              primaryCount: card.querySelectorAll('button.primary-button').length,
              dangerCount: card.querySelectorAll('button.danger-button').length,
            }));
            const renameGaps = [...p.querySelectorAll('.profile-rename-fields')].map((fields) => {
              const input = fields.querySelector('input')!.getBoundingClientRect();
              const btn = fields.querySelector('button[type="submit"]')!.getBoundingClientRect();
              return btn.top >= input.bottom - 1 ? btn.top - input.bottom : btn.left - input.right;
            });
            return {
              panelOverflow: p.scrollWidth > p.clientWidth + 1,
              weights,
              summaries,
              secondaryCount,
              profileCards,
              renameGaps,
            };
          });

          expect(t5Metrics.panelOverflow, `settings-${tabSlug} panelOverflow`).toBe(false);
          expect(t5Metrics.secondaryCount, `settings-${tabSlug} zero .secondary-button`).toBe(0);
          for (const w of t5Metrics.weights) expect(w, `settings-${tabSlug} heading weight`).toBe('600');
          for (const s of t5Metrics.summaries) {
            expect(s.listStyleType, `settings-${tabSlug} summary listStyleType`).toBe('none');
            expect(s.hasChevron, `settings-${tabSlug} summary chevron`).toBe(true);
          }
          if (tabLabel === 'Chrome 连接') {
            expect(t5Metrics.profileCards.length).toBeGreaterThanOrEqual(1);
            for (const card of t5Metrics.profileCards) {
              expect(card.primaryCount).toBeLessThanOrEqual(1);
              expect(card.dangerCount).toBe(1);
            }
            for (const gap of t5Metrics.renameGaps) {
              expect(gap).toBeGreaterThanOrEqual(8);
              expect(gap).toBeLessThanOrEqual(16);
            }
          }

          await expectReadableText(panel.locator('h2').first(), `settings-${tabSlug} h2`);
          await page.screenshot({
            path: join(SCREENSHOT_DIR, `${theme}-14-${width}x${height}-settings-${tabSlug}.png`),
          });
        }

        // Dynamic font sizes (12px and 20px) verification at this viewport & theme
        for (const fontSize of [12, 20] as const) {
          await page.getByRole('button', { name: '设置', exact: true }).click();
          await page.getByRole('tab', { name: '通用', exact: true }).click();
          await page.getByLabel('字号', { exact: true }).fill(String(fontSize));
          await page.getByLabel('字号', { exact: true }).press('Enter');
          await expectNoOverflow(page, width, height, `${theme} ${fontSize}px ${width}x${height} settings-general`);

          await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
          await expectNoOverflow(page, width, height, `${theme} ${fontSize}px ${width}x${height} settings-connection`);

          await page.getByRole('button', { name: '书签', exact: true }).click();
          await expectNoOverflow(page, width, height, `${theme} ${fontSize}px ${width}x${height} library`);
          const rowHeight = await page
            .locator('.list-pane .library-row')
            .first()
            .evaluate((el) => el.getBoundingClientRect().height);
          expect(rowHeight).toBe(fontSize === 12 ? 52 : 76);

          if (fontSize === 20 && (width === 1920 || width === 960 || width === 959 || width === 640)) {
            await page.screenshot({
              path: join(SCREENSHOT_DIR, `${theme}-20-${width}x${height}-ws-library.png`),
            });
          }
        }
      });
    }

    for (const fallback of ['reduced-transparency', 'forced-colors'] as const) {
      test(`Accessibility fallback ${theme} ${fallback} across 1440x900 and 640x480`, async ({ page }) => {
        await mkdir(SCREENSHOT_DIR, { recursive: true });
        await page.addInitScript(
          ({ key, themeVal }) => {
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 2,
                theme: themeVal,
                font: { kind: 'preset', value: 'system' },
                fontSizePx: 20,
              }),
            );
          },
          { key: UI_KEY, themeVal: theme },
        );
        if (fallback === 'forced-colors') {
          await page.emulateMedia({ forcedColors: 'active' });
        } else {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
          });
        }
        await mockBridge(page, 'details');

        for (const [width, height] of [[1440, 900], [640, 480]] as const) {
          await page.setViewportSize({ width, height });
          await page.goto('/');
          await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
          await expectNoOverflow(page, width, height, `${theme} ${fallback} ${width}x${height}`);

          const fallbackCheck = await page.evaluate(() => {
            const rootBg = getComputedStyle(document.getElementById('root')!).backgroundImage;
            const sidebar = getComputedStyle(document.querySelector('.app-sidebar')!);
            const main = getComputedStyle(document.querySelector('.app-main')!);
            const anyBlurred = [...document.querySelectorAll('*')].some(
              (el) => getComputedStyle(el).backdropFilter !== 'none',
            );
            return {
              rootBg,
              sidebarFill: sidebar.backgroundColor,
              mainFill: main.backgroundColor,
              anyBlurred,
            };
          });
          expect(fallbackCheck.anyBlurred).toBe(false);
          if (fallback === 'reduced-transparency') {
            expect(fallbackCheck.sidebarFill).toContain('0.96');
            expect(fallbackCheck.mainFill).toContain('0.96');
          } else {
            expect(fallbackCheck.rootBg).toBe('none');
          }

          await expectReadableText(page.locator('.workspace-heading h1'), `${fallback} h1`);
          await expectReadableText(page.locator('.list-pane .library-title').first(), `${fallback} row title`);
          await expectControlBoundary(page.locator('#library-search'), `${fallback} search input`);

          await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
          for (const sel of ['.detail-pane > .pane-heading', '.detail-pane .detail-tabs']) {
            const ov = await page.locator(sel).evaluate((el) => ({
              fill: getComputedStyle(el).backgroundColor,
              filter: getComputedStyle(el).backdropFilter,
            }));
            expect(ov.filter).toBe('none');
            if (fallback === 'reduced-transparency') expect(ov.fill).toContain('0.96');
          }
          await page.screenshot({
            path: join(SCREENSHOT_DIR, `${theme}-${fallback}-${width}x${height}.png`),
          });
        }
      });
    }
  }

  test('Integrated Spec #10 T1 sidebar resize/collapse, T2 decoupled folder tree, and T4 non-healthy warning recovery', async ({
    page,
  }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const folders = Array.from({ length: 9 }, (_, index) => ({
        chromeId: `f-${index + 1}`,
        parentId: index === 0 ? '1' : `f-${index}`,
        position: 0,
        kind: 'folder',
        title: `第${index + 1}层目录`,
        url: null,
      }));
      const siblingLeaf = {
        chromeId: 'f-leaf',
        parentId: '1',
        position: 1,
        kind: 'folder',
        title: '平级叶目录',
        url: null,
      };
      const bookmarks = [
        {
          chromeId: 'bm-home',
          parentId: '1',
          position: 2,
          kind: 'bookmark',
          title: '首页指南',
          url: 'https://example.invalid/home',
        },
        {
          chromeId: 'bm-deep',
          parentId: 'f-2',
          position: 1,
          kind: 'bookmark',
          title: '深层书签',
          url: 'https://example.invalid/deep',
        },
        {
          chromeId: 'bm-leaf',
          parentId: 'f-leaf',
          position: 0,
          kind: 'bookmark',
          title: '叶目录书签',
          url: 'https://example.invalid/leaf',
        },
      ];
      Object.assign(window, { __r03nodes: [...folders, siblingLeaf, ...bookmarks] });
    });
    await mockBridge(page, 'sources');
    await page.goto('/');
    await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();

    const sidebarWidth = async () => Math.round((await page.locator('.app-sidebar').boundingBox())!.width);
    const splitter = page.getByRole('separator', { name: '调整侧栏宽度' });

    // T1: Drag resize +84px -> 340px, Escape cancel, dynamic clamp, dblclick reset, keyboard steps, collapse, persistence, isolation
    const box1 = (await splitter.boundingBox())!;
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box1.x + box1.width / 2 + 84, box1.y + box1.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await sidebarWidth()).toBe(340);

    const box2 = (await splitter.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 50, box2.y + box2.height / 2, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await sidebarWidth()).toBe(340);

    await page.setViewportSize({ width: 860, height: 760 });
    await expect.poll(sidebarWidth).toBe(338);
    expect((await page.locator('.app-main').boundingBox())!.width).toBeGreaterThanOrEqual(480);
    await expectNoOverflow(page, 860, 760, 'T1 dynamic clamp 860x760');

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(sidebarWidth).toBe(340);
    await splitter.dblclick();
    await expect.poll(sidebarWidth).toBe(256);

    await page.locator('.connection-pill').focus();
    await page.keyboard.press('Tab');
    await expect(splitter).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(await sidebarWidth()).toBe(272);
    await page.keyboard.press('Shift+ArrowRight');
    expect(await sidebarWidth()).toBe(304);
    await page.keyboard.press('Home');
    expect(await sidebarWidth()).toBe(200);
    await page.keyboard.press('End');
    expect(await sidebarWidth()).toBe(420);
    await splitter.dblclick();
    expect(await sidebarWidth()).toBe(256);

    // Collapse to 64px icon rail via button & Ctrl+B + folder overlay + header connection status visibility
    await page.getByRole('button', { name: '收起侧栏' }).click();
    await expect.poll(sidebarWidth).toBe(64);
    expect(
      await page.locator('.workspace-heading .connection').evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(10);
    await page.getByRole('button', { name: '文件夹', exact: true }).click();
    const folderOverlay = page.locator('.folder-pane.is-open');
    await expect(folderOverlay).toBeVisible();
    expect(await folderOverlay.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe(
      'blur(20px) saturate(1.15)',
    );
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'light-14-1440x900-collapsed-folder-overlay.png') });
    await page.keyboard.press('Escape');
    await expect(folderOverlay).toBeHidden();
    await page.keyboard.press('Control+b');
    await expect.poll(sidebarWidth).toBe(256);

    // T2: Decoupled folder tree chevrons, preserve folder/query/filter/picked, single-click vs dblclick, Tab focus, smart expand/collapse, 8-level indent, refresh persistence
    const rootRow = page.getByRole('treeitem', { name: '书签栏', exact: true });
    const firstLevelRow = page.getByRole('treeitem', { name: '第1层目录', exact: true });
    const leafRow = page.getByRole('treeitem', { name: '平级叶目录', exact: true });
    const firstChevron = firstLevelRow.locator('button.tree-chevron');
    const leafSpacer = leafRow.locator('.tree-chevron-spacer');

    expect(Math.round((await firstChevron.boundingBox())!.width)).toBe(24);
    expect(Math.round((await firstChevron.boundingBox())!.height)).toBe(24);
    expect(Math.round((await leafSpacer.boundingBox())!.width)).toBe(24);

    await leafRow.click();
    await expect(leafRow).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.getByLabel('搜索范围').selectOption('subtree');
    await page.getByLabel('搜索标题或网址').fill('叶目录书签');
    const leafCheck = page.getByRole('checkbox', { name: '选择 叶目录书签', exact: true });
    await leafCheck.check();

    await firstChevron.click();
    const secondLevelRow = page.getByRole('treeitem', { name: '第2层目录', exact: true });
    await expect(secondLevelRow).toBeVisible();
    await expect(leafRow).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('叶目录书签');
    await expect(page.getByLabel('搜索范围')).toHaveValue('subtree');
    await expect(leafCheck).toBeChecked();

    await page.getByRole('button', { name: '取消选择', exact: true }).click();
    await page.getByRole('button', { name: '清空筛选', exact: true }).click();
    await firstChevron.click();
    await expect(secondLevelRow).toHaveCount(0);

    await firstLevelRow.click();
    await expect(firstLevelRow).toHaveAttribute('aria-selected', 'true');
    await expect(firstLevelRow).toHaveAttribute('aria-expanded', 'false');
    await firstLevelRow.dblclick();
    await expect(secondLevelRow).toBeVisible();
    await firstLevelRow.dblclick();
    await expect(secondLevelRow).toHaveCount(0);

    await page.getByLabel('搜索标题或网址').fill('首页');
    await page.locator('.folder-tree-action').focus();
    await page.keyboard.press('Tab');
    await expect(firstLevelRow).toBeFocused();
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('首页');
    await page.getByRole('button', { name: '清空筛选', exact: true }).click();

    await page.getByRole('button', { name: '全部收起', exact: true }).click();
    await expect(rootRow).toHaveAttribute('aria-expanded', 'false');
    await expect(firstLevelRow).toHaveCount(0);

    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    const eighthRow = page.getByRole('treeitem', { name: '第8层目录', exact: true });
    const ninthRow = page.getByRole('treeitem', { name: '第9层目录', exact: true });
    await expect(ninthRow).toBeVisible();
    expect(await eighthRow.locator('.tree-row-content').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(
      '112px',
    );
    expect(await ninthRow.locator('.tree-row-content').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(
      '112px',
    );
    await expect(eighthRow.locator('.tree-indent-guide')).toHaveCount(8);
    await expect(ninthRow.locator('.tree-indent-guide')).toHaveCount(8);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'light-14-1440x900-folder-tree-8level.png') });

    await page.getByRole('button', { name: '全部收起', exact: true }).click();
    await expect(rootRow).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() =>
      (window as unknown as { __r07patch: (patch: Record<string, unknown>) => void }).__r07patch({}),
    );
    await expect(rootRow).toHaveAttribute('aria-expanded', 'false');

    // T1 persistence & isolation from 「恢复默认外观」
    const box3 = (await splitter.boundingBox())!;
    await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width / 2 + 64, box3.y + box3.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await sidebarWidth()).toBe(320);

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '恢复默认外观', exact: true }).click();
    expect(await sidebarWidth()).toBe(320);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).sidebarWidthPx, LAYOUT_KEY)).toBe(320);

    // T4 non-healthy source guidance displays full risk warning + 「检查连接设置」
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await page.evaluate(() =>
      (window as unknown as { __r07patch: (patch: Record<string, unknown>) => void }).__r07patch({
        connection: 'cached_read_only',
      }),
    );
    await expect(page.locator('details.source-guidance-compact')).toHaveCount(0);
    await expect(page.locator('.source-guidance .access-note')).toBeVisible();
    await page.locator('.source-guidance details > summary').click();
    await expect(page.locator('.source-guidance').getByRole('button', { name: '检查连接设置', exact: true })).toBeVisible();
  });
});
