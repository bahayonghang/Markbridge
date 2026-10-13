// Actual Tauri IPC and actual Chrome APIs; all data belongs to disposable profiles.
import { writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, workerRuntime, cleanCredentials, until, ensure } from './native-driver.mjs';
import { installMoveFault, faultCounts, releaseMove, clearMoveFault } from './native-faults.mjs';

const mode = process.argv[2] ?? 'normal';
ensure(['normal', 'disconnect_before', 'drop_ack', 'pause_before', 'external_conflict'].includes(mode), 'INVALID_MODE');
const runId = randomUUID().slice(0, 8);
const report = { runId, mode, startedAt: new Date().toISOString(), controls: [], errors: [], scope: 'Actual Tauri + disposable Chrome; synthetic daily batch CRUD and failure boundaries' };
let app, chrome, worker, profileId, fixture;
let stage = 'prepare';
function pass(control, detail = {}) { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); }
const state = () => app.invoke('get_bridge_state');
const revision = async () => (await state()).profiles.find(profile => profile.profileId === profileId).revision;
const preview = async (chromeIds, action, capture = false) => app.invoke('preview_batch_edit', { profileId, expectedRevision: await revision(), chromeIds, action }, capture);
const apply = (plan, capture = false, patch = {}) => app.invoke('apply_batch_edit', { profileId, planId: plan.planId, planHash: plan.planHash, secondConfirm: true, ...patch }, capture);
const status = operationId => app.invoke('get_batch_edit', { profileId, operationId });
const children = id => chrome.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(id)})`);
const semanticTree = () => chrome.evaluate('(async()=>{function clean(n){return {title:n.title,url:n.url??null,children:(n.children??[]).map(clean)};}return (await chrome.bookmarks.getTree()).map(clean);})()');
const compact = result => ({ state: result.state, stopped: result.stopped, errorCode: result.errorCode, counts: Object.fromEntries(['applied', 'not_executed', 'in_flight', 'conflict', 'uncertain'].map(kind => [kind, result.items.filter(item => item.state === kind).length])) });
async function mirrorSettled() {
  const expected = await chrome.evaluate('(async()=>{let n=0;function visit(x){n++;for(const c of x.children??[])visit(c);}for(const x of await chrome.bookmarks.getTree())visit(x);return n;})()');
  await until(async () => {
    const result = await app.invoke('cache_query', { profileId, request: { folderId: null, folderScope: 'all', query: '', tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null } });
    return result.total === expected;
  }, 'MIRROR_NOT_SETTLED');
}
async function finalStatus(operationId, predicate) { return until(async () => { const result = await status(operationId); return predicate(result) ? result : null; }, 'BATCH_NOT_TERMINAL', 45000); }
try {
  report.environment = await environment();
  report.isolationRoot = await fixtureRoot();
  app = await launch(report.isolationRoot);
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  report.webview = app.webview;
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-live'));
  report.chrome = chrome.version;
  fixture = await chrome.evaluate(`(async()=>{
    const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');
    const source=await chrome.bookmarks.create({parentId:bar.id,title:'R04 来源'});
    const target=await chrome.bookmarks.create({parentId:bar.id,title:'R04 目标'});
    const nested=await chrome.bookmarks.create({parentId:source.id,title:'R04 子目录'});
    const leaf=await chrome.bookmarks.create({parentId:nested.id,title:'R04 子条目',url:'https://example.invalid/r04/nested'});
    const ids=[];for(let i=0;i<60;i++){const n=await chrome.bookmarks.create({parentId:source.id,title:'R04 ITEM '+String(i).padStart(3,'0'),url:'https://example.invalid/r04/'+i});ids.push(n.id);}
    return {bar:bar.id,source:source.id,target:target.id,nested:nested.id,leaf:leaf.id,ids};
  })()`);
  profileId = await pair(app, chrome);
  worker = await workerRuntime(chrome);
  await mirrorSettled();

  if (mode === 'normal') {
    stage = 'review-contract';
    let plan = await preview([fixture.nested, fixture.leaf], { kind: 'delete' });
    ensure(plan.selectedCount === 2 && plan.items.length === 1 && plan.affected === 2, 'SUBTREE_DEDUP_FAILED');
    ensure(plan.items[0].path.includes('R04 来源') && plan.items[0].affected === 2, 'PREVIEW_MISSING_PATH_OR_COUNT');
    await delay(300);
    ensure((await children(fixture.source)).length === 61, 'PREVIEW_CHANGED_CHROME');
    pass('preview_has_scope_path_subtree_dedup_and_zero_effects');
    for (const id of ['0', fixture.bar]) {
      const rejected = await preview([id], { kind: 'delete' }, true);
      ensure(!!rejected.error, 'PROTECTED_NODE_ACCEPTED');
    }
    for (const parentId of [fixture.source, fixture.nested]) {
      const rejected = await preview([fixture.source], { kind: 'move', parentId }, true);
      ensure(!!rejected.error, 'SELF_DESCENDANT_MOVE_ACCEPTED');
    }
    const barPlan = await preview([fixture.leaf], { kind: 'move', parentId: fixture.bar });
    ensure(barPlan.writable && !!barPlan.destinationPath, 'NORMAL_BAR_DESTINATION_REJECTED');
    pass('protected_selection_and_self_descendant_rejected_normal_bar_destination_allowed');

    stage = 'identity-guards';
    plan = await preview(fixture.ids.slice(0, 2), { kind: 'move', parentId: fixture.target });
    ensure(!!(await apply(plan, true, { planHash: 'wrong-hash' })).error, 'WRONG_HASH_ACCEPTED');
    ensure(!!(await apply(plan, true, { profileId: 'different-profile' })).error, 'WRONG_PROFILE_ACCEPTED');
    const originalRevision = await revision();
    await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(fixture.ids[0])},{title:'R04 外部改名'})`);
    await until(async () => await revision() > originalRevision, 'EXTERNAL_CHANGE_NOT_MIRRORED');
    ensure(!!(await apply(plan, true)).error, 'STALE_PLAN_ACCEPTED');
    ensure((await children(fixture.target)).length === 0, 'REJECTED_PLAN_CHANGED_CHROME');
    pass('wrong_hash_cross_profile_external_revision_reject_without_effects');

    stage = 'backup-failure';
    const backupPath = join(report.isolationRoot, 'app-data', 'backups');
    await writeFile(backupPath, 'R04 owned failure fixture', { flag: 'wx' });
    plan = await preview(fixture.ids.slice(0, 2), { kind: 'move', parentId: fixture.target });
    const denied = await apply(plan, true);
    ensure(!!denied.error && (await children(fixture.target)).length === 0, 'BACKUP_FAILURE_DISPATCHED');
    await unlink(backupPath); // Exact file created above; no recursive or inferred path deletion.
    pass('backup_directory_failure_aborts_before_any_chrome_write', { error: denied.error });

    stage = 'batch-move';
    plan = await preview(fixture.ids.slice(0, 3), { kind: 'move', parentId: fixture.target });
    const started = await apply(plan);
    const moved = await finalStatus(started.operationId, result => result.state === 'applied');
    ensure(moved.items.length === 3 && moved.items.every(item => item.state === 'applied'), 'MOVE_RECEIPTS_INVALID');
    ensure(JSON.stringify((await children(fixture.target)).map(node => node.id)) === JSON.stringify(fixture.ids.slice(0, 3)), 'MOVE_ORDER_INVALID');
    ensure(!!(await apply(plan, true)).error, 'REPEATED_CONFIRM_ACCEPTED');
    ensure((await children(fixture.target)).length === 3, 'REPEATED_CONFIRM_DUPLICATED_EFFECT');
    const backupFiles = await readdir(backupPath);
    ensure(backupFiles.some(name => name.endsWith('.html')) && backupFiles.some(name => name.endsWith('.json')), 'WHOLE_BATCH_BACKUP_PAIR_MISSING');
    const html = await readFile(join(backupPath, backupFiles.find(name => name.endsWith('.html'))), 'utf8');
    ensure(html.includes('R04 ITEM 059') && html.includes('R04 子条目'), 'BACKUP_OMITTED_UNSELECTED_ITEMS');
    pass('serial_move_receipts_order_duplicate_confirm_and_whole_tree_backups', { result: compact(moved), backupFiles: backupFiles.length });

    stage = 'batch-delete';
    await mirrorSettled();
    await app.invoke('tag_command', { profileId, command: { kind: 'set_note', chromeIds: [fixture.leaf], note: 'R04 本地恢复备注' } });
    const beforeDelete = await semanticTree();
    // Sparse siblings expose undo ordering drift: selected A/C with B retained.
    plan = await preview([fixture.nested, fixture.leaf, fixture.ids[4]], { kind: 'delete' });
    ensure(plan.items.length === 2 && plan.affected === 3, 'DELETE_DEDUP_INVALID');
    const deleted = await apply(plan);
    const done = await finalStatus(deleted.operationId, result => result.state === 'applied');
    const remaining = await children(fixture.source);
    ensure(!remaining.some(node => node.id === fixture.nested || node.id === fixture.ids[4]), 'DELETE_SEMANTIC_TREE_INVALID');
    pass('batch_delete_parent_child_once_and_truthful_receipts', { result: compact(done), affected: plan.affected });

    stage = 'batch-delete-undo';
    const undoAction = { kind: 'undo', operationId: deleted.operationId };
    const undoRevision = await revision();
    const undoPreview = await app.invoke('preview_edit', { profileId, expectedRevision: undoRevision, action: undoAction });
    ensure(undoPreview.writable, 'BATCH_UNDO_NOT_WRITABLE');
    const undo = await app.invoke('apply_edit', { profileId, expectedRevision: undoRevision, action: undoAction, secondConfirm: true });
    await until(async () => (await app.invoke('list_operations', { profileId })).operations.find(row => row.operationId === undo.operationId)?.state === 'rolled_back', 'BATCH_UNDO_NOT_CONFIRMED');
    ensure(JSON.stringify(await semanticTree()) === JSON.stringify(beforeDelete), 'BATCH_UNDO_SEMANTIC_OR_ORDER_MISMATCH');
    const noteResults = await app.invoke('cache_query', { profileId, request: { folderId: null, folderScope: 'all', query: 'R04 本地恢复备注', tagIds: [], includeSummary: false, includeNote: true, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null } });
    ensure(noteResults.total === 1, 'BATCH_UNDO_LOST_LOCAL_NOTE');
    pass('batch_delete_undo_restores_semantic_tree_sibling_order_and_local_note');
  } else {
    stage = 'instrument';
    const faultMode = mode === 'external_conflict' ? 'pause_before' : mode;
    await installMoveFault(worker, faultMode, 40);
    const plan = await preview(fixture.ids, { kind: 'move', parentId: fixture.target });
    ensure(plan.items.length === 60 && plan.affected === 60, 'FAULT_PLAN_INVALID');
    const started = await apply(plan);
    await until(async () => (await faultCounts(worker))?.hit, 'FAULT_NOT_REACHED');
    stage = 'fault-boundary';
    if (mode === 'pause_before') {
      const cancelled = await app.invoke('cancel_batch_edit', { profileId, operationId: started.operationId });
      ensure(cancelled.stopped && cancelled.items[39].state === 'uncertain' && cancelled.items.slice(40).every(item => item.state === 'not_executed'), 'CANCEL_MISREPRESENTS_INFLIGHT');
      await releaseMove(worker);
    } else if (mode === 'external_conflict') {
      await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(fixture.ids[40])},{title:'R04 外部冲突'})`);
      await releaseMove(worker);
    } else if (mode === 'drop_ack') {
      // Leave the page; timeout must persist without UI polling the batch endpoint.
      await app.page.getByRole('button', { name: '设置', exact: true }).click();
      await delay(11000);
    }
    let result = await finalStatus(started.operationId, value => value.stopped && !value.items.some(item => item.state === 'in_flight'));
    await delay(700);
    let counts = await faultCounts(worker);
    let moved = (await children(fixture.target)).length;
    const expectedEffects = mode === 'disconnect_before' ? 39 : 40;
    ensure(counts.effects === expectedEffects && moved === expectedEffects, 'FAULT_EXTRA_OR_MISSING_CHROME_EFFECTS');
    ensure(counts.calls <= (mode === 'external_conflict' ? 41 : 40), 'FAULT_CONTINUED_REMAINING');
    ensure(result.items.slice(mode === 'external_conflict' ? 41 : 40).every(item => item.state === 'not_executed'), 'UNDISPATCHED_ITEMS_MISREPORTED');
    if (mode === 'drop_ack') ensure(result.items[39].state === 'uncertain', 'LOST_ACK_NOT_UNCERTAIN');
    if (mode === 'pause_before') {
      result = await finalStatus(started.operationId, value => value.items[39].state === 'applied');
      ensure(result.stopped && result.items.slice(40).every(item => item.state === 'not_executed'), 'CANCEL_RESUMED_OR_CLAIMED_ROLLBACK');
    }
    pass(`${mode}_stops_remaining_and_reports_real_effects`, { counts, moved, result: compact(result) });
    await clearMoveFault(worker);
    await until(async () => (await state()).profiles.find(profile => profile.profileId === profileId)?.connection === 'live', 'RECONNECT_NOT_LIVE');
    await app.invoke('refresh_operations', { profileId });
    await delay(900);
    result = await status(started.operationId);
    ensure((await children(fixture.target)).length === expectedEffects && result.stopped, 'REFRESH_RESUMED_REMAINING');
    if (mode === 'drop_ack') ensure(result.items[39].state === 'applied', 'LATE_RECEIPT_NOT_RECONCILED');
    pass('explicit_refresh_reconciles_without_resuming', { result: compact(result) });

    stage = 'restart-no-replay';
    const oldPort = (await state()).port;
    await app.close();
    app = await launch(report.isolationRoot);
    await app.invoke('start_bridge', { port: oldPort });
    await until(async () => (await state()).profiles.find(profile => profile.profileId === profileId)?.connection === 'live', 'RESTART_RECONNECT_FAILED');
    await delay(1000);
    result = await status(started.operationId);
    ensure((await children(fixture.target)).length === expectedEffects && result.stopped, 'RESTART_REPLAYED_REMAINING');
    pass('native_process_restart_keeps_partial_batch_frozen', { result: compact(result) });
    stage = 'history-recovery';
    await app.page.getByRole('button', { name: '操作历史', exact: true }).click();
    await app.page.locator('.edit-history li').filter({ hasText: started.operationId }).getByRole('button', { name: '查看逐项回执', exact: true }).click();
    const receiptView = app.page.getByRole('region', { name: '逐项回执', exact: true });
    await until(async () => { const text = await receiptView.textContent(); return text.includes('批次已停止') && text.includes(`已执行 ${expectedEffects} / 60 项`); }, 'HISTORY_BATCH_RESULTS_NOT_RECOVERED');
    pass('persisted_history_reopens_truthful_per_item_results_after_restart');
  }
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (worker) { try { report.faultCounts = await faultCounts(worker); } catch { /* worker may have stopped */ } }
  process.exitCode = 1;
} finally {
  if (worker) { await clearMoveFault(worker).catch(() => {}); await worker.close().catch(() => {}); }
  if (app) {
    try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; }
    catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
  }
  if (chrome) await chrome.close();
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-batch-${mode}-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, mode, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
