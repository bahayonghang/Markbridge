import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const phase = process.env.MARKBRIDGE_LAYOUT_PHASE ?? 'after';
const evidence = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', phase);
const sizes = [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480], [1920, 1080]];
for (const [width, height] of sizes) {
  test(`S02 settings geometry ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const geometry = [];
    await mkdir(evidence, { recursive: true });
    for (const tab of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: tab, exact: true });
      await expect(panel).toBeVisible();
      const measurements = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element || !element.getClientRects().length) return null;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight };
        };
        return { main: box('.app-main'), tabs: box('.settings-tabs'), content: box('.settings-scroll'),
          connection: box('.connection-settings'),
          export: box('.export-desk'), documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight };
      });
      geometry.push({ tab, ...measurements });
      expect(measurements.documentWidth).toBe(width); expect(measurements.documentHeight).toBe(height);
      if (phase === 'after') {
        expect(await page.locator('.settings-scroll').evaluate(element => element.scrollTop)).toBe(0);
        await expect(page.getByRole('tablist', { name: '设置分类' })).toHaveAttribute('aria-orientation', 'vertical');
        expect(measurements.tabs!.x + measurements.tabs!.width).toBeLessThanOrEqual(measurements.content!.x);
        if (tab === 'Chrome 连接') {
          expect(measurements.connection!.width).toBeGreaterThan(0);
          expect(measurements.connection!.width).toBeLessThanOrEqual(760);
        }
        const overflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth);
        expect(overflow).toBe(false);
      }
      await page.screenshot({ path: join(evidence, `settings-${tab}-${width}x${height}.png`) });
      const controls = panel.locator('button:visible,input:visible,select:visible,summary:visible');
      for (const control of await controls.all()) {
        await control.scrollIntoViewIfNeeded();
        const rect = await control.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(measurements.main!.x);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
        if (phase === 'after') expect(rect!.x).toBeGreaterThanOrEqual(measurements.content!.x);
      }
    }
    await writeFile(join(evidence, `geometry-${width}x${height}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
  });
}

test('S02 vertical tabs retain library, AI and semantic inputs without implicit effects', async ({ page }) => {
  await mockBridge(page, 'details'); await page.goto('/');
  await page.getByLabel('搜索标题或网址').fill('Guidelines');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await page.getByLabel('备注', { exact: true }).fill('S02 未保存备注');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.includes('ai_settings'))).toBe(false);
  const connection = page.getByRole('tab', { name: 'Chrome 连接', exact: true });
  await connection.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'AI', exact: true })).toBeFocused();
  await page.getByLabel('模型', { exact: true }).fill('未保存的 AI 模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  await page.getByLabel('向量模型', { exact: true }).fill('未保存的向量模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).focus();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: '备份导出' })).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: '通用' })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(page.getByRole('tab', { name: '备份导出' })).toBeFocused();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('未保存的 AI 模型');
  await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  await expect(page.getByLabel('向量模型', { exact: true })).toHaveValue('未保存的向量模型');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('S02 未保存备注');
  const calls = await page.evaluate(() => ({ ordinary: (window as unknown as { __r01calls: string[] }).__r01calls, semantic: (window as unknown as { __semanticCalls: string[] }).__semanticCalls }));
  expect(calls.ordinary.filter(call => ['save_export', 'test_ai', 'preview_edit', 'apply', 'apply_batch', 'content_preview', 'tag_set_note', 'organize'].includes(call))).toEqual([]);
  expect(calls.semantic.filter(call => call !== 'settings')).toEqual([]);
});

for (const scenario of ['preview', 'loading'] as const) {
  test(`S02 keyboard reaches disabled and empty panels during ${scenario}`, async ({ page }) => {
    if (scenario === 'loading') await mockBridge(page, 'loading');
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const name of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      if (scenario === 'preview' && name === 'AI') {
        await page.mouse.move(0, 0);
        const selectedFill = await tab.evaluate(element => getComputedStyle(element).backgroundColor);
        await tab.hover();
        expect(await tab.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(selectedFill);
      }
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await page.keyboard.press('Tab');
      await expect(panel).toBeFocused();
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      await page.keyboard.press('Shift+Tab');
      await expect(tab).toBeFocused();
      if (scenario === 'preview' && (name === 'AI' || name === '语义检索')) {
        const controls = panel.locator('input,select,button');
        expect(await controls.count()).toBeGreaterThan(0);
        for (const control of await controls.all()) await expect(control).toBeDisabled();
      }
      if (scenario === 'preview' && name === '备份导出') {
        await expect(panel.getByText('请先选择可用的书签来源，再导出缓存。')).toBeVisible();
        await expect(panel.locator('input,select,button')).toHaveCount(0);
      }
    }
  });
}

