import { expect, test, type Page } from '@playwright/test';
import { mockBridge } from './mock-bridge';

const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
const sizes = [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }];
async function calls(page: Page) { return page.evaluate(() => (window as unknown as { __semanticCalls: string[] }).__semanticCalls); }
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })))
    .toEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  expect(await page.locator('.semantic-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}
async function enable(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  await expect(page.getByLabel('启用本地语义检索')).toBeEnabled();
  await page.getByLabel('向量模型', { exact: true }).fill('fixture-local');
  await page.getByLabel('启用本地语义检索').check();
  await page.getByRole('button', { name: '保存语义配置' }).click();
  await expect(page.getByText('语义配置已保存。选择并审查范围后，才会建立索引。')).toBeVisible();
}
async function chooseAndReview(page: Page) {
  await page.getByRole('button', { name: '语义检索', exact: true }).click();
  await expect(page.getByRole('button', { name: '审查本次范围' })).toBeEnabled();
  await page.getByRole('button', { name: '审查本次范围' }).click();
  await expect(page.getByRole('region', { name: '索引确认审查' })).toBeVisible();
}

for (const size of sizes) {
  test(`semantic review and explicit query mock ${size.width}x${size.height}`, async ({ page }) => {
    await mockBridge(page, 'library'); await page.setViewportSize(size); await page.goto('/');
    await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
    await page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true }).check();
    await enable(page);
    expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
    await page.screenshot({ path: `${evidence}/semantic-settings-${size.width}x${size.height}.png` });
    await chooseAndReview(page);
    const review = page.getByRole('region', { name: '索引确认审查' });
    await expect(review.getByText('2 个', { exact: true })).toBeVisible();
    await expect(review.getByText(/1 个输入会裁剪/)).toBeVisible();
    await expect(review.getByText(/32.0 KiB，另加 SQLite 开销与模型自身空间/)).toBeVisible();
    expect((await calls(page)).filter(call => call === 'start')).toEqual([]);
    await noOverflow(page);
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/semantic-review-${size.width}x${size.height}.png` });
    if (size.width === 640 && size.height === 480) {
      const confirm = page.getByRole('button', { name: '确认并建立索引', exact: true });
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${evidence}/semantic-confirm-controls-640x480.png` });
    }
    await page.getByRole('button', { name: '确认并建立索引' }).click();
    await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
    const query = page.getByLabel('描述想找的内容');
    await query.fill('哪些资料解释键盘操作和界面设计？');
    expect((await calls(page)).filter(call => call === 'query')).toEqual([]);
    await query.press('Enter');
    await expect(page.getByRole('button', { name: /Human Interface Guidelines.*相似度 0.913/ })).toBeVisible();
    await page.getByRole('region', { name: '按意思查找' }).scrollIntoViewIfNeeded();
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/semantic-query-${size.width}x${size.height}.png` });
    await page.getByRole('button', { name: /Human Interface Guidelines.*相似度 0.913/ }).click();
    await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '书签', level: 1 })).toBeVisible();
  });
}

test('semantic defaults, explicit missing model and settings keyboard remain independent from chat AI', async ({ page }) => {
  await mockBridge(page, 'library'); await page.goto('/');
  await page.getByRole('button', { name: '语义检索', exact: true }).click();
  await expect(page.getByText('语义检索默认关闭。请在语义设置中选择本机模型并启用，再审查本次范围。')).toBeVisible();
  await expect(page.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
  await page.getByRole('button', { name: '语义设置' }).click();
  await page.getByRole('tab', { name: '语义检索', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
  await expect(page.getByLabel('启用 AI')).not.toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '语义检索', exact: true })).toBeFocused();
  await page.getByLabel('向量模型', { exact: true }).fill('missing-local');
  await page.getByRole('button', { name: '保存语义配置' }).click();
  expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
  await page.evaluate(() => { (window as unknown as { __semanticMissing: boolean }).__semanticMissing = true; });
  await page.getByRole('button', { name: '检查本地模型' }).click();
  await expect(page.getByText('本地模型不可用。请选择本机已有、支持向量生成的模型。')).toBeVisible();
  await expect(page.getByText('fixture-private-model-error')).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/semantic-missing-model.png` });
});

