import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contrastRatio, renderedContrastColors } from './contrast';
import { mockBridge } from './mock-bridge';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'layout-review');

for (const theme of ['light', 'dark']) {
  test(`C03 minimum 20px ${theme} keeps keyboard returns and source-bound drafts across export`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
    await mockBridge(page, 'sources');
    await page.goto('/');
    const folder = page.getByRole('button', { name: '文件夹', exact: true });
    await folder.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem', { name: '书签栏', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(folder).toBeFocused();

    await page.getByLabel('搜索标题或网址').fill('Guidelines');
    await expect(page.getByRole('status').filter({ hasText: '已加载 4 / 4 项' })).toBeVisible();
    const selected = page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true });
    await selected.focus();
    await page.keyboard.press('Space');
    await expect(selected).toBeChecked();
    await expect(selected).toBeFocused();
    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    await page.getByRole('tab', { name: '标签备注', exact: true }).click();
    const draft = `C03 ${theme}：最小窗口下保留未保存备注。`;
    await page.getByLabel('备注', { exact: true }).fill(draft);
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.getByRole('button', { name: '备份导出', exact: true }).click();
    const source = page.getByRole('combobox', { name: '书签来源', exact: true });
    await expect(source).toHaveValue('profile:profile-test');
    await source.focus();
    await source.selectOption('profile:profile-second');
    const confirm = page.getByRole('dialog', { name: '切换书签来源？' });
    await expect(confirm).toBeVisible();
    const cancel = confirm.getByRole('button', { name: '留在当前页面', exact: true });
    await expect(cancel).toBeFocused();
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${theme}-20-minimum-source-confirm.png`) });
    await page.keyboard.press('Escape');
    await expect(source).toBeFocused();
    await expect(source).toHaveValue('profile:profile-test');
    await page.getByRole('button', { name: '书签', exact: true }).click();
    await expect(page.getByRole('heading', { name: '书签', exact: true, level: 1 })).toBeFocused();
    await expect(page.getByLabel('备注', { exact: true })).toHaveValue(draft);
    const close = page.getByRole('button', { name: '关闭详情，返回列表', exact: true });
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
    await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
    await expect(selected).toBeChecked();
    const result = await page.evaluate(() => ({
      calls: (window as unknown as { __r01calls: string[] }).__r01calls,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    expect(result.calls.filter(call => ['content_preview', 'tag_set_note', 'save_export', 'apply', 'apply_batch', 'test_ai', 'suggest_ai', 'organize', 'check_links'].includes(call))).toEqual([]);
    expect([result.width, result.height]).toEqual([640, 480]);
    await page.screenshot({ path: join(output, `${theme}-20-minimum-restored.png`) });
    await writeFile(join(output, `${theme}-20-minimum.json`), `${JSON.stringify({ theme, fontSizePx: 20, viewport: { width: 640, height: 480 }, result }, null, 2)}\n`);
  });

  for (const [width, height] of [[959, 760], [960, 760]] as const) {
    test(`T8 breakpoint ${theme} 14px ${width}x${height} covers onboarding, settings general/connection, organize, semantic, history with heading scale and contrast`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((value) => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme: value, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
      await mkdir(output, { recursive: true });

      // Onboarding first at breakpoint
      await mockBridge(page, 'onboarding');
      await page.goto('/');
      await expect(page.getByRole('region', { name: '首次接入' })).toBeVisible();
      const onboardingCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        h1: parseFloat(getComputedStyle(document.querySelector('.workspace-heading h1')!).fontSize),
        h2: parseFloat(getComputedStyle(document.querySelector('.settings-content h2')!).fontSize),
        body: parseFloat(getComputedStyle(document.body).fontSize),
      }));
      expect(onboardingCheck.scrollWidth).toBe(width);
      expect(onboardingCheck.scrollHeight).toBe(height);
      expect(onboardingCheck.h1).toBeGreaterThan(onboardingCheck.h2);
      expect(onboardingCheck.h2).toBeGreaterThan(onboardingCheck.body);
      await page.screenshot({ path: join(output, `${theme}-14-${width}x${height}-onboarding.png`) });

      // Connected workspaces + Settings General & Connection
      await mockBridge(page, 'sources');
      await page.goto('/');
      await expect(page.locator('.list-pane .library-row').first()).toBeVisible();
      await page.evaluate(() => {
        (window as unknown as { __r06history: unknown[] }).__r06history = [{ operationId: 't8-op', kind: 'update', createdAt: 1791800000000, state: 'applied', affected: 1, errorCode: null, conflicts: [] }];
      });

      for (const [navName, key] of [['整理', 'organize'], ['语义检索', 'semantic'], ['操作历史', 'history']] as const) {
        await page.getByRole('button', { name: navName, exact: true }).click();
        if (key === 'history') {
          await page.locator('.history-summary').first().click();
          await expect(page.getByRole('heading', { level: 3, name: '记录详情' })).toBeVisible();
        }
        const metrics = await page.evaluate(() => {
          const px = (el: Element | null) => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
          const main = document.querySelector('.app-main')!;
          const h1 = document.querySelector('.workspace-heading h1');
          const h2 = main.querySelector('h2');
          const h3 = main.querySelector('h3');
          const navWraps = [...document.querySelectorAll<HTMLElement>('.primary-navigation > .nav-button')].filter(btn => btn.scrollWidth > btn.clientWidth + 1).length;
          return { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, h1: px(h1), h2: px(h2), h3: px(h3), body: px(document.body), navWraps };
        });
        expect(metrics.scrollWidth, key).toBe(width);
        expect(metrics.scrollHeight, key).toBe(height);
        expect(metrics.navWraps, `${key} nav wraps`).toBe(0);
        expect(metrics.h1).toBeGreaterThan(metrics.h2);
        expect(metrics.h2).toBeGreaterThan(metrics.h3);
        expect(metrics.h3).toBeGreaterThan(metrics.body);
        await page.screenshot({ path: join(output, `${theme}-14-${width}x${height}-${key}.png`) });
      }

      await page.getByRole('button', { name: '设置', exact: true }).click();
      for (const [tabName, key] of [['通用', 'settings-general'], ['Chrome 连接', 'settings-connection']] as const) {
        await page.getByRole('tab', { name: tabName, exact: true }).click();
        const panel = page.getByRole('tabpanel', { name: tabName, exact: true });
        await expect(panel).toBeVisible();
        const metrics = await page.evaluate(() => {
          const px = (el: Element | null) => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
          const p = document.querySelector('.settings-content > [role="tabpanel"]:not([hidden])')!;
          return {
            scrollWidth: document.documentElement.scrollWidth,
            panelOverflow: p.scrollWidth > p.clientWidth + 1,
            h1: px(document.querySelector('.workspace-heading h1')),
            h2: px(p.querySelector('h2')),
            h3: px(p.querySelector('h3')),
            body: px(document.body),
          };
        });
        expect(metrics.scrollWidth, key).toBe(width);
        expect(metrics.panelOverflow, key).toBe(false);
        expect(metrics.h1).toBeGreaterThan(metrics.h2);
        expect(metrics.h2).toBeGreaterThan(metrics.h3);
        expect(metrics.h3).toBeGreaterThan(metrics.body);
        const h1Colors = await renderedContrastColors(page.locator('.workspace-heading h1'));
        for (const fill of h1Colors.fill) expect(contrastRatio(h1Colors.ink, fill)).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({ path: join(output, `${theme}-14-${width}x${height}-${key}.png`) });
      }
    });
  }

  test(`20px layout review ${theme} fixes settings-tabs, detail-segmented, selection-toolbar, connection-pill, history-detail, and font-picker`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme: value, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
    await mkdir(output, { recursive: true });

    // 1) 1100x760 at 20px: connection-pill, detail-segmented, browse-heading/selection-toolbar clearance, history-detail output-well, settings-tabs
    await page.setViewportSize({ width: 1100, height: 760 });
    await mockBridge(page, 'sources');
    await page.goto('/');
    await expect(page.locator('.list-pane .library-row').first()).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __r06history: unknown[] }).__r06history = [{ operationId: 'review-op', kind: 'update', createdAt: 1791800000000, state: 'applied', affected: 1, errorCode: null, conflicts: [] }];
    });

    const pillSpan = page.locator('.connection-pill > span');
    await expect(pillSpan).toHaveText('已连接 Chrome（2 个）');
    const pillMetrics = await pillSpan.evaluate((el) => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const rect = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const lineBoxes = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, height: rect.height, lineHeight, lineBoxes };
    });
    expect(pillMetrics.scrollWidth, 'connection-pill span scrollWidth').toBeLessThanOrEqual(pillMetrics.clientWidth + 1);
    expect(pillMetrics.lineBoxes, 'connection-pill single line').toBe(1);
    expect(pillMetrics.height, 'connection-pill height').toBeLessThan(pillMetrics.lineHeight * 2);
    const pillColors = await renderedContrastColors(pillSpan);
    for (const fill of pillColors.fill) expect(contrastRatio(pillColors.ink, fill), 'connection-pill contrast').toBeGreaterThanOrEqual(4.5);

    await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
    await expect(page.locator('.detail-pane')).toBeVisible();

    const detailTabs = await page.locator('.detail-segmented > button').evaluateAll((buttons) => buttons.map((btn) => {
      const r = btn.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(btn);
      const lineBoxes = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      return { text: btn.textContent, top: Math.round(r.top), height: r.height, lineBoxes, scrollWidth: btn.scrollWidth, clientWidth: btn.clientWidth };
    }));
    expect(detailTabs.length).toBe(3);
    for (const tab of detailTabs) {
      expect(tab.top, `detail-segmented same row (${tab.text})`).toBe(detailTabs[0]!.top);
      expect(tab.scrollWidth, `detail-segmented no clip (${tab.text})`).toBeLessThanOrEqual(tab.clientWidth + 1);
      expect(tab.lineBoxes, `detail-segmented single line (${tab.text})`).toBe(1);
    }
    for (const tabEl of await page.locator('.detail-segmented > button').all()) {
      const colors = await renderedContrastColors(tabEl);
      for (const fill of colors.fill) expect(contrastRatio(colors.ink, fill), 'detail-segmented contrast').toBeGreaterThanOrEqual(4.5);
    }

    const browseClearance = await page.evaluate(() => {
      const detailRect = document.querySelector('.detail-pane')!.getBoundingClientRect();
      const browse = document.querySelector('.browse-heading')!;
      const lastBtn = browse.querySelector<HTMLElement>('button:last-of-type')!;
      return { clearance: detailRect.left - lastBtn.getBoundingClientRect().right, scrollWidth: browse.scrollWidth, clientWidth: browse.clientWidth };
    });
    expect(browseClearance.scrollWidth, 'browse-heading overflow').toBeLessThanOrEqual(browseClearance.clientWidth + 1);
    expect(browseClearance.clearance, 'browse-heading clearance').toBeGreaterThanOrEqual(8);

    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    const toolbarMetrics = await page.evaluate(() => {
      const detailRect = document.querySelector('.detail-pane')!.getBoundingClientRect();
      const toolbar = document.querySelector<HTMLElement>('.selection-toolbar')!;
      const cancelBtn = toolbar.querySelector<HTMLElement>('button:last-of-type')!;
      const buttons = [...toolbar.querySelectorAll<HTMLElement>('button')].map((btn) => {
        const r = btn.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(btn);
        const lineBoxes = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        return { text: btn.textContent, height: r.height, lineBoxes, scrollWidth: btn.scrollWidth, clientWidth: btn.clientWidth };
      });
      return {
        scrollWidth: toolbar.scrollWidth,
        clientWidth: toolbar.clientWidth,
        clearance: detailRect.left - cancelBtn.getBoundingClientRect().right,
        buttons,
      };
    });
    expect(toolbarMetrics.scrollWidth, 'selection-toolbar overflow').toBeLessThanOrEqual(toolbarMetrics.clientWidth + 1);
    expect(toolbarMetrics.clearance, 'selection-toolbar clearance').toBeGreaterThanOrEqual(8);
    for (const btn of toolbarMetrics.buttons) {
      expect(btn.scrollWidth, `selection-toolbar btn (${btn.text})`).toBeLessThanOrEqual(btn.clientWidth + 1);
      expect(btn.lineBoxes, `selection-toolbar single line (${btn.text})`).toBe(1);
    }
    await page.screenshot({ path: join(output, `${theme}-20-1100x760-library-selection-detail.png`) });
    await page.getByRole('button', { name: '取消选择', exact: true }).click();

    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.locator('.history-summary').first().click();
    await expect(page.getByRole('heading', { level: 3, name: '记录详情' })).toBeVisible();
    const historyCard = page.locator('.history-detail > div').first();
    await expect(historyCard).toHaveClass(/output-well/);
    await expect(historyCard).not.toHaveClass(/well-group/);
    const historyHeadingColors = await renderedContrastColors(page.locator('.history-detail h3'));
    for (const fill of historyHeadingColors.fill) expect(contrastRatio(historyHeadingColors.ink, fill), 'history-detail heading contrast').toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: join(output, `${theme}-20-1100x760-history-detail.png`) });

    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const [width, height] of [[1100, 760], [2549, 1356], [640, 480]] as const) {
      await page.setViewportSize({ width, height });
      await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
      const tabsCheck = await page.evaluate(() => {
        const container = document.querySelector<HTMLElement>('.settings-tabs')!;
        const buttons = [...container.querySelectorAll<HTMLElement>('button')].map((btn) => {
          const r = btn.getBoundingClientRect();
          const s = getComputedStyle(btn);
          const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.6;
          const range = document.createRange();
          range.selectNodeContents(btn);
          const lineBoxes = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          return { text: btn.textContent, height: r.height, lh, lineBoxes, scrollWidth: btn.scrollWidth, clientWidth: btn.clientWidth, right: r.right };
        });
        return {
          docWidth: document.documentElement.scrollWidth,
          containerScrollWidth: container.scrollWidth,
          containerClientWidth: container.clientWidth,
          containerRight: container.getBoundingClientRect().right,
          buttons,
        };
      });
      expect(tabsCheck.docWidth, `settings docWidth ${width}`).toBe(width);
      expect(tabsCheck.containerScrollWidth, `settings-tabs overflow ${width}`).toBeLessThanOrEqual(tabsCheck.containerClientWidth + 1);
      for (const btn of tabsCheck.buttons) {
        expect(btn.scrollWidth, `settings-tab clip (${btn.text}) at ${width}`).toBeLessThanOrEqual(btn.clientWidth + 1);
        expect(btn.lineBoxes, `settings-tab single line (${btn.text}) at ${width}`).toBe(1);
        expect(btn.height, `settings-tab height (${btn.text}) at ${width}`).toBeLessThan(btn.lh * 2);
        expect(btn.right, `settings-tab inside rail (${btn.text}) at ${width}`).toBeLessThanOrEqual(tabsCheck.containerRight + 1);
      }
      if (width >= 800) {
        const pill2 = page.locator('.connection-pill > span');
        const pillCheck = await pill2.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(pillCheck.scrollWidth, `connection-pill at ${width}`).toBeLessThanOrEqual(pillCheck.clientWidth + 1);
      }
      await page.screenshot({ path: join(output, `${theme}-20-${width}x${height}-settings-connection.png`) });
    }

    // FontPicker polish check at 640x480 20px
    await page.setViewportSize({ width: 640, height: 480 });
    await page.getByRole('tab', { name: '通用', exact: true }).click();
    await page.getByRole('button', { name: '选择字体', exact: true }).click();
    const fontDialog = page.getByRole('dialog', { name: '选择字体' });
    await expect(fontDialog).toBeVisible();
    const listHeight = await fontDialog.locator('.font-catalog-list').evaluate((el) => el.getBoundingClientRect().height);
    expect(listHeight).toBeGreaterThanOrEqual(76);
    expect(listHeight).toBeLessThanOrEqual(180);
    const applyBtn = fontDialog.getByRole('button', { name: '使用此字体', exact: true });
    await applyBtn.scrollIntoViewIfNeeded();
    await expect(applyBtn).toBeInViewport();
    await page.screenshot({ path: join(output, `${theme}-20-640x480-font-picker.png`) });
    await page.keyboard.press('Escape');
  });
}
