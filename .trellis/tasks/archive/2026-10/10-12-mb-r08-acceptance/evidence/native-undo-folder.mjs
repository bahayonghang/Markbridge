// Targeted real-native regression after the precommit folder-undo safety fix.
// Product actions use the UI; IPC reads and Chrome APIs independently verify them.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';

const runId = randomUUID().slice(0, 8);
const oldBuild = '804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910';
const report = { runId, startedAt: new Date().toISOString(), scope: 'Targeted folder-create conditional undo on a fresh isolated native app and actual temporary Chrome; no mocked IPC', controls: [], errors: [], priorBuildSha256: oldBuild, reusedEvidence: 'Performance, DPI, preview permissions and broader daily evidence belong to the earlier 804d build and unchanged layers; they were not rerun on this binary.' };
let app, chrome, profileId, parentId, stage = 'prepare';
const pass = (control, facts = {}) => { report.controls.push({ control, status: 'PASS', ...facts }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const operations = async () => (await app.invoke('list_operations', { profileId })).operations;
const profile = async () => (await app.invoke('get_bridge_state')).profiles.find(item => item.profileId === profileId);
const tree = () => chrome.evaluate('chrome.bookmarks.getTree()');
const semantic = nodes => nodes.map(node => ({ id: node.id, parentId: node.parentId ?? null, index: node.index ?? null, title: node.title, url: node.url ?? null, children: semantic(node.children ?? []) }));
const readPreview = async operationId => app.invoke('preview_undo', { profileId, operationId, expectedRevision: (await profile()).revision });
const undoRegion = () => app.page.getByRole('region', { name: '撤销预览', exact: true });
async function screenshot(name) {
  const directory = join(evidence, 'native-screenshots');
  await mkdir(directory, { recursive: true });
  await app.page.screenshot({ path: join(directory, `${runId}-undo-folder-${name}.png`) });
}
async function createFolder(title) {
  const before = new Set((await operations()).map(item => item.operationId));
  await app.page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '书签', exact: true }).click();
  const close = app.page.getByRole('button', { name: '关闭详情，返回列表', exact: true });
  if (await close.isVisible()) await close.click();
  await app.page.locator('#library-search').fill('R08 撤销安全目录');
  await app.page.getByRole('listbox', { name: '搜索结果', exact: true }).getByRole('option').filter({ hasText: 'R08 撤销安全目录' }).dblclick();
  await app.page.getByRole('button', { name: '新建', exact: true }).click();
  await app.page.locator('[aria-label="新建类型"]').getByRole('button', { name: '文件夹', exact: true }).click();
  await app.page.locator('#edit-title').fill(title);
  await app.page.getByRole('button', { name: '预览新文件夹', exact: true }).click();
  const dialog = app.page.getByRole('dialog', { name: '确认变更', exact: true });
  await expect(dialog).toContainText(title);
  await dialog.getByRole('button', { name: '确认变更', exact: true }).click();
  const folder = await until(async () => (await chrome.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(parentId)})`)).find(item => item.title === title), 'CREATED_FOLDER_NOT_OBSERVED');
  const operation = await until(async () => (await operations()).find(item => !before.has(item.operationId) && item.kind === 'create' && item.state === 'applied'), 'CREATE_RECEIPT_NOT_APPLIED');
  const detail = await app.invoke('operation_detail', { profileId, operationId: operation.operationId });
  ensure(detail.steps.some(step => step.mutation.kind === 'create' && step.receipt?.after?.chromeId === folder.id), 'CREATE_RECEIPT_WRONG_FOLDER');
  return { folder, operation };
}
async function openUndo(title) {
  await app.page.getByRole('navigation', { name: '更多工作区', exact: true }).getByRole('button', { name: '操作历史', exact: true }).click();
  // Only the latest create remains undoable: the prior empty-folder create was undone.
  const record = app.page.getByRole('list', { name: '操作记录', exact: true }).locator(':scope > li').filter({ has: app.page.locator('.history-summary').filter({ hasText: '新建' }) }).first();
  await record.getByRole('button', { name: '撤销此记录', exact: true }).click();
  await expect(record.getByRole('region', { name: '操作详情', exact: true })).toContainText(title);
  await expect(undoRegion()).toBeVisible();
}
try {
  report.environment = await environment();
  const expected = process.env.MARKBRIDGE_EXPECTED_EXE_SHA256?.toLowerCase();
  ensure(/^[a-f0-9]{64}$/.test(expected ?? '') && expected !== oldBuild && report.environment.exeSha256 === expected, 'NEW_BUILD_HASH_REQUIRED');
  report.isolationRoot = await fixtureRoot();
  app = await launch(report.isolationRoot); report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  await app.resize(1100, 760);
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-undo')); report.chrome = chrome.version;
  parentId = await chrome.evaluate(`(async () => { const roots = await chrome.bookmarks.getTree(); const bar = roots[0].children.find(item => item.folderType === 'bookmarks-bar'); return (await chrome.bookmarks.create({ parentId: bar.id, title: 'R08 撤销安全目录' })).id; })()`);
  profileId = await pair(app, chrome, 'R08 文件夹撤销回归');

  stage = 'empty-folder-undo';
  const emptyBaseline = semantic(await tree());
  const empty = await createFolder('R08 正常空文件夹');
  await openUndo(empty.folder.title);
  const emptyPreview = await readPreview(empty.operation.operationId);
  ensure(emptyPreview.errorCode === null && emptyPreview.affected === 1 && emptyPreview.steps.length === 1, 'EMPTY_UNDO_PREVIEW_INVALID');
  ensure(emptyPreview.steps[0].payload.kind === 'delete' && emptyPreview.steps[0].expectedSubtree?.length === 1 && emptyPreview.steps[0].expectedSubtree[0].chromeId === empty.folder.id, 'EMPTY_UNDO_SUBTREE_GUARD_MISSING');
  report.emptyPreview = emptyPreview;
  const beforeUndo = new Set((await operations()).map(item => item.operationId));
  await undoRegion().getByRole('button', { name: '确认条件撤销', exact: true }).click();
  const undo = await until(async () => (await operations()).find(item => !beforeUndo.has(item.operationId) && item.kind === 'undo' && item.state === 'rolled_back'), 'EMPTY_UNDO_RECEIPT_NOT_CONFIRMED');
  const undoDetail = await app.invoke('operation_detail', { profileId, operationId: undo.operationId });
  ensure(undoDetail.undoOf === empty.operation.operationId, 'EMPTY_UNDO_WRONG_OPERATION');
  await until(async () => JSON.stringify(semantic(await tree())) === JSON.stringify(emptyBaseline), 'EMPTY_UNDO_DID_NOT_RESTORE_TREE');
  await screenshot('empty-restored');
  pass('empty_created_folder_undo_keeps_single_node_subtree_guard_and_restores_tree', { originalOperationId: empty.operation.operationId, undoOperationId: undo.operationId, receipt: undo.state });

  stage = 'externally-populated-folder-preview';
  const occupied = await createFolder('R08 外部内容须保留');
  const external = await chrome.evaluate(`(async () => { const folder = await chrome.bookmarks.create({ parentId: ${JSON.stringify(occupied.folder.id)}, title: '外部新增子目录' }); const bookmark = await chrome.bookmarks.create({ parentId: folder.id, title: '外部新增书签', url: 'https://example.invalid/undo-preserve' }); return { folderId: folder.id, bookmarkId: bookmark.id }; })()`);
  await until(async () => { const value = await app.invoke('cache_tree', { profileId, folderId: null, depth: 0 }); return value.nodes.some(item => item.chromeId === external.bookmarkId && item.parentId === external.folderId); }, 'EXTERNAL_DESCENDANTS_NOT_MIRRORED');
  const protectedTree = await tree();
  await openUndo(occupied.folder.title);
  const conflictPreview = await readPreview(occupied.operation.operationId);
  ensure(conflictPreview.errorCode === 'CONFLICT' && conflictPreview.affected === 0 && conflictPreview.steps.length === 0 && conflictPreview.conflicts.some(item => item.chromeId === occupied.folder.id && item.field === 'existence'), 'POPULATED_FOLDER_NOT_CONFLICT');
  report.conflictPreview = conflictPreview;
  await expect(undoRegion()).toContainText('冲突');
  await screenshot('external-content-conflict');
  const beforeCancel = await operations();
  await undoRegion().getByRole('button', { name: '取消撤销', exact: true }).click();
  ensure(JSON.stringify(await operations()) === JSON.stringify(beforeCancel), 'CANCEL_CHANGED_OPERATIONS');
  ensure(JSON.stringify(await tree()) === JSON.stringify(protectedTree), 'CANCEL_CHANGED_CHROME_TREE');
  pass('external_descendants_make_undo_preview_conflict_and_cancelling_changes_nothing', { originalOperationId: occupied.operation.operationId, external, steps: conflictPreview.steps.length, affected: conflictPreview.affected });

  stage = 'confirm-conflicting-undo';
  await openUndo(occupied.folder.title);
  await undoRegion().getByRole('button', { name: '确认条件撤销', exact: true }).click();
  const conflictReceipt = await until(async () => (await operations()).find(item => item.operationId === occupied.operation.operationId && item.state === 'rollback_conflict'), 'CONFLICT_CONFIRM_RECEIPT_MISSING');
  const finalTree = await tree();
  ensure(JSON.stringify(finalTree) === JSON.stringify(protectedTree), 'CONFLICT_CONFIRM_REMOVED_EXTERNAL_CONTENT');
  const finalDetail = await app.invoke('operation_detail', { profileId, operationId: occupied.operation.operationId });
  ensure(finalDetail.summary.state === 'rollback_conflict' && finalDetail.summary.conflicts.some(item => item.chromeId === occupied.folder.id && item.field === 'existence'), 'CONFLICT_DETAIL_INVALID');
  report.conflictReceipt = { state: conflictReceipt.state, errorCode: conflictReceipt.errorCode, conflicts: conflictReceipt.conflicts, operationCountBefore: beforeCancel.length, operationCountAfter: (await operations()).length, rawTreeUnchanged: true, semanticTreeUnchanged: JSON.stringify(semantic(finalTree)) === JSON.stringify(semantic(protectedTree)) };
  await screenshot('confirmed-conflict-preserved');
  pass('confirmed_conflicting_undo_records_rollback_conflict_and_preserves_actual_entire_chrome_tree', report.conflictReceipt);
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.raceCoverage = 'Post-planning child-insertion race is covered by the targeted extension executor regression, not injected in this native run.';
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  const message = typeof error?.message === 'string' ? error.message : String(error);
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(message) ? message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  report.assertion = message.slice(0, 1800);
  if (app) await screenshot(`failure-${stage}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) { try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; } }
  if (chrome) await chrome.close();
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-undo-folder-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode }));
}