for (const [width, height] of sizes) {
  test(`S02 ignored source and long file source ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await mockBridge(page, 'sources'); await page.goto('/');
    await expect(page.locator('#library-source')).toBeVisible();
    await page.evaluate(() => {
      const fixture = window as unknown as { __s02state: (patch: unknown) => void; __r07patch: (patch: unknown) => void };
      fixture.__r07patch({ displayName: '资料名称与英文 LongReference'.repeat(4) });
      fixture.__s02state({ mirrors: [{ mirrorSourceId: 'mirror-long', displayName: '只读文件资料'.repeat(8), association: 'independent', pairedProfileId: null, fileStatus: 'stale', watching: true, nodeCount: 19, revision: 3, lastSyncedAt: null, errorCode: null, canWriteBrowser: false }] });
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    await page.getByText('其他接入方式：只读文件来源', { exact: true }).click();
    expect(await page.locator('.settings-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `pending-${width}x${height}.png`) });
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 建议', exact: true })).toBeInViewport();
    expect(await page.locator('.settings-scroll').evaluate(element => element.scrollTop)).toBe(0);
    await page.getByRole('tab', { name: '备份导出' }).click();
    await page.getByLabel('书签来源').selectOption('mirror:mirror-long');
    await expect(page.getByText('此文件来源没有本地侧车数据。')).toBeVisible();
    await expect(page.getByRole('button', { name: '导出侧车 JSON' })).toHaveCount(0);
    expect(await page.locator('#library-source').count()).toBe(1);
    await page.screenshot({ path: join(evidence, `mirror-export-${width}x${height}.png`) });
  });
}

for (const fontSize of [12, 14, 20]) {
  test(`T5 typography hierarchy h1 > h2 > h3 > body at ${fontSize}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(size => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme: 'light', font: { kind: 'preset', value: 'system' }, fontSizePx: size })), fontSize);
    await mockBridge(page, 'sources');
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const tab of ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const sizesMeasured = await page.evaluate(() => {
        const px = (el: Element | null) => el ? parseFloat(getComputedStyle(el).fontSize) : 0;
        const weight = (el: Element | null) => el ? getComputedStyle(el).fontWeight : '';
        const h1 = document.querySelector('.workspace-heading h1');
        const panel = document.querySelector('.settings-content > [role="tabpanel"]:not([hidden])')!;
        const h2 = panel.querySelector('h2');
        const h3 = panel.querySelector('h3');
        return {
          h1: px(h1),
          h2: px(h2),
          h3: px(h3),
          body: px(document.body),
          weights: [weight(h1), weight(h2), ...(h3 ? [weight(h3)] : [])],
        };
      });
      expect(sizesMeasured.body, `${tab} body`).toBe(fontSize);
      expect(sizesMeasured.h1, `${tab} h1 > h2`).toBeGreaterThan(sizesMeasured.h2);
      expect(sizesMeasured.h2, `${tab} h2 > h3`).toBeGreaterThan(sizesMeasured.h3);
      expect(sizesMeasured.h3, `${tab} h3 > body`).toBeGreaterThan(sizesMeasured.body);
      for (const w of sizesMeasured.weights) {
        expect(w, `${tab} heading weight`).toBe('600');
      }
    }
  });
}

