import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
type Fixture = Window & typeof globalThis & {
  __r01calls: string[];
  __r08export: { source: { kind: string; id: string }; format: string };
  __r08tagWrites: { profileId: string; command: { kind: string; chromeIds: string[]; note?: string } }[];
};

async function saveNote(page: Page, value: string) {
  await page.getByLabel('备注', { exact: true }).fill(value);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.getByText('备注尚未保存', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '保存备注', exact: true })).toBeEnabled();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue(value);
  // The saved editor notifies the parent navigation guard in a React effect.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('R08 daily workspace round trip preserves search, metadata and export source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockBridge(page, 'sources');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('搜索标题或网址', { exact: true }).fill('Human Interface Guidelines');
  const results = page.getByRole('listbox', { name: '搜索结果', exact: true });
  await expect(results.getByRole('option')).toHaveCount(4);
  await results.getByRole('option').first().click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await saveNote(page, '读完设计规范后，回到同一条书签继续整理。');
  await page.getByLabel('添加标签', { exact: true }).fill('阅读清单');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(page.getByRole('list', { name: '当前标签' })).toContainText('阅读清单');
  await expect(page.getByRole('button', { name: '保存备注', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '内容预览', exact: true }).click();
  await expect(page.getByText(/离线缓存 ·/)).toBeVisible();
  await expect(page.getByRole('region', { name: '内容预览', exact: true })).toContainText('<script>不执行页面脚本</script>');
  await page.getByRole('button', { name: '前往整理查看 AI 建议', exact: true }).click();
  await expect(page.getByRole('region', { name: '整理中心', exact: true })).toContainText('1 个书签');
  await page.getByRole('tab', { name: '单条建议', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成建议', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '查看操作历史', exact: true }).click();
  await expect(page.getByRole('region', { name: '操作历史记录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '备份导出', exact: true }).click();
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  await expect(page.getByText('文件已保存到所选位置。')).toBeVisible();
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('搜索标题或网址', { exact: true })).toHaveValue('Human Interface Guidelines');
  await expect(results.getByRole('option')).toHaveCount(4);
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('读完设计规范后，回到同一条书签继续整理。');
  await expect(page.getByRole('list', { name: '当前标签' })).toContainText('阅读清单');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const observed = await page.evaluate(() => ({ calls: (window as Fixture).__r01calls, export: (window as Fixture).__r08export }));
  expect(observed.export).toEqual({ source: { kind: 'profile', id: 'profile-test' }, format: 'html' });
  expect(observed.calls.filter((call) => ['tag_set_note', 'tag_add', 'save_export'].includes(call))).toEqual(['tag_set_note', 'tag_add', 'save_export']);
  expect(observed.calls.filter((call) => ['apply', 'apply_batch', 'apply_ai', 'suggest_ai', 'organize', 'inspect', 'check_links', 'test_ai'].includes(call))).toEqual([]);
  expect(errors).toEqual([]);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'r08-workspace-roundtrip.png') });
});

test('R08 identical Chrome IDs keep saved notes and draft decisions within their profile', async ({ page }) => {
  await mockBridge(page, 'sources');
  await page.goto('/');
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await saveNote(page, '研究资料中保存的备注');
  await page.getByLabel('备注', { exact: true }).fill('只属于研究资料的未保存修改');
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const source = page.getByRole('combobox', { name: '书签来源', exact: true });
  await source.selectOption({ label: '另一份资料 · Chrome' });
  const dialog = page.getByRole('dialog', { name: '切换书签来源？', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '留在当前页面', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source).toBeFocused();
  await expect(source.locator('option:checked')).toHaveText('测试研究资料 · Chrome');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('只属于研究资料的未保存修改');
  await source.selectOption({ label: '另一份资料 · Chrome' });
  await dialog.getByRole('button', { name: '清除当前输入并切换', exact: true }).click();
  await page.getByRole('option', { name: '选择 另一份资料 10 另一份资料 10 example.com', exact: true }).click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('');
  await saveNote(page, '另一份资料独立保存的备注');
  await source.selectOption({ label: '测试研究资料 · Chrome' });
  await expect(dialog).toHaveCount(0);
  await page.getByRole('option', { name: /选择 Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('研究资料中保存的备注');
  const writes = await page.evaluate(() => (window as Fixture).__r08tagWrites);
  expect(writes).toEqual([
    { profileId: 'profile-test', command: { kind: 'set_note', chromeIds: ['10'], note: '研究资料中保存的备注' } },
    { profileId: 'profile-second', command: { kind: 'set_note', chromeIds: ['10'], note: '另一份资料独立保存的备注' } },
  ]);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'r08-profile-draft-isolation.png') });
});
