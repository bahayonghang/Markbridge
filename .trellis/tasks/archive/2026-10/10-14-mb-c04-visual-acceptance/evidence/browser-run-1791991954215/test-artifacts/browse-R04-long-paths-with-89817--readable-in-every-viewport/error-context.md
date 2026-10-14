# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browse.spec.ts >> R04 long paths with classic scrollbars keep selection rows stationary and remain keyboard readable in every viewport
- Location: tests\e2e\browse.spec.ts:97:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 16
Received: 16.390625
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳至内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary "工作区导航" [ref=e5]:
    - strong [ref=e7]: Markbridge
    - navigation "主导航" [ref=e8]:
      - button "书签" [ref=e9] [cursor=pointer]
    - generic [ref=e14]:
      - heading "文件夹" [level=3] [ref=e16]
      - tree "文件夹" [ref=e17]:
        - generic [ref=e18]:
          - treeitem "长中文路径阅读资料与研究归档 第8层" [expanded] [level=9] [ref=e19]
          - treeitem "长中文路径阅读资料与研究归档 第9层" [expanded] [level=10] [ref=e25]
          - treeitem "长中文路径阅读资料与研究归档 第10层" [expanded] [level=11] [ref=e31]
          - treeitem "长中文路径阅读资料与研究归档 第11层" [expanded] [level=12] [ref=e37]
          - treeitem "长中文路径阅读资料与研究归档 第12层" [expanded] [level=13] [ref=e43]
          - treeitem "长中文路径阅读资料与研究归档 第13层" [expanded] [level=14] [ref=e49]
          - treeitem "长中文路径阅读资料与研究归档 第14层" [expanded] [level=15] [ref=e55]
          - treeitem "长中文路径阅读资料与研究归档 第15层" [expanded] [level=16] [ref=e61]
          - treeitem "长中文路径阅读资料与研究归档 第16层" [expanded] [level=17] [ref=e67]
          - treeitem "长中文路径阅读资料与研究归档 第17层" [expanded] [level=18] [ref=e73]
          - treeitem "长中文路径阅读资料与研究归档 第18层" [expanded] [level=19] [ref=e79]
          - treeitem "长中文路径阅读资料与研究归档 第19层" [expanded] [level=20] [selected] [ref=e85]
          - treeitem "长中文路径阅读资料与研究归档 第20层" [level=21] [ref=e91]
    - navigation "更多工作区" [ref=e97]:
      - button "整理" [ref=e98] [cursor=pointer]
      - button "语义检索" [ref=e102] [cursor=pointer]
      - button "操作历史" [ref=e106] [cursor=pointer]
      - button "设置" [ref=e110] [cursor=pointer]
  - main [ref=e114]:
    - generic [ref=e115]:
      - heading "书签" [level=1] [ref=e116]
      - status [ref=e117]: 已连接 Chrome
    - region "书签工作区" [ref=e118]:
      - generic [ref=e119]:
        - generic [ref=e120]:
          - generic [ref=e121]:
            - text: 书签来源
            - combobox "书签来源" [ref=e122]:
              - option "测试研究资料 · Chrome" [selected]
          - generic [ref=e123]:
            - text: 搜索标题或网址
            - textbox "搜索标题或网址" [ref=e124]
          - button "详情" [ref=e125] [cursor=pointer]
        - paragraph [ref=e130]: 资料正在实时同步。写入 Chrome 前需要确认。 缓存时间：尚无同步时间
      - generic [ref=e132]:
        - generic [ref=e134]:
          - navigation "当前目录" [ref=e135]:
            - button "书签" [ref=e136] [cursor=pointer]
            - button "书签栏" [ref=e137] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第1层" [ref=e138] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第2层" [ref=e139] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第3层" [ref=e140] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第4层" [ref=e141] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第5层" [ref=e142] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第6层" [ref=e143] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第7层" [ref=e144] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第8层" [ref=e145] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第9层" [ref=e146] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第10层" [ref=e147] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第11层" [ref=e148] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第12层" [ref=e149] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第13层" [ref=e150] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第14层" [ref=e151] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第15层" [ref=e152] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第16层" [ref=e153] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第17层" [ref=e154] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第18层" [ref=e155] [cursor=pointer]
            - button "长中文路径阅读资料与研究归档 第19层" [ref=e156] [cursor=pointer]
          - heading "书签列表" [level=2] [ref=e157]
          - button "筛选" [ref=e158] [cursor=pointer]
          - button "新建" [ref=e159] [cursor=pointer]
        - status [ref=e160]: 已加载 1 / 1 项 · 当前目录 · Ctrl+A 已加载
        - listbox "书签列表" [ref=e161]:
          - option "选择 长中文路径阅读资料与研究归档 第20层 长中文路径阅读资料与研究归档 第20层" [ref=e163]:
            - generic [ref=e164]:
              - checkbox "选择 长中文路径阅读资料与研究归档 第20层" [ref=e166]
              - generic [ref=e170]: 长中文路径阅读资料与研究归档 第20层
      - generic [ref=e172]:
        - status [ref=e173]: 范围已改变，已清除多选。
        - generic [ref=e174]: 按 Chrome 顺序 · 方向键浏览，Enter 打开
    - generic [ref=e175]:
      - generic [ref=e176]: 书签保留在 Chrome
      - generic [ref=e177]: 标签和备注保留在本机