for (const [width, height] of [[1440, 900], [1920, 1080], [2549, 1356]] as const) {
  test(`T5 transparent rail, 760px left-aligned reading width, well-groups, and zero split gap at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockBridge(page, 'sources');
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const tabsBg = await page.locator('.settings-tabs').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(tabsBg).toBe('rgba(0, 0, 0, 0)');

    for (const [tab, expectedPrimary] of [['通用', 0], ['Chrome 连接', 2], ['AI', 1], ['语义检索', 1], ['备份导出', 1]] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const layout = await page.evaluate((tabName) => {
        const tabs = document.querySelector('.settings-tabs')!.getBoundingClientRect();
        const content = document.querySelector('.settings-content')!;
        const contentStyle = getComputedStyle(content);
        const contentBox = content.getBoundingClientRect();
        const panel = document.querySelector('.settings-content > [role="tabpanel"]:not([hidden])')!;
        const wells = [...panel.querySelectorAll('.well-group')].map(el => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, border: s.borderTopWidth, radius: s.borderRadius, padding: s.padding };
        });
        const rows = [...panel.querySelectorAll('.settings-row')].map(row => {
          const first = row.firstElementChild!.getBoundingClientRect();
          const last = row.lastElementChild!.getBoundingClientRect();
          return { gap: last.x - (first.x + first.width), span: last.x - first.x };
        });
        const primaryButtons = panel.querySelectorAll('button.primary-button').length;
        const profileCards = [...panel.querySelectorAll('.profile-well')].map(card => ({
          primaryCount: card.querySelectorAll('button.primary-button').length,
          hasDanger: card.querySelectorAll('button.danger-button').length === 1,
        }));
        const renameGaps = [...panel.querySelectorAll('.profile-rename-fields')].map(fields => {
          const input = fields.querySelector('input')!.getBoundingClientRect();
          const button = fields.querySelector('button[type="submit"]')!.getBoundingClientRect();
          return button.left - input.right;
        });
        const summaries = [...panel.querySelectorAll('details > summary')].map(summary => {
          const icon = summary.querySelector(':scope > svg.workspace-icon');
          return {
            listStyleType: getComputedStyle(summary).listStyleType,
            hasIcon: Boolean(icon),
          };
        });
        const headingWeights = [
          ...document.querySelectorAll('.workspace-heading h1'),
          ...panel.querySelectorAll('h2, h3'),
        ].map(el => getComputedStyle(el).fontWeight);
        const secondaryButtons = document.querySelectorAll('.secondary-button').length;
        const autoSubmitNonPrimary = [...panel.querySelectorAll('button[type="submit"]:not(.primary-button)')].length;
        const targetText = tabName === 'AI'
          ? (panel.querySelector('.ai-desk')?.textContent ?? '')
          : tabName === '备份导出'
            ? (panel.querySelector('.export-desk')?.textContent ?? '')
            : tabName === 'Chrome 连接'
              ? [...panel.querySelectorAll('.settings-facts')].map(el => el.textContent ?? '').join(' ')
              : '';
        return {
          tabsRight: tabs.x + tabs.width,
          contentX: contentBox.x,
          contentWidth: contentBox.width,
          maxWidth: contentStyle.maxWidth,
          marginLeft: contentStyle.marginLeft,
          wells,
          rows,
          primaryButtons,
          profileCards,
          renameGaps,
          summaries,
          headingWeights,
          secondaryButtons,
          autoSubmitNonPrimary,
          hasMiddleDot: targetText.includes('·'),
        };
      }, tab);
      expect(layout.maxWidth, tab).toBe('760px');
      expect(layout.contentWidth, tab).toBeLessThanOrEqual(760);
      expect(layout.marginLeft, tab).toBe('0px');
      expect(layout.contentX - layout.tabsRight, `${tab} flush to tabs`).toBeLessThanOrEqual(32);
      expect(layout.wells.length, `${tab} wells`).toBeGreaterThanOrEqual(1);
      for (const well of layout.wells) {
        expect(well.border).toBe('0px');
        expect(well.radius).toBe('16px');
        expect(well.padding).toBe('16px 20px');
      }
      for (const row of layout.rows) {
        expect(row.gap, `${tab} row gap`).toBeLessThanOrEqual(32);
        expect(row.span, `${tab} label+gap span`).toBeLessThanOrEqual(260);
      }
      expect(layout.primaryButtons, `${tab} primary count`).toBe(expectedPrimary);
      expect(layout.secondaryButtons, `${tab} zero secondary-button`).toBe(0);
      for (const weight of layout.headingWeights) {
        expect(weight, `${tab} heading weight`).toBe('600');
      }
      for (const summary of layout.summaries) {
        expect(summary.listStyleType, `${tab} summary list-style`).toBe('none');
        expect(summary.hasIcon, `${tab} summary chevron icon`).toBe(true);
      }
      if (tab === 'Chrome 连接') {
        expect(layout.profileCards.length).toBe(2);
        for (const card of layout.profileCards) {
          expect(card.primaryCount).toBeLessThanOrEqual(1);
          expect(card.hasDanger).toBe(true);
        }
        for (const gap of layout.renameGaps) {
          expect(gap).toBeGreaterThanOrEqual(8);
          expect(gap).toBeLessThanOrEqual(16);
        }
      } else {
        expect(layout.autoSubmitNonPrimary, `${tab} unclassed submit`).toBe(0);
      }
      expect(layout.hasMiddleDot, `${tab} middle dot`).toBe(false);
    }

    await page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    const otherSourcesSummary = page.locator('details.other-sources > summary');
    const closedTransform = await otherSourcesSummary.locator('svg.workspace-icon').evaluate(el => getComputedStyle(el).transform);
    expect(closedTransform).toBe('none');
    await otherSourcesSummary.click();
    const openTransform = await otherSourcesSummary.locator('svg.workspace-icon').evaluate(el => getComputedStyle(el).transform);
    expect(openTransform).not.toBe('none');

    const firstCard = page.locator('article.profile-well').nth(0);
    const secondCard = page.locator('article.profile-well').nth(1);
    await expect(firstCard.getByRole('button', { name: '浏览此资料' })).toHaveClass(/primary-button/);
    await expect(secondCard.getByRole('button', { name: '浏览此资料' })).toHaveClass(/primary-button/);
    await expect(secondCard.getByRole('button', { name: '重新连接' })).not.toHaveClass(/primary-button/);
    await page.evaluate(() => (window as unknown as { __r02disconnect: () => void }).__r02disconnect());
    await expect(firstCard.locator('button.primary-button')).toHaveCount(1);
    await expect(secondCard.locator('button.primary-button')).toHaveCount(1);
    await expect(firstCard.getByRole('button', { name: '浏览此资料' })).toHaveClass(/primary-button/);
    await expect(secondCard.getByRole('button', { name: '重新连接' })).toHaveClass(/primary-button/);
    await expect(secondCard.getByRole('button', { name: '浏览此资料' })).not.toHaveClass(/primary-button/);

    const connectionSubmits = await page.locator('#settings-panel-connection button[type="submit"]').evaluateAll(nodes =>
      nodes.map(node => getComputedStyle(node).backgroundColor),
    );
    expect(connectionSubmits.length).toBeGreaterThan(0);
    for (const bg of connectionSubmits) {
      expect(bg).not.toBe('rgb(31, 108, 176)');
    }
  });
}
