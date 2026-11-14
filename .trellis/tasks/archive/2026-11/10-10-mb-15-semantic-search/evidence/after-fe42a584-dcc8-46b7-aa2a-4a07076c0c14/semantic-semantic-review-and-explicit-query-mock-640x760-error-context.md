# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: semantic.spec.ts >> semantic review and explicit query mock 640x760
- Location: tests\e2e\semantic.spec.ts:29:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: '索引确认审查' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: '索引确认审查' }) with timeout 5000ms
  - waiting for getByRole('region', { name: '索引确认审查' })

```

```yaml
- link "跳至内容":
  - /url: "#main-content"
- complementary "工作区导航":
  - navigation "主导航":
    - button "书签"
  - navigation "更多工作区":
    - button "整理"
    - button "语义检索"
    - button "操作历史"
    - button "设置"
- main:
  - heading "语义检索" [level=1]
  - status: 已连接 Chrome
  - region "语义工作区":
    - text: 书签来源
    - combobox "书签来源":
      - option "测试研究资料 · Chrome" [selected]
    - paragraph: 资料正在实时同步。写入 Chrome 前需要确认。 缓存时间：尚无同步时间
    - region "本地语义工作区":
      - heading "本地语义检索" [level=2]
      - paragraph: 用标题与已保存摘要建立本机索引。按意思查找，与普通搜索分别使用。
      - button "返回普通搜索"
      - strong: 测试研究资料
      - paragraph: 索引状态：尚未建立
      - button "语义设置"
      - button "刷新状态"
      - button "停用语义检索"
      - region "审查索引范围":
        - heading "审查索引范围" [level=3]
        - paragraph: 只发送书签标题与已保存摘要，不追加网址、本地标签、备注或正文。不抓取网页；新增书签不会自动加入。
        - radiogroup "语义索引范围":
          - radio "当前选择（2 个书签）" [checked]
          - text: 当前选择（2 个书签）
          - radio "指定目录及后代"
          - text: 指定目录及后代
        - button "审查本次范围"
        - heading "确认建立这份索引" [level=4]
        - term: 资料与范围
        - definition: 测试研究资料 / 当前勾选的书签
        - term: 模型
        - definition: fixture-local
        - term: 书签数量
        - definition: 2 个
        - term: 向量空间上界
        - definition: 32.0 KiB，另加 SQLite 开销与模型自身空间
        - term: 输入裁剪
        - definition: 1 个输入会裁剪；每条最多 8,192 个字符、32.0 KiB
        - paragraph: 仅处理这次确认的范围。标题或摘要变化会使条目待更新；暂停后须主动继续。已有派生索引会由本次范围替换。
        - button "确认并建立索引"
        - button "取消本次审查"
      - paragraph: 还没有语义索引。普通搜索不受影响；完成范围确认后可在这里查询。
  - text: 书签保留在 Chrome 标签和备注保留在本机
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | import { mockBridge } from './mock-bridge';
  3   | 
  4   | const evidence = process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots';
  5   | const sizes = [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 640, height: 760 }, { width: 1100, height: 480 }, { width: 640, height: 480 }];
  6   | async function calls(page: Page) { return page.evaluate(() => (window as unknown as { __semanticCalls: string[] }).__semanticCalls); }
  7   | async function noOverflow(page: Page) {
  8   |   expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })))
  9   |     .toEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  10  |   expect(await page.locator('.semantic-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  11  | }
  12  | async function enable(page: Page) {
  13  |   await page.getByRole('button', { name: '设置', exact: true }).click();
  14  |   await page.getByRole('tab', { name: '语义检索', exact: true }).click();
  15  |   await expect(page.getByLabel('启用本地语义检索')).toBeEnabled();
  16  |   await page.getByLabel('向量模型', { exact: true }).fill('fixture-local');
  17  |   await page.getByLabel('启用本地语义检索').check();
  18  |   await page.getByRole('button', { name: '保存语义配置' }).click();
  19  |   await expect(page.getByText('语义配置已保存。选择并审查范围后，才会建立索引。')).toBeVisible();
  20  | }
  21  | async function chooseAndReview(page: Page) {
  22  |   await page.getByRole('button', { name: '语义检索', exact: true }).click();
  23  |   await expect(page.getByRole('button', { name: '审查本次范围' })).toBeEnabled();
  24  |   await page.getByRole('button', { name: '审查本次范围' }).click();
> 25  |   await expect(page.getByRole('region', { name: '索引确认审查' })).toBeVisible();
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  26  | }
  27  | 
  28  | for (const size of sizes) {
  29  |   test(`semantic review and explicit query mock ${size.width}x${size.height}`, async ({ page }) => {
  30  |     await mockBridge(page, 'library'); await page.setViewportSize(size); await page.goto('/');
  31  |     await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  32  |     await page.getByRole('checkbox', { name: '选择 设计系统里的留白与秩序', exact: true }).check();
  33  |     await enable(page);
  34  |     expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
  35  |     await page.screenshot({ path: `${evidence}/semantic-settings-${size.width}x${size.height}.png` });
  36  |     await chooseAndReview(page);
  37  |     const review = page.getByRole('region', { name: '索引确认审查' });
  38  |     await expect(review.getByText('2 个', { exact: true })).toBeVisible();
  39  |     await expect(review.getByText(/1 个输入会裁剪/)).toBeVisible();
  40  |     await expect(review.getByText(/32.0 KiB，另加 SQLite 开销与模型自身空间/)).toBeVisible();
  41  |     expect((await calls(page)).filter(call => call === 'start')).toEqual([]);
  42  |     await noOverflow(page);
  43  |     await page.screenshot({ path: `${evidence}/semantic-review-${size.width}x${size.height}.png` });
  44  |     await page.getByRole('button', { name: '确认并建立索引' }).click();
  45  |     await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
  46  |     const query = page.getByLabel('描述想找的内容');
  47  |     await query.fill('哪些资料解释键盘操作和界面设计？');
  48  |     expect((await calls(page)).filter(call => call === 'query')).toEqual([]);
  49  |     await query.press('Enter');
  50  |     await expect(page.getByRole('button', { name: /Human Interface Guidelines.*相似度 0.913/ })).toBeVisible();
  51  |     await noOverflow(page);
  52  |     await page.screenshot({ path: `${evidence}/semantic-query-${size.width}x${size.height}.png` });
  53  |     await page.getByRole('button', { name: /Human Interface Guidelines.*相似度 0.913/ }).click();
  54  |     await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).toBeVisible();
  55  |     await expect(page.getByRole('heading', { name: '书签', level: 1 })).toBeVisible();
  56  |   });
  57  | }
  58  | 
  59  | test('semantic defaults, explicit missing model and settings keyboard remain independent from chat AI', async ({ page }) => {
  60  |   await mockBridge(page, 'library'); await page.goto('/');
  61  |   await page.getByRole('button', { name: '语义检索', exact: true }).click();
  62  |   await expect(page.getByText('语义检索默认关闭。请在语义设置中选择本机模型并启用，再审查本次范围。')).toBeVisible();
  63  |   await expect(page.getByRole('button', { name: '审查本次范围' })).toBeDisabled();
  64  |   expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
  65  |   await page.getByRole('button', { name: '语义设置' }).click();
  66  |   await page.getByRole('tab', { name: '语义检索', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  67  |   await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeFocused();
  68  |   await expect(page.getByLabel('启用 AI')).not.toBeChecked();
  69  |   await page.keyboard.press('ArrowRight');
  70  |   await expect(page.getByRole('tab', { name: '语义检索', exact: true })).toBeFocused();
  71  |   await page.getByLabel('向量模型', { exact: true }).fill('missing-local');
  72  |   await page.getByRole('button', { name: '保存语义配置' }).click();
  73  |   expect((await calls(page)).filter(call => ['check_model', 'start', 'query'].includes(call))).toEqual([]);
  74  |   await page.evaluate(() => { (window as unknown as { __semanticMissing: boolean }).__semanticMissing = true; });
  75  |   await page.getByRole('button', { name: '检查本地模型' }).click();
  76  |   await expect(page.getByText('本地模型不可用。请选择本机已有、支持向量生成的模型。')).toBeVisible();
  77  |   await expect(page.getByText('fixture-private-model-error')).toHaveCount(0);
  78  |   await page.screenshot({ path: `${evidence}/semantic-missing-model.png` });
  79  | });
  80  | 
  81  | test('semantic pause resume disable and confirmed deletion preserve ordinary search and local metadata', async ({ page }) => {
  82  |   await mockBridge(page, 'library'); await page.setViewportSize({ width: 640, height: 480 }); await page.goto('/');
  83  |   await page.getByLabel('搜索标题或网址').fill('Guidelines');
  84  |   await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  85  |   await enable(page);
  86  |   await page.evaluate(() => { (window as unknown as { __semanticHoldBuild: boolean }).__semanticHoldBuild = true; });
  87  |   await chooseAndReview(page); await page.getByRole('button', { name: '确认并建立索引' }).click();
  88  |   await expect(page.getByText('索引状态：正在建立索引', { exact: true })).toBeVisible();
  89  |   await page.getByRole('button', { name: '暂停索引' }).click();
  90  |   await expect(page.getByText('索引已暂停。已完成的条目保留。')).toBeVisible();
  91  |   await page.screenshot({ path: `${evidence}/semantic-paused-640x480.png` });
  92  |   await page.getByRole('button', { name: '停用语义检索' }).click();
  93  |   await expect(page.getByText('语义检索已关闭。普通搜索、标签、备注和摘要保留。')).toBeVisible();
  94  |   await page.getByRole('button', { name: '返回普通搜索' }).click();
  95  |   await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  96  |   await expect(page.getByRole('option', { name: /Human Interface Guidelines/ }).first()).toBeVisible();
  97  |   await enable(page); await page.getByRole('button', { name: '语义检索', exact: true }).click();
  98  |   await page.evaluate(() => { (window as unknown as { __semanticHoldBuild: boolean }).__semanticHoldBuild = false; });
  99  |   await page.getByRole('button', { name: '继续索引' }).click();
  100 |   await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
  101 |   await page.getByRole('button', { name: '删除派生索引' }).click();
  102 |   expect((await calls(page)).filter(call => call === 'delete')).toEqual([]);
  103 |   await page.keyboard.press('Escape');
  104 |   await expect(page.getByRole('button', { name: '删除派生索引' })).toBeFocused();
  105 |   await page.getByRole('button', { name: '删除派生索引' }).click();
  106 |   await page.getByRole('button', { name: '确认删除派生索引' }).click();
  107 |   await expect(page.getByText('派生索引已删除。书签、标签、备注、摘要和普通搜索保留。')).toBeVisible();
  108 |   await page.screenshot({ path: `${evidence}/semantic-deleted-640x480.png` });
  109 |   await page.getByRole('button', { name: '返回普通搜索' }).click();
  110 |   await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  111 |   await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  112 |   await page.getByRole('tab', { name: '标签备注' }).click();
  113 |   await expect(page.getByLabel('标签名称')).toBeVisible();
  114 | });
  115 | 
  116 | test('semantic empty loading error and cancelled late reply stay separate', async ({ page }) => {
  117 |   await mockBridge(page, 'library'); await page.goto('/');
  118 |   await page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true }).check();
  119 |   await enable(page); await chooseAndReview(page); await page.getByRole('button', { name: '确认并建立索引' }).click();
  120 |   await expect(page.getByText('索引状态：可以检索', { exact: true })).toBeVisible();
  121 |   await page.evaluate(() => { (window as unknown as { __semanticQueryMode: string }).__semanticQueryMode = 'empty'; });
  122 |   await page.getByLabel('描述想找的内容').fill('没有结果的描述'); await page.getByRole('button', { name: '查询语义索引' }).click();
  123 |   await expect(page.getByText('没有可显示的结果。请尝试其他描述，或补充摘要后更新索引。')).toBeVisible();
  124 |   await page.screenshot({ path: `${evidence}/semantic-empty.png` });
  125 |   await page.evaluate(() => { (window as unknown as { __semanticQueryMode: string }).__semanticQueryMode = 'error'; });
```