```

# Test source

```ts
  10  |     await page.setViewportSize({ width: width!, height: height! });
  11  |     await page.goto('/');
  12  |     const list = page.getByRole('listbox', { name: '书签列表' });
  13  |     await expect(list.getByRole('option').first()).toBeVisible();
  14  |     const rowBeforeSelection = await list.getByRole('option').first().boundingBox();
  15  |     await list.getByRole('option').nth(0).click({ modifiers: ['Control'] });
  16  |     expect((await list.getByRole('option').first().boundingBox())!.y).toBeCloseTo(rowBeforeSelection!.y, 1);
  17  |     await list.getByRole('option').nth(2).click({ modifiers: ['Shift'] });
  18  |     await expect(list.getByRole('option', { selected: true })).toHaveCount(3);
  19  |     await page.keyboard.press('Control+a');
  20  |     await expect(page.getByText('已选 24 项', { exact: true })).toBeVisible();
  21  |     await page.screenshot({ path: `${evidence}/browse-selection-${width}x${height}.png` });
  22  |     const viewport = await list.boundingBox();
  23  |     expect(viewport!.height).toBeGreaterThanOrEqual(52);
  24  |     expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  25  |     expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
  26  |     await page.getByLabel('搜索标题或网址').fill('Handbook');
  27  |     await expect(page.getByRole('listbox', { name: '搜索结果' }).getByRole('option').first()).toBeVisible();
  28  |     await expect(page.getByText('范围已改变，已清除多选。')).toBeVisible();
  29  |     await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveCount(0);
  30  |     await page.getByRole('button', { name: '清空筛选' }).click();
  31  |     await expect(page.getByRole('listbox', { name: '书签列表' })).toBeVisible();
  32  |     await page.getByRole('button', { name: '筛选', exact: true }).click();
  33  |     await expect(page.getByLabel('搜索范围')).toBeVisible();
  34  |     await page.getByLabel('搜索范围').selectOption('subtree');
  35  |     await page.getByRole('button', { name: '筛选', exact: true }).click();
  36  |     await list.getByRole('option').first().click({ modifiers: ['Control'] });
  37  |     await page.getByRole('button', { name: '取消选择', exact: true }).click();
  38  |     await expect(page.getByRole('navigation', { name: '当前目录' })).toBeVisible();
  39  |     await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled();
  40  |   });
  41  | }
  42  | 
  43  | test('R03 keyboard reaches item 10001 and search match 10001 without rendering the whole library', async ({ page }) => {
  44  |   await page.addInitScript(() => {
  45  |     Object.assign(window, { __r03nodes: Array.from({ length: 10001 }, (_, index) => ({ chromeId: `wide-${index}`, parentId: '1', position: index, kind: 'bookmark', title: `needle ${index}`, url: `https://example.invalid/${index}` })) });
  46  |   });
  47  |   await mockBridge(page, 'library');
  48  |   await page.goto('/');
  49  |   const list = page.getByRole('listbox', { name: '书签列表' });
  50  |   await expect(page.getByText(/已加载 200 \/ 10001/)).toBeVisible();
  51  |   await list.getByRole('option').first().focus();
  52  |   await page.keyboard.press('Control+a');
  53  |   await expect(page.getByText('已选 200 项', { exact: true })).toBeVisible();
  54  |   await page.keyboard.press('Control+End');
  55  |   await expect(page.getByText(/已加载 10001 \/ 10001/)).toBeVisible();
  56  |   const last = list.getByRole('option', { name: /needle 10000/ });
  57  |   await expect(last).toBeVisible();
  58  |   await expect(last).toBeFocused();
  59  |   await expect(last).toHaveAttribute('aria-posinset', '10001');
  60  |   await expect(last).toHaveAttribute('aria-setsize', '10001');
  61  |   expect(await list.getByRole('option').count()).toBeLessThan(100);
  62  |   await page.getByLabel('搜索标题或网址').fill('needle');
  63  |   const search = page.getByRole('listbox', { name: '搜索结果' });
  64  |   await expect(page.getByText(/已加载 200 \/ 10001/)).toBeVisible();
  65  |   await search.getByRole('option').first().focus();
  66  |   await page.keyboard.press('Control+End');
  67  |   await expect(search.getByRole('option', { name: /needle 10000/ })).toBeFocused();
  68  |   await page.screenshot({ path: `${evidence}/browse-10001-last.png` });
  69  | });
  70  | 
  71  | test('R03 twenty-level Chinese path remains navigable and empty folders open a real create form', async ({ page }) => {
  72  |   await page.addInitScript(() => {
  73  |     Object.assign(window, { __r03nodes: Array.from({ length: 20 }, (_, index) => ({ chromeId: `folder-${index}`, parentId: index ? `folder-${index - 1}` : '1', position: 0, kind: 'folder', title: `长中文路径阅读资料与研究归档 第${index + 1}层`, url: null })) });
  74  |   });
  75  |   await mockBridge(page, 'library');
  76  |   await page.goto('/');
  77  |   await page.getByLabel('搜索标题或网址').fill('第20层');
  78  |   const result = page.getByRole('option', { name: /第20层/ });
  79  |   await result.dblclick();
  80  |   await expect(page.getByText('此文件夹没有书签。')).toBeVisible();
  81  |   const crumbs = page.getByRole('navigation', { name: '当前目录' });
  82  |   await expect(crumbs.getByRole('button', { name: /第20层/ })).toHaveAttribute('aria-current', 'location');
  83  |   await expect(crumbs.getByRole('button', { name: /第20层/ })).toBeInViewport();
  84  |   await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-level', '21');
  85  |   await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-posinset', '1');
  86  |   await expect(page.getByRole('treeitem', { name: /第20层/ })).toHaveAttribute('aria-setsize', '1');
  87  |   await page.getByRole('button', { name: '新建', exact: true }).click();
  88  |   await expect(page.getByLabel('名称', { exact: true })).toHaveValue('');
  89  |   await page.getByLabel('名称', { exact: true }).fill('新书签');
  90  |   await page.getByLabel('网址', { exact: true }).fill('https://example.invalid/new');
  91  |   await expect(page.getByRole('button', { name: '预览新书签' })).toBeEnabled();
  92  |   await expect(page.getByRole('button', { name: '预览修改' })).toHaveCount(0);
  93  |   expect(await page.evaluate(() => (window as unknown as { __r01calls: string[] }).__r01calls.filter((call) => call === 'apply'))).toEqual([]);
  94  |   await page.screenshot({ path: `${evidence}/browse-depth20-create.png` });
  95  | });
  96  | 
  97  | test('R04 long paths with classic scrollbars keep selection rows stationary and remain keyboard readable in every viewport', async ({ page }) => {
  98  |   await page.addInitScript(() => {
  99  |     Object.assign(window, { __r03nodes: Array.from({ length: 20 }, (_, index) => ({ chromeId: `folder-${index}`, parentId: index ? `folder-${index - 1}` : '1', position: 0, kind: 'folder', title: `长中文路径阅读资料与研究归档 第${index + 1}层`, url: null })) });
  100 |   });
  101 |   await mockBridge(page, 'library');
  102 |   await page.goto('/');
  103 |   await page.addStyleTag({ content: '.library-breadcrumbs::-webkit-scrollbar { height: 16px; } .library-breadcrumbs::-webkit-scrollbar-thumb { background: #606b7c; }' });
  104 |   await page.getByLabel('搜索标题或网址').fill('第19层');
  105 |   await page.getByRole('option', { name: /第19层/ }).dblclick();
  106 |   const row = page.getByRole('option', { name: /第20层/ });
  107 |   for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
  108 |     await page.setViewportSize({ width: width!, height: height! });
  109 |     const crumbs = page.getByRole('navigation', { name: '当前目录' });
> 110 |     expect(await crumbs.evaluate((node) => node.getBoundingClientRect().height - node.clientHeight)).toBe(16);
      |                                                                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  111 |     await crumbs.getByRole('button', { name: /第19层/ }).focus();
  112 |     await expect(crumbs.getByRole('button', { name: /第19层/ })).toBeInViewport();
  113 |     const before = await row.boundingBox();
  114 |     await row.click({ modifiers: ['Control'] });
  115 |     expect((await row.boundingBox())!.y).toBeCloseTo(before!.y, 1);
  116 |     await expect(page.getByRole('navigation', { name: '当前目录' })).toHaveCount(0);
  117 |     await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
  118 |     await page.locator('.browse-heading button').last().evaluate((node) => node.focus());
  119 |     await expect(page.locator('.browse-heading button').last()).not.toBeFocused();
  120 |     const path = page.getByLabel('查看当前目录完整路径');
  121 |     await path.click();
  122 |     const completePath = page.locator('.selection-path > p');
  123 |     await expect(completePath).toContainText('第1层');
  124 |     await expect(completePath).toContainText('第19层');
  125 |     const bounds = await completePath.boundingBox();
  126 |     expect(bounds!.y + bounds!.height).toBeLessThan(height!);
  127 |     await completePath.focus();
  128 |     await page.keyboard.press('End');
  129 |     await expect.poll(() => completePath.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  130 |     if (width === 640 && height === 480) await page.screenshot({ path: `${evidence}/r04-classic-scrollbar-path-640x480.png` });
  131 |     await page.keyboard.press('Escape');
  132 |     await expect(path).toBeFocused();
  133 |     await expect(completePath).toBeHidden();
  134 |     await page.getByRole('button', { name: '取消选择', exact: true }).click();
  135 |     await expect(page.getByRole('navigation', { name: '当前目录' })).toBeVisible();
  136 |     await expect(page.getByRole('button', { name: '新建', exact: true })).toBeEnabled();
  137 |     expect((await row.boundingBox())!.y).toBeCloseTo(before!.y, 1);
  138 |   }
  139 | });
  140 | 
```