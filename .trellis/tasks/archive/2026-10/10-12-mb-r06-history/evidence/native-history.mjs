// History and conditional undo through actual UI/IPC and disposable Chrome APIs.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, workerRuntime, until, ensure } from './native-driver.mjs';
import { installMoveFault, faultCounts, releaseMove, clearMoveFault } from './native-faults.mjs';
const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), controls: [], errors: [] };
let app, chrome, worker, profileId, fixture, stage = 'prepare';
const pass = (control, detail = {}) => { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const profile = async () => (await app.invoke('get_bridge_state')).profiles.find(item => item.profileId === profileId);
const operations = async () => (await app.invoke('list_operations', { profileId })).operations;
const children = id => chrome.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(id)})`);
const semanticTree = () => chrome.evaluate('(async()=>{function clean(n){return {title:n.title,url:n.url??null,children:(n.children??[]).map(clean)};}return (await chrome.bookmarks.getTree()).map(clean);})()');
const undoReview = () => app.page.getByRole('region', { name: '撤销预览', exact: true });
async function screenshot(name) {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) });
}
async function row(operationId) {
  const entries = await operations();
  const index = entries.findIndex(item => item.operationId === operationId);
  ensure(index >= 0, 'HISTORY_ROW_MISSING');
  return app.page.getByRole('list', { name: '操作记录', exact: true }).locator(':scope > li').nth(index);
}
async function refresh() {
  await app.page.getByRole('button', { name: '重新查询回执', exact: true }).click();
  await expect(app.page.getByRole('list', { name: '操作记录', exact: true }).locator(':scope > li')).toHaveCount((await operations()).length);
}
async function undo(operationId, expectedSteps) {
  await refresh();
  await (await row(operationId)).getByRole('button', { name: '撤销此记录', exact: true }).click();
  await expect(undoReview()).toBeVisible();
  await expect(undoReview().getByRole('list', { name: '完整撤销差异', exact: true }).locator(':scope > li')).toHaveCount(expectedSteps);
}
async function batch(ids, action) {
  const preview = await app.invoke('preview_batch_edit', { profileId, expectedRevision: (await profile()).revision, chromeIds: ids, action });
  const result = await app.invoke('apply_batch_edit', { profileId, planId: preview.planId, planHash: preview.planHash, secondConfirm: true });
  return result.operationId;
}
async function terminal(operationId, state) {
  return until(async () => { const item = (await operations()).find(item => item.operationId === operationId); return item?.state === state ? item : null; }, 'OPERATION_NOT_TERMINAL');
}
async function confirmedUndoOf(operationId) {
  return until(async () => {
    for (const item of await operations()) {
      if (item.kind !== 'undo') continue;
      const detail = await app.invoke('operation_detail', { profileId, operationId: item.operationId });
      if (detail.undoOf === operationId && ['rolled_back', 'rollback_conflict'].includes(detail.summary.state)) return detail;
    }
    return null;
  }, 'UNDO_NOT_CONFIRMED');
}
try {
  report.environment = await environment(); report.isolationRoot = await fixtureRoot();
  app = await launch(report.isolationRoot); report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  await app.resize(1100, 760);
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-history')); report.chrome = chrome.version;
  fixture = await chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');const source=await chrome.bookmarks.create({parentId:bar.id,title:'R06 工作目录'});const target=await chrome.bookmarks.create({parentId:bar.id,title:'R06 目标目录'});const nested=await chrome.bookmarks.create({parentId:source.id,title:'R06 嵌套目录'});const leaf=await chrome.bookmarks.create({parentId:nested.id,title:'R06 删除后恢复',url:'https://example.invalid/r06/leaf'});const ids=[];for(let i=0;i<6;i++)ids.push((await chrome.bookmarks.create({parentId:source.id,title:'R06 条目 '+i,url:'https://example.invalid/r06/'+i})).id);return {source:source.id,target:target.id,nested:nested.id,leaf:leaf.id,ids};})()`);
  profileId = await pair(app, chrome, 'R06 历史资料'); worker = await workerRuntime(chrome);
  await app.invoke('tag_command', { profileId, command: { kind: 'set_note', chromeIds: [fixture.leaf], note: 'R06 恢复备注' } });
  const tagsBefore = await app.invoke('tag_state', { profileId, chromeIds: [fixture.leaf], filterTagId: null });
  const bookmarkId = tagsBefore.entries[0].bookmarkId;
  const beforeDelete = await semanticTree();
  const deletion = await batch([fixture.nested, fixture.leaf, fixture.ids[1]], { kind: 'delete' });
  await terminal(deletion, 'applied');
  stage = 'independent-history';
  await app.page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(app.page.getByRole('region', { name: '操作历史记录', exact: true })).toBeVisible();
  await refresh();
  await expect((await row(deletion)).locator('.history-summary')).toContainText('批量删除');
  await expect((await row(deletion)).locator('.history-summary')).toContainText('已完成');
  await (await row(deletion)).locator('.history-summary').click();
  await (await row(deletion)).locator('.history-differences > summary').click();
  await expect((await row(deletion)).getByRole('region', { name: '操作详情', exact: true })).toContainText('R06 嵌套目录');
  pass('history_reached_without_selected_bookmark_and_displays_types_times_counts_and_values');

  stage = 'cancel-undo';
  await undo(deletion, 3);
  const afterDelete = await semanticTree();
  await undoReview().getByRole('button', { name: '取消撤销', exact: true }).click();
  ensure(JSON.stringify(await semanticTree()) === JSON.stringify(afterDelete), 'CANCEL_UNDO_CHANGED_CHROME');
  pass('complete_delete_undo_preview_cancel_has_zero_effects');

  stage = 'delete-undo';
  await undo(deletion, 3);
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
    await app.resize(width, height);
    ensure(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'HISTORY_HORIZONTAL_OVERFLOW');
    await undoReview().getByRole('button', { name: '确认条件撤销', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(`undo-${width}x${height}`);
  }
  await undoReview().getByRole('button', { name: '确认条件撤销', exact: true }).click();
  const restored = await confirmedUndoOf(deletion);
  ensure(JSON.stringify(await semanticTree()) === JSON.stringify(beforeDelete), 'RESTORED_TREE_OR_ORDER_MISMATCH');
  const map = restored.restored.find(item => item.oldChromeId === fixture.leaf);
  ensure(map && map.newChromeId !== fixture.leaf && map.bookmarkId === bookmarkId, 'RESTORED_IDENTITY_MAP_MISSING');
  const tagsAfter = await app.invoke('tag_state', { profileId, chromeIds: [map.newChromeId], filterTagId: null });
  ensure(tagsAfter.entries[0].note === 'R06 恢复备注' && tagsAfter.entries[0].bookmarkId !== bookmarkId, 'RESTORED_LOCAL_NOTE_OR_IDENTITY_MISSING');
  report.restoredIdentity = { oldBookmarkId: bookmarkId, currentBookmarkId: tagsAfter.entries[0].bookmarkId, oldChromeId: fixture.leaf, newChromeId: map.newChromeId };
  await refresh();
  await (await row(restored.summary.operationId)).locator('.history-summary').click();
  await (await row(restored.summary.operationId)).locator('.history-diagnostics > summary').click();
  await expect((await row(restored.summary.operationId))).toContainText(`${fixture.leaf} → ${map.newChromeId}`);
  pass('ui_delete_undo_restores_tree_sparse_sibling_order_and_local_note_with_traceable_ids', { restoredCount: restored.restored.length, state: restored.summary.state });

  stage = 'external-conflict';
  const action = { kind: 'update', chromeId: fixture.ids[0], title: 'R06 应用改名', url: null };
  const revision = (await profile()).revision;
  const update = await app.invoke('apply_edit', { profileId, expectedRevision: revision, action, secondConfirm: false });
  await terminal(update.operationId, 'applied');
  const updatedRevision = (await profile()).revision;
  await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(fixture.ids[0])},{title:'R06 必须保留的外部标题'})`);
  await until(async () => (await profile()).revision > updatedRevision, 'EXTERNAL_UPDATE_NOT_MIRRORED');
  await undo(update.operationId, 0);
  await expect(undoReview()).toContainText('冲突');
  await undoReview().getByRole('button', { name: '确认条件撤销', exact: true }).click();
  // A wholly conflicting no-op is recorded on the original operation by the existing engine.
  await terminal(update.operationId, 'rollback_conflict');
  const conflict = await app.invoke('operation_detail', { profileId, operationId: update.operationId });
  ensure(conflict.summary.state === 'rollback_conflict', 'CONFLICT_REPORTED_AS_SUCCESS');
  ensure((await chrome.evaluate(`chrome.bookmarks.get(${JSON.stringify(fixture.ids[0])})`))[0].title === 'R06 必须保留的外部标题', 'UNDO_OVERWROTE_EXTERNAL_VALUE');
  await refresh();
  const conflictSummary = (await row(conflict.summary.operationId)).locator('.history-summary');
  if (await conflictSummary.getAttribute('aria-expanded') !== 'true') await conflictSummary.click();
  await (await row(conflict.summary.operationId)).getByRole('button', { name: '标记已核对', exact: true }).click();
  await until(async () => (await operations()).find(item => item.operationId === conflict.summary.operationId)?.reviewed, 'CONFLICT_REVIEW_NOT_PERSISTED');
  ensure((await operations()).find(item => item.operationId === conflict.summary.operationId).state === 'rollback_conflict', 'REVIEW_REWROTE_ORIGINAL_RESULT');
  pass('external_change_conflict_preserves_chrome_value_and_truthful_history_state');

  stage = 'partial-batch';
  const partialOrder = (await children(fixture.source)).map(item => item.id);
  await installMoveFault(worker, 'pause_before', 2);
  const movedIds = fixture.ids.slice(2, 6);
  const partial = await batch(movedIds, { kind: 'move', parentId: fixture.target });
  await until(async () => (await faultCounts(worker))?.hit, 'MOVE_FAULT_NOT_REACHED');
  await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(movedIds[2])},{title:'R06 批次外部冲突'})`);
  await releaseMove(worker);
  await terminal(partial, 'partial'); await clearMoveFault(worker);
  const partialReceipt = await app.invoke('get_batch_edit', { profileId, operationId: partial });
  ensure(partialReceipt.items.filter(item => item.state === 'applied').length === 2 && partialReceipt.items.filter(item => item.state === 'conflict').length === 1 && partialReceipt.items.filter(item => item.state === 'not_executed').length === 1, 'PARTIAL_RECEIPTS_MISMATCH');
  await undo(partial, 2);
  await expect(undoReview().getByRole('button', { name: '确认条件撤销', exact: true })).toBeDisabled();
  ensure((await children(fixture.target)).length === 2, 'PARTIAL_TREE_DISAGREES_WITH_RECEIPTS');
  await undoReview().getByRole('button', { name: '取消撤销', exact: true }).click();
  await (await row(partial)).getByRole('button', { name: '标记已核对', exact: true }).click();
  await until(async () => (await operations()).find(item => item.operationId === partial)?.reviewed, 'PARTIAL_REVIEW_NOT_PERSISTED');
  ensure((await operations()).find(item => item.operationId === partial).state === 'partial', 'PARTIAL_REVIEW_REWROTE_RESULT');
  await undo(partial, 2);
  await screenshot('partial-recovery');
  await undoReview().getByRole('button', { name: '确认条件撤销', exact: true }).click();
  const partialUndo = await confirmedUndoOf(partial);
  ensure((await children(fixture.target)).length === 0, 'PARTIAL_UNDO_DID_NOT_RESTORE_CONFIRMED_MOVES');
  const source = await children(fixture.source);
  ensure(JSON.stringify(source.map(item => item.id)) === JSON.stringify(partialOrder), 'PARTIAL_UNDO_CHANGED_SIBLING_ORDER');
  ensure(source.find(item => item.id === movedIds[2]).title === 'R06 批次外部冲突' && source.some(item => item.id === movedIds[3]), 'PARTIAL_UNDO_CHANGED_UNEXECUTED_ITEMS');
  ensure(partialUndo.steps.length === 2, 'PARTIAL_UNDO_INCLUDED_UNCONFIRMED_STEPS');
  pass('partial_batch_history_recovers_only_confirmed_steps_preserving_external_and_unexecuted_items', { original: partialReceipt.state, undoSteps: partialUndo.steps.length });

  stage = 'offline';
  await worker.close(); worker = null; await chrome.close(); chrome = null;
  await until(async () => (await profile()).connection !== 'live', 'SOURCE_NOT_OFFLINE');
  await refresh();
  await expect(app.page.getByRole('region', { name: '操作历史记录', exact: true })).toContainText('当前只读');
  const buttons = app.page.getByRole('button', { name: '撤销此记录', exact: true });
  for (let i = 0; i < await buttons.count(); i++) await expect(buttons.nth(i)).toBeDisabled();
  await app.page.getByRole('button', { name: '备份导出', exact: true }).click();
  await expect(app.page.getByRole('region', { name: '备份导出', exact: true })).toBeVisible();
  pass('offline_history_remains_readable_undo_disabled_and_export_entry_available');
  ensure(report.errors.length === 0, 'PAGE_ERRORS'); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (stage !== 'prepare' && report.failureCode === 'NATIVE_ASSERTION_OR_ACTION_FAILED') report.assertion = String(error.message).slice(0, 1400);
  if (app) await screenshot('failure').catch(() => {}); process.exitCode = 1;
} finally {
  if (worker) { await clearMoveFault(worker).catch(() => {}); await worker.close().catch(() => {}); }
  if (app) { try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; } }
  if (chrome) await chrome.close(); if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-history-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
