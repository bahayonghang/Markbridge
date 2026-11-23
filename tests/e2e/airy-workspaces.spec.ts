import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';
import { contrastRatio, renderedContrastColors } from './contrast';

const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'airy-workspaces');

async function readable(locator: Locator) {
  const colors = await renderedContrastColors(locator);
  for (const fill of colors.fill) expect(contrastRatio(colors.ink, fill)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark']) for (const forcedColors of ['none', 'active'] as const) {
  test(`airy history state labels remain readable when selected ${theme} ${forcedColors}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 14 })), theme);
    await mockBridge(page, 'library'); await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __r06history: unknown[] }).__r06history = ['applied', 'uncertain', 'failed', 'rolled_back'].map((state, index) => ({ operationId: `glass-${index}`, kind: 'move', createdAt: 1791800000000 - index * 60000, state, affected: index + 1, errorCode: null, conflicts: [] }));
    });
    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    for (const [state, label] of [['applied', '已完成'], ['uncertain', '结果不确定'], ['failed', '执行失败'], ['rolled_back', '已撤销']]) {
      const summary = page.locator('.history-summary').filter({ has: page.locator(`.state-${state}`) });
      await expect(summary.locator('.history-state')).toHaveText(label);
      await summary.click();
      await readable(summary.locator('.history-state'));
      await readable(summary.locator('.secondary'));
    }
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${theme}-history-${forcedColors}.png`) });
  });
}

