// R03 real IPC and keyboard coverage beyond the legacy list/search limits.
import { expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, protocolNode, until } from './native-driver.mjs';

const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), scope: 'R03 actual native paged cache and keyboard, synthetic 10001 siblings', controls: [], errors: [], screenshots: [] };
let app;
let stage = 'prepare';
function ensure(condition, code) { if (!condition) throw new Error(code); }
function pass(control, detail = {}) { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); }
function node(chromeId, parentId, position, kind, title) { return protocolNode({ chromeId, parentId, position, kind, title, url: kind === 'bookmark' ? `https://example.invalid/r03/${chromeId}` : null }); }
async function query(overrides = {}, captureError = false) {
  const request = { folderId: '1', folderScope: 'children', query: '', tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null, ...overrides };
  return app.page.evaluate(({ request, captureError }) => window.__TAURI_INTERNALS__.invoke('cache_query', { profileId: 'pb10k', request }).catch(error => { if (captureError) return { error }; throw error; }), { request, captureError });
}
async function local(command) { return app.page.evaluate(command => window.__TAURI_INTERNALS__.invoke('tag_command', { profileId: 'pb10k', command }), command); }
async function screenshot(name) {
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) });
  report.screenshots.push({ name, ...await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })) });
}
try {
  report.environment = await environment();
  const nodes = [node('0', null, 0, 'folder', '合成根'), node('1', '0', 0, 'folder', 'R03 分页目录'), node('2', '0', 1, 'folder', 'R03 其他目录')];
  nodes[1].folderType = 'bookmarks-bar'; nodes[2].folderType = 'other';
  for (let index = 0; index < 10001; index++) nodes.push(node(`b${index}`, '1', index, 'bookmark', `R03 分页 ${String(index).padStart(5, '0')}`));
  nodes.push(node('outside', '2', 0, 'bookmark', 'R03 分页 外部'), node('empty', '2', 1, 'folder', 'R03 空目录'));
  let parent = '2';
  for (let index = 0; index < 18; index++) { const id = `deep${index}`; nodes.push(node(id, parent, index ? 0 : 2, 'folder', `中文深层 ${index} · 长路径名称`)); parent = id; }
  nodes.push(node('deep-bookmark', parent, 0, 'bookmark', 'R03 深层末项'));
  report.isolationRoot = await fixtureRoot(nodes);
  report.fixture = { totalNodes: nodes.length, sameFolderBookmarks: 10001, deepestFolderDepth: 20 };
  app = await launch(report.isolationRoot);
  report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  await app.page.locator('#library-search').waitFor();
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.resize(1100, 760);

  stage = 'backend-pagination';
  const first = await query();
  ensure(first.total === 10001 && first.items.length === 200 && first.nextOffset === 200, 'BAD_FIRST_PAGE');
  const seen = new Set();
  let current = first;
  for (;;) {
    for (const item of current.items) { ensure(!seen.has(item.chromeId), 'DUPLICATE_PAGE_ITEM'); seen.add(item.chromeId); }
    if (current.nextOffset === null) break;
    current = await query({ offset: current.nextOffset, expectedRevision: first.revision, expectedSourceEpoch: first.sourceEpoch });
    ensure(current.total === first.total && current.revision === first.revision && current.sourceEpoch === first.sourceEpoch, 'PAGE_VERSION_DRIFT');
  }
  ensure(seen.size === 10001 && current.items.at(-1).chromeId === 'b10000', 'MISSING_LAST_ITEM');
  pass('all_10001_siblings_reachable_without_duplicate', { total: seen.size, revision: first.revision, sourceEpoch: first.sourceEpoch });
  const conflict = await query({ expectedRevision: first.revision + 1, expectedSourceEpoch: first.sourceEpoch }, true);
  ensure(conflict.error === 'CONFLICT', 'STALE_REVISION_ACCEPTED');
  pass('stale_revision_rejected');

  stage = 'query-intersection';
  const catalog = await local({ kind: 'add', chromeIds: ['b5', 'outside'], name: 'R03 合成交集' });
  const tagId = catalog.tags.find(tag => tag.name === 'R03 合成交集')?.tagId;
  ensure(!!tagId, 'TAG_NOT_CREATED');
  await local({ kind: 'set_note', chromeIds: ['b5', 'b6'], note: '仅在本地的合成备注' });
  const intersection = await query({ folderScope: 'subtree', query: 'R03 分页', tagIds: [tagId] });
  ensure(intersection.total === 1 && intersection.items[0]?.chromeId === 'b5', 'FOLDER_TEXT_TAG_NOT_INTERSECTION');
  const withoutNotes = await query({ query: '仅在本地的合成备注', folderScope: 'subtree' });
  const withNotes = await query({ query: '仅在本地的合成备注', folderScope: 'subtree', includeNote: true, tagIds: [tagId] });
  ensure(withoutNotes.total === 0 && withNotes.total === 1 && withNotes.items[0]?.chromeId === 'b5', 'NOTE_SCOPE_NOT_EXPLICIT');
  pass('folder_text_tag_intersection_and_explicit_note_scope');

  stage = 'native-list-last';
  await app.page.getByRole('treeitem').filter({ hasText: 'R03 分页目录' }).click();
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 00000' })).toBeVisible();
  const listbox = app.page.getByRole('listbox', { name: '书签列表', exact: true });
  await listbox.getByRole('option').nth(0).click({ modifiers: ['Control'] });
  await listbox.getByRole('option').nth(2).click({ modifiers: ['Shift'] });
  await expect(app.page.getByText('已选 3 项', { exact: true })).toBeVisible();
  await app.page.keyboard.press('Control+a');
  await expect(app.page.getByText('已选 200 项', { exact: true })).toBeVisible();
  pass('ctrl_shift_and_ctrl_a_select_only_loaded_200');
  await app.page.getByRole('listbox').getByRole('option').first().focus();
  await app.page.keyboard.press('Control+End');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 10000' })).toBeVisible({ timeout: 30000 });
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 10000' })).toBeFocused();
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 10000' })).toHaveAttribute('aria-posinset', '10001');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 10000' })).toHaveAttribute('aria-setsize', '10001');
  await expect(app.page.getByText('已选 200 项', { exact: true })).toBeVisible();
  ensure(await app.page.getByRole('listbox').getByRole('option').count() < 100, 'LIST_NOT_VIRTUALIZED');
  pass('keyboard_reaches_10001st_list_item_with_virtual_rows');
  await app.page.keyboard.press('Control+a');
  await expect(app.page.getByText('已选 10001 项', { exact: true })).toBeVisible();
  pass('ctrl_a_selects_all_10001_after_loading_all_pages');
  await screenshot('list-last-item');

  stage = 'native-search-last';
  await app.page.locator('#library-search').fill('R03 分页');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 00000' })).toBeVisible();
  await expect(app.page.getByRole('listbox').getByRole('option', { selected: true })).toHaveCount(0);
  await expect(app.page.getByText('范围已改变，已清除多选。')).toBeVisible();
  pass('query_change_clears_selection_with_visible_notice');
  await app.page.getByRole('listbox').getByRole('option').first().focus();
  await app.page.keyboard.press('Control+End');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 分页 10000' })).toBeVisible({ timeout: 30000 });
  ensure(await app.page.getByRole('listbox').getByRole('option').count() < 100, 'SEARCH_NOT_VIRTUALIZED');
  pass('search_results_beyond_200_reachable_by_keyboard');
  await screenshot('search-last-item');

  stage = 'deep-path-empty-folder';
  await app.page.locator('#library-search').fill('中文深层 17');
  await app.page.getByRole('listbox').getByRole('option').filter({ hasText: '中文深层 17' }).dblclick();
  await expect(app.page.getByRole('navigation', { name: '当前目录' }).getByRole('button', { name: /中文深层 17/ })).toHaveAttribute('aria-current', 'location');
  await expect(app.page.getByRole('navigation', { name: '当前目录' }).getByRole('button', { name: /中文深层 17/ })).toBeInViewport();
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 深层末项' })).toBeVisible();
  ensure(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'DEEP_PATH_OVERFLOW');
  await screenshot('deep-chinese-path');
  await app.page.locator('#library-search').fill('R03 空目录');
  await app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 空目录' }).dblclick();
  await expect(app.page.getByText('当前只读，连接 Chrome 后可新建。', { exact: true })).toBeVisible();
  await expect(app.page.getByRole('button', { name: '新建', exact: true })).toBeDisabled();
  pass('native_deep_path_and_readonly_empty_folder');

  stage = 'mirror-pagination';
  const mirrorRoot = join(report.isolationRoot, 'synthetic-file');
  await mkdir(join(mirrorRoot, 'Default'), { recursive: true });
  await writeFile(join(mirrorRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'R03 合成镜像' } } } }));
  const content = JSON.stringify({ version: 1, checksum: 'synthetic', roots: {
    bookmark_bar: { id: '1', name: 'R03 镜像目录', type: 'folder', children: Array.from({ length: 10001 }, (_, index) => ({ id: String(index + 10), name: `R03 镜像 ${String(index).padStart(5, '0')}`, type: 'url', url: `https://example.invalid/mirror/${index}` })) },
    other: { id: '2', name: '其他', type: 'folder', children: [] },
    synced: { id: '3', name: '移动', type: 'folder', children: [] },
  } });
  const bookmarksFile = join(mirrorRoot, 'Default', 'Bookmarks');
  await writeFile(bookmarksFile, content);
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
  if (!await app.page.locator('#user-data-path').isVisible()) await app.page.getByText('选择只读文件目录', { exact: true }).click();
  await app.page.locator('#user-data-path').fill(mirrorRoot);
  await app.page.getByRole('button', { name: '枚举资料', exact: true }).click();
  await app.page.getByRole('button', { name: '接入只读镜像', exact: true }).click();
  await app.page.getByRole('button', { name: '浏览缓存', exact: true }).click();
  stage = 'mirror-list-last';
  await app.page.getByRole('treeitem').filter({ hasText: 'R03 镜像目录' }).click();
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 镜像 00000' })).toBeVisible();
  await app.page.getByRole('listbox').getByRole('option').first().focus();
  await app.page.keyboard.press('Control+End');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 镜像 10000' })).toBeVisible({ timeout: 30000 });
  pass('readonly_mirror_10001_list_items_reachable');
  stage = 'mirror-search-last';
  await app.page.locator('#library-search').fill('R03 镜像');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 镜像 00000' })).toBeVisible();
  await app.page.getByRole('listbox').getByRole('option').first().focus();
  await expect(app.page.getByRole('listbox').getByRole('option').first()).toBeFocused();
  await app.page.keyboard.press('Control+End');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 镜像 10000' })).toBeVisible({ timeout: 30000 });
  await expect(app.page.locator('.connection')).toContainText('只读');
  ensure(await app.page.getByRole('listbox').getByRole('option').count() < 100, 'MIRROR_NOT_VIRTUALIZED');
  ensure(await readFile(bookmarksFile, 'utf8') === content, 'MIRROR_FILE_CHANGED');
  pass('readonly_mirror_10001_list_and_search_items_reachable');
  await screenshot('mirror-last-item');
  await app.resize(640, 480);
  await expect(app.page.locator('#library-search')).toBeInViewport();
  await expect(app.page.getByRole('button', { name: '筛选', exact: true })).toBeInViewport();
  ensure(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'SMALL_WINDOW_OVERFLOW');
  await screenshot('mirror-small-window');
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (app) report.failureDiagnostics = await app.page.evaluate(() => ({ activeRole: document.activeElement?.getAttribute('role'), activeId: document.activeElement?.id, status: document.querySelector('.library-result-count')?.textContent, visibleOptions: document.querySelectorAll('[role="listbox"] [role="option"]').length })).catch(() => null);
  if (app) await screenshot(`failure-${stage}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-browse-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, failedStage: report.failedStage, failureCode: report.failureCode, controls: report.controls.length }));
}
