# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace-layout-review.spec.ts >> C03 minimum 20px light keeps keyboard returns and source-bound drafts across export
- Location: tests\e2e\workspace-layout-review.spec.ts:9:3

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator: getByRole('button', { name: '详情', exact: true })
Expected: focused
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeFocused" getByRole('button', { name: '详情', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: '详情', exact: true })

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
  - heading "书签" [level=1]
  - status: 已连接 Chrome
  - region "书签工作区":
    - heading "详情" [level=3]
    - button "关闭详情，返回列表"
    - paragraph: Human Interface Guidelines
    - paragraph: example.com
    - tablist "详情分区":
      - tab "信息"
      - tab "标签备注" [selected]
      - tab "内容预览"
    - tabpanel "标签备注":
      - paragraph: 标签和备注只写入本机。Chrome 标题和网址保持不变。
      - text: 备注
      - textbox "备注": C03 light：最小窗口下保留未保存备注。
      - status: 备注尚未保存
      - button "保存备注"
      - text: 添加标签
      - textbox "添加标签"
      - button "添加标签" [disabled]
      - group: 管理标签
      - button "撤销上次标签变更" [disabled]
      - group: 可选：将标签写入标题
    - status: 已选 1 项
  - text: 书签保留在 Chrome 标签和备注保留在本机
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { mkdir, writeFile } from 'node:fs/promises';
  3  | import { join } from 'node:path';
  4  | import { mockBridge } from './mock-bridge';
  5  | 
  6  | const output = join(process.env.MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots', 'layout-review');
  7  | 
  8  | for (const theme of ['light', 'dark']) {
  9  |   test(`C03 minimum 20px ${theme} keeps keyboard returns and source-bound drafts across export`, async ({ page }) => {
  10 |     await page.setViewportSize({ width: 640, height: 480 });
  11 |     await page.addInitScript(theme => localStorage.setItem('markbridge.ui-preferences.v2', JSON.stringify({ version: 2, theme, font: { kind: 'preset', value: 'system' }, fontSizePx: 20 })), theme);
  12 |     await mockBridge(page, 'sources');
  13 |     await page.goto('/');
  14 |     const folder = page.getByRole('button', { name: '文件夹', exact: true });
  15 |     await folder.focus();
  16 |     await page.keyboard.press('Enter');
  17 |     await expect(page.getByRole('treeitem', { name: '书签栏', exact: true })).toBeFocused();
  18 |     await page.keyboard.press('Escape');
  19 |     await expect(folder).toBeFocused();
  20 | 
  21 |     await page.getByLabel('搜索标题或网址').fill('Guidelines');
  22 |     await expect(page.getByRole('status').filter({ hasText: '已加载 4 / 4 项' })).toBeVisible();
  23 |     const selected = page.getByRole('checkbox', { name: '选择 Human Interface Guidelines', exact: true });
  24 |     await selected.focus();
  25 |     await page.keyboard.press('Space');
  26 |     await expect(selected).toBeChecked();
  27 |     await expect(selected).toBeFocused();
  28 |     await page.getByRole('option', { name: /Human Interface Guidelines/ }).first().click();
  29 |     await page.getByRole('tab', { name: '标签备注', exact: true }).click();
  30 |     const draft = `C03 ${theme}：最小窗口下保留未保存备注。`;
  31 |     await page.getByLabel('备注', { exact: true }).fill(draft);
  32 |     await page.getByRole('button', { name: '操作历史', exact: true }).click();
  33 |     await page.getByRole('button', { name: '备份导出', exact: true }).click();
  34 |     const source = page.getByRole('combobox', { name: '书签来源', exact: true });
  35 |     await expect(source).toHaveValue('profile:profile-test');
  36 |     await source.focus();
  37 |     await source.selectOption('profile:profile-second');
  38 |     const confirm = page.getByRole('dialog', { name: '切换书签来源？' });
  39 |     await expect(confirm).toBeVisible();
  40 |     const cancel = confirm.getByRole('button', { name: '留在当前页面', exact: true });
  41 |     await expect(cancel).toBeFocused();
  42 |     await expect(cancel).toBeInViewport({ ratio: 1 });
  43 |     await mkdir(output, { recursive: true });
  44 |     await page.screenshot({ path: join(output, `${theme}-20-minimum-source-confirm.png`) });
  45 |     await page.keyboard.press('Escape');
  46 |     await expect(source).toBeFocused();
  47 |     await expect(source).toHaveValue('profile:profile-test');
  48 |     await page.getByRole('button', { name: '书签', exact: true }).click();
  49 |     await expect(page.getByLabel('备注', { exact: true })).toHaveValue(draft);
  50 |     await page.getByRole('button', { name: '关闭详情，返回列表', exact: true }).focus();
  51 |     await page.keyboard.press('Escape');
> 52 |     await expect(page.getByRole('button', { name: '详情', exact: true })).toBeFocused();
     |                                                                         ^ Error: expect(locator).toBeFocused() failed
  53 |     await expect(page.getByLabel('搜索标题或网址')).toHaveValue('Guidelines');
  54 |     await expect(selected).toBeChecked();
  55 |     const result = await page.evaluate(() => ({
  56 |       calls: (window as unknown as { __r01calls: string[] }).__r01calls,
  57 |       width: document.documentElement.scrollWidth,
  58 |       height: document.documentElement.scrollHeight,
  59 |     }));
  60 |     expect(result.calls.filter(call => ['content_preview', 'tag_set_note', 'save_export', 'apply', 'apply_batch', 'test_ai', 'suggest_ai', 'organize', 'check_links'].includes(call))).toEqual([]);
  61 |     expect([result.width, result.height]).toEqual([640, 480]);
  62 |     await page.screenshot({ path: join(output, `${theme}-20-minimum-restored.png`) });
  63 |     await writeFile(join(output, `${theme}-20-minimum.json`), `${JSON.stringify({ theme, fontSizePx: 20, viewport: { width: 640, height: 480 }, result }, null, 2)}\n`);
  64 |   });
  65 | }
  66 | 
```