test('semantic pause resume disable and confirmed deletion preserve ordinary search and local metadata', async ({ page }) => {
  await mockBridge(page, 'details'); await page.setViewportSize({ width: 640, height: 480 }); await page.goto('/');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await page.getByLabel('备注', { exact: true }).fill('语义索引之外仍保留的阅读备注');
  await page.getByRole('button', { name: '保存备注' }).click();
  await expect(page.getByText('备注尚未保存')).toHaveCount(0);
  await page.getByLabel('添加标签', { exact: true }).fill('阅读清单');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(page.locator('.local-tags').getByText('阅读清单', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  await page.getByLabel('搜索标题或网址').fill('Guidelines');
  await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  await enable(page);
  await page.evaluate(() => { (window as unknown as { __semanticHoldBuild: boolean }).__semanticHoldBuild = true; });
  await chooseAndReview(page); await page.getByRole('button', { name: '确认并建立索引' }).click();
  await expect(page.getByText('索引状态：正在建立索引', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停索引' }).click();
  await expect(page.getByText('索引已暂停。已完成的条目保留。')).toBeVisible();
  await page.screenshot({ path: `${evidence}/semantic-paused-640x480.png` });
  await page.getByRole('button', { name: '停用语义检索' }).click();
  await expect(page.getByText('语义检索已关闭。普通搜索、标签、备注和摘要保留。')).toBeVisible();
  await page.getByRole('button', { name: '返回普通搜索' }).click();
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  await expect(page.getByRole('option', { name: /Human Interface Guidelines/ }).first()).toBeVisible();
  await enable(page); await page.getByRole('button', { name: '语义检索', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { __semanticHoldBuild: boolean }).__semanticHoldBuild = false; });
  await page.getByRole('button', { name: '继续索引' }).click();
  await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除派生索引' }).click();
  expect((await calls(page)).filter(call => call === 'delete')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '删除派生索引' })).toBeFocused();
  await page.getByRole('button', { name: '删除派生索引' }).click();
  await page.getByRole('button', { name: '确认删除派生索引' }).click();
  await expect(page.getByText('派生索引已删除。书签、标签、备注、摘要和普通搜索保留。')).toBeVisible();
  await page.screenshot({ path: `${evidence}/semantic-deleted-640x480.png` });
  await page.getByRole('button', { name: '返回普通搜索' }).click();
  await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  await page.getByRole('tab', { name: '标签备注' }).click();
  await expect(page.getByLabel('添加标签', { exact: true })).toBeVisible();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('语义索引之外仍保留的阅读备注');
  await expect(page.locator('.local-tags').getByText('阅读清单', { exact: true })).toBeVisible();
});

test('semantic empty loading error and cancelled late reply stay separate', async ({ page }) => {
  await mockBridge(page, 'library'); await page.goto('/');
  await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  await enable(page); await chooseAndReview(page); await page.getByRole('button', { name: '确认并建立索引' }).click();
  await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __semanticQueryMode: string }).__semanticQueryMode = 'empty'; });
  await page.getByLabel('描述想找的内容').fill('没有结果的描述'); await page.getByRole('button', { name: '查询语义索引' }).click();
  await expect(page.getByText('没有可显示的结果。请尝试其他描述，或补充摘要后更新索引。')).toBeVisible();
  await page.screenshot({ path: `${evidence}/semantic-empty.png` });
  await page.evaluate(() => { (window as unknown as { __semanticQueryMode: string }).__semanticQueryMode = 'error'; });
  await page.getByRole('button', { name: '查询语义索引' }).click();
  await expect(page.getByText('查询未完成。请检查本地模型后重新提交。')).toBeVisible();
  await expect(page.getByText('fixture-private-query-body')).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/semantic-error.png` });
  await page.evaluate(() => { (window as unknown as { __semanticQueryMode: string }).__semanticQueryMode = 'hold'; });
  await page.getByRole('button', { name: '查询语义索引' }).click();
  await expect(page.getByText('正在查询本地模型与索引。')).toBeVisible();
  await page.screenshot({ path: `${evidence}/semantic-loading.png` });
  await page.getByRole('button', { name: '取消查询' }).click();
  await page.evaluate(() => (window as unknown as { __semanticResolveQuery: () => void }).__semanticResolveQuery());
  await expect(page.getByText('查询已取消。')).toBeVisible();
  await expect(page.getByRole('button', { name: /Human Interface Guidelines.*相似度/ })).toHaveCount(0);
  expect((await calls(page)).filter(call => call === 'cancel_query')).toEqual(['cancel_query']);
});