for (const theme of ['light', 'dark']) for (const [width, height, size] of [[1440, 900, 14], [640, 480, 20]]) {
  test(`airy outputs distinguish cached content and export outcomes ${theme} ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(({ theme, size }) => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: size })), { theme, size });
    await mockBridge(page, 'details'); await page.goto('/');
    await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
    expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter(call => call === 'content_preview'))).toEqual([]);
    await page.getByRole('tab', { name: '内容预览', exact: true }).click();
    const preview = page.getByRole('region', { name: '内容预览', exact: true });
    await expect(preview.getByText(/离线缓存 ·/)).toBeVisible();
    const summary = preview.getByLabel('缓存正文', { exact: true });
    await expect(summary).toContainText('<script>不执行页面脚本</script>');
    await readable(summary); await readable(preview.locator('.library-detail-title'));
    expect(await summary.evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    await mkdir(output, { recursive: true });
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${theme}-${width}-cached-content.png`) });

    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.getByRole('button', { name: '备份导出', exact: true }).click();
    const desk = page.getByRole('region', { name: '备份导出', exact: true });
    for (const status of ['cancelled', 'failed', 'saved']) {
      await page.evaluate(status => { (window as unknown as { __r06saveStatus: string }).__r06saveStatus = status; }, status);
      await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
      if (status === 'saved') {
        const saved = desk.getByText('文件已保存到所选位置。', { exact: true });
        await expect(saved).toBeVisible(); await readable(saved);
        await saved.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `${theme}-${width}-saved-export.png`) });
      } else {
        await expect(desk.locator('.export-result')).toHaveCount(0);
        await expect(desk.getByText(status === 'cancelled' ? '已取消保存，没有生成文件。' : '文件未保存。请检查目标位置的权限和可用空间，然后重试。', { exact: true })).toBeVisible();
      }
    }
    const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
    expect(calls.filter(call => call === 'content_preview')).toHaveLength(1);
    expect(calls.filter(call => ['apply', 'apply_batch', 'apply_ai', 'check_links', 'organize', 'suggest_ai'].includes(call))).toEqual([]);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([width, height]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`airy well-groups, segmented controls, and output-wash contrast across organize semantic and history ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
    await mockBridge(page, 'details');
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __r07patch: (p: unknown) => void; __r07settings: unknown; __r06history: unknown[] };
      w.__r07patch({ connection: 'live', writePaused: false, ignored: false });
      w.__r07settings = { enabled: true, provider: 'ollama', endpointLabel: 'http://127.0.0.1:11434/api/chat', model: 'fixture', credentialConfigured: false, schemaSupported: true };
      w.__r06history = [{ operationId: 'op-1', kind: 'update', createdAt: 1791800000000, state: 'applied', affected: 1, errorCode: null, conflicts: [] }];
    });

    await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
    const segmented = page.locator('.detail-tabs .segmented-control');
    await expect(segmented).toBeVisible();
    expect(await segmented.evaluate(el => getComputedStyle(el).borderRadius)).toBe('999px');
    expect(await page.locator('.detail-pane .well-group').first().evaluate(el => ({
      border: getComputedStyle(el).borderTopWidth,
      radius: getComputedStyle(el).borderRadius,
    }))).toEqual({ border: '0px', radius: '16px' });

    await page.getByRole('button', { name: '整理', exact: true }).click();
    await expect(page.locator('.organize-tabs.segmented-control')).toBeVisible();
    await page.getByRole('radio', { name: '指定目录', exact: true }).check();
    await page.getByLabel('整理目录', { exact: true }).selectOption('1');
    await page.getByRole('button', { name: '使用此目录', exact: true }).click();
    await page.getByRole('tab', { name: 'AI 文件夹', exact: true }).click();
    await page.getByRole('button', { name: '提出文件夹', exact: true }).click();
    const orgHeading = page.locator('.organization-review .organize-result-heading h4');
    await expect(orgHeading).toBeVisible();
    await readable(orgHeading);
    await page.getByRole('tab', { name: '重复与链接', exact: true }).click();
    await page.getByRole('button', { name: '检查重复', exact: true }).click();
    await page.getByRole('radio', { name: 'Human Interface Guidelines', exact: true }).check();
    await page.getByRole('button', { name: '预览清理', exact: true }).click();
    await expect(page.locator('.cleanup-review > h4')).toBeVisible();
    await readable(page.locator('.cleanup-review > h4'));

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语义检索', exact: true }).click();
    await page.getByLabel('向量模型', { exact: true }).fill('fixture-local');
    await page.getByLabel('启用本地语义检索').check();
    await page.getByRole('button', { name: '保存语义配置' }).click();
    await expect(page.getByText('语义配置已保存。选择并审查范围后，才会建立索引。')).toBeVisible();
    await page.getByRole('button', { name: '语义检索', exact: true }).click();
    await page.getByRole('button', { name: '审查本次范围' }).click();
    await expect(page.locator('.semantic-review > h4')).toBeVisible();
    await readable(page.locator('.semantic-review > h4'));
    await page.getByRole('button', { name: '确认并建立索引' }).click();
    await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
    await page.getByLabel('描述想找的内容').fill('设计指南');
    await page.getByRole('button', { name: '查询语义索引' }).click();
    await expect(page.locator('.semantic-hit > .secondary').first()).toBeVisible();
    await readable(page.locator('.semantic-hit > .secondary').first());

    await page.getByRole('button', { name: '操作历史', exact: true }).click();
    await page.getByRole('button', { name: '撤销此记录', exact: true }).click();
    await expect(page.locator('.undo-review > h3')).toBeVisible();
    await readable(page.locator('.undo-review > h3'));
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1100, 760]);
  });
}

test('writePaused blocks browser writes across workspaces while preserving local metadata edits', async ({ page }) => {
  await mockBridge(page, 'details');
  await page.goto('/');
  await page.evaluate(() => {
    const w = window as unknown as { __r07patch: (p: unknown) => void; __r06history: unknown[] };
    w.__r07patch({ connection: 'live', writePaused: true, ignored: false });
    w.__r06history = [{ operationId: 'op-1', kind: 'update', createdAt: 1791800000000, state: 'applied', affected: 1, errorCode: null, conflicts: [] }];
  });
  await expect(page.locator('.library-toolbar').getByText(/已暂停写入（只读保护）/)).toBeVisible();
  await expect(page.getByRole('button', { name: '新建', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  await expect(page.getByRole('button', { name: '移动所选', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除所选', exact: true })).toBeDisabled();
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await expect(page.getByRole('button', { name: '预览修改', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill('只读保护期间仍可保存本地备注');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByText('备注尚未保存')).toHaveCount(0);

  await page.getByRole('button', { name: '整理', exact: true }).click();
  await expect(page.locator('.organize-workspace').getByText(/已暂停写入（只读保护）/).first()).toBeVisible();
  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.locator('.history-workspace').getByText(/已暂停写入（只读保护）/)).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销此记录', exact: true })).toBeDisabled();
  const calls = await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls);
  expect(calls.filter(c => ['apply', 'apply_batch', 'confirm_cleanup'].includes(c))).toEqual([]);
});
