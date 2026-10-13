// Actual Tauri/Chrome with a synthetic loopback model; no daily browser or external model.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
import { startModelFixture } from './native-model.mjs';
const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), modelEvidence: 'Synthetic HTTP fixture, real Rust transport; real-model quality NOT_RUN', controls: [], errors: [] };
let app, chrome, model, profileId, fixture, stage = 'prepare';
const pass = (control, detail = {}) => { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const profile = async () => (await app.invoke('get_bridge_state')).profiles.find(row => row.profileId === profileId);
const operations = async () => (await app.invoke('list_operations', { profileId })).operations;
const children = id => chrome.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(id)})`);
const tree = () => chrome.evaluate('chrome.bookmarks.getTree()');
const center = () => app.page.getByRole('region', { name: '整理中心', exact: true });
const maintenance = () => center().getByRole('region', { name: '库维护', exact: true });
const organization = () => center().getByRole('region', { name: '批量整理', exact: true });
const single = () => center().getByRole('region', { name: 'AI 建议', exact: true });
async function screenshot(name) {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) });
}
async function selectTitles(titles) {
  const page = app.page;
  await page.getByRole('button', { name: '书签', exact: true }).click();
  const cancel = page.getByRole('button', { name: '取消选择', exact: true });
  if (await cancel.isVisible()) await cancel.click();
  await page.locator('#library-search').fill('R07');
  const list = page.getByRole('listbox', { name: '搜索结果', exact: true });
  for (const title of titles) await list.getByRole('checkbox', { name: `选择 ${title}`, exact: true }).check();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await center().getByRole('radio', { name: /^当前选择/ }).check();
  await center().getByRole('button', { name: '使用当前选择', exact: true }).click();
}
async function terminal(kind) {
  return until(async () => (await operations()).find(row => (!kind || row.kind === kind) && row.state === 'applied'), 'OPERATION_NOT_APPLIED');
}
try {
  report.environment = await environment(); report.isolationRoot = await fixtureRoot();
  model = await startModelFixture();
  app = await launch(report.isolationRoot); report.webview = app.webview;
  await app.resize(1100, 760);
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-organize')); report.chrome = chrome.version;
  fixture = await chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');const source=await chrome.bookmarks.create({parentId:bar.id,title:'R07 工作目录'});const keeper=await chrome.bookmarks.create({parentId:source.id,title:'R07 重复保留',url:'https://example.invalid/r07/same?q=1#same'});const duplicate=await chrome.bookmarks.create({parentId:source.id,title:'R07 重复移除',url:'https://example.invalid/r07/same?q=1#same'});const other=await chrome.bookmarks.create({parentId:source.id,title:'R07 独立条目',url:'https://example.invalid/r07/other'});const blocked=await chrome.bookmarks.create({parentId:source.id,title:'R07 私网不可探测',url:${JSON.stringify(model.endpoint + '/private')}});const outside=await chrome.bookmarks.create({parentId:bar.id,title:'R07 范围之外',url:'https://example.invalid/r07/same?q=1#same'});const nested=await chrome.bookmarks.create({parentId:source.id,title:'R07 子目录'});await chrome.bookmarks.create({parentId:nested.id,title:'R07 子目录条目',url:'https://example.invalid/r07/nested'});return {bar:bar.id,source:source.id,keeper:keeper.id,duplicate:duplicate.id,other:other.id,blocked:blocked.id,outside:outside.id};})()`);
  profileId = await pair(app, chrome, 'R07 整理资料');
  await app.invoke('tag_command', { profileId, command: { kind: 'set_note', chromeIds: [fixture.keeper], note: 'R07 保留项备注' } });
  await app.page.evaluate(() => {
    const fetch = window.fetch;
    window.r07Calls = [];
    const instrumented = function(input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      if (url.host === 'ipc.localhost') window.r07Calls.push(url.pathname.slice(1));
      return fetch.call(this, input, init);
    };
    window.fetch = instrumented;
    window.r07ObserverInstalled = window.fetch === instrumented;
  });
  await app.invoke('get_bridge_state');
  ensure(await app.page.evaluate(() => window.r07ObserverInstalled && window.r07Calls.includes('get_bridge_state')), 'IPC_OBSERVER_NOT_ACTIVE');
  stage = 'entry';
  await app.page.getByRole('button', { name: '整理', exact: true }).click();
  await expect(center()).toBeVisible();
  await center().getByRole('tab', { name: 'AI 文件夹', exact: true }).click();
  await center().getByRole('tab', { name: '单条建议', exact: true }).click();
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: 'AI', exact: true }).click();
  ensure(!(await app.invoke('ai_settings')).enabled, 'AI_NOT_DEFAULT_OFF');
  ensure(model.calls.length === 0 && model.pageRequests === 0, 'PAGE_ENTRY_CONTACTED_ENDPOINT');
  ensure(await app.page.evaluate(() => !window.r07Calls.some(command => ['inspect_library','check_links','propose_organization','assign_organization','suggest_ai','test_ai_connection','content_preview'].includes(command))), 'PAGE_ENTRY_STARTED_TASK');
  pass('organize_and_settings_entry_start_no_network_or_model_and_ai_defaults_off');

  stage = 'duplicates';
  await selectTitles(['R07 重复保留', 'R07 重复移除']);
  await center().getByRole('tab', { name: '重复与链接', exact: true }).click();
  await maintenance().getByRole('button', { name: '检查重复', exact: true }).click();
  await expect(maintenance().getByRole('radio')).toHaveCount(2);
  // Explicitly choose the synthetic keeper by its label, without relying on ordering.
  await maintenance().getByRole('radio', { name: /R07 重复保留/ }).check();
  const unchanged = JSON.stringify(await tree());
  await maintenance().getByRole('button', { name: '预览清理', exact: true }).click();
  await expect(maintenance()).toContainText('R07 重复移除');
  ensure(JSON.stringify(await tree()) === unchanged && (await operations()).length === 0, 'PREVIEW_WROTE_CHROME');
  await app.page.getByRole('button', { name: '书签', exact: true }).click();
  await app.page.getByRole('button', { name: '整理', exact: true }).click();
  await expect(maintenance().getByRole('button', { name: '确认清理', exact: true })).toBeEnabled();
  await screenshot('duplicate-review');
  await maintenance().getByRole('button', { name: '确认清理', exact: true }).click();
  await until(async () => !(await children(fixture.source)).some(row => row.id === fixture.duplicate), 'DUPLICATE_NOT_REMOVED');
  const cleanup = await terminal();
  ensure((await children(fixture.bar)).some(row => row.id === fixture.outside), 'OUT_OF_SCOPE_DUPLICATE_CHANGED');
  const metadata = await app.invoke('tag_state', { profileId, chromeIds: [fixture.keeper], filterTagId: null });
  ensure(metadata.entries[0].note === 'R07 保留项备注', 'KEEPER_NOTE_CHANGED');
  await center().getByRole('button', { name: '前往操作历史', exact: true }).click();
  await expect(app.page.getByRole('region', { name: '操作历史记录', exact: true })).toBeVisible();
  ensure((await operations()).some(row => row.operationId === cleanup.operationId), 'CLEANUP_HISTORY_MISSING');
  pass('explicit_duplicate_scope_preview_navigation_and_confirmed_cleanup_trace_to_history');

  stage = 'folder-scope';
  await app.page.getByRole('button', { name: '整理', exact: true }).click();
  await center().getByRole('radio', { name: '指定目录', exact: true }).check();
  await center().getByRole('combobox', { name: '整理目录', exact: true }).selectOption(fixture.source);
  await center().getByRole('button', { name: '使用此目录', exact: true }).click();
  await expect(center().locator('.scope-bar')).toContainText('4 个书签');
  await expect(center().locator('.scope-bar')).toContainText('含子目录');
  await maintenance().getByRole('button', { name: '检查重复', exact: true }).click();
  await expect(maintenance()).toContainText('没有重复候选');
  await screenshot('explicit-folder-scope');
  pass('explicit_folder_scope_includes_descendant_bookmarks_and_excludes_outside_duplicate');

  stage = 'links';
  await selectTitles(['R07 私网不可探测']);
  await center().getByRole('tab', { name: '重复与链接', exact: true }).click();
  await maintenance().getByRole('button', { name: '检查链接', exact: true }).click();
  const linkRows = maintenance().getByRole('list', { name: '链接检查结果', exact: true }).locator(':scope > li');
  await expect(linkRows).toHaveCount(1);
  await expect(linkRows.first()).toContainText('状态未知');
  ensure(model.pageRequests === 0, 'PUBLIC_FETCH_ALLOWED_LOOPBACK');
  pass('blocked_link_stays_unknown_and_public_fetch_never_reaches_loopback');

  stage = 'settings';
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: 'AI', exact: true }).click();
  await app.page.getByLabel('启用 AI', { exact: true }).check();
  await app.page.locator('#ai-provider').selectOption('ollama');
  await app.page.getByLabel('端点', { exact: true }).fill(model.endpoint);
  await app.page.getByLabel('模型', { exact: true }).fill('r07-synthetic-fixture');
  await app.page.getByRole('button', { name: '保存配置', exact: true }).click();
  await until(async () => (await app.invoke('ai_settings')).enabled, 'SETTINGS_NOT_SAVED');
  ensure(model.calls.length === 0, 'SAVING_CONFIG_CALLED_MODEL');

  stage = 'single-cancel';
  await selectTitles(['R07 独立条目']);
  await center().getByRole('tab', { name: '单条建议', exact: true }).click();
  await expect(single()).toContainText(model.endpoint);
  await expect(single()).toContainText('标题');
  model.hold('suggestion');
  await single().getByRole('button', { name: '生成建议', exact: true }).click();
  await until(() => model.calls.some(row => row.kind === 'suggestion'), 'SUGGESTION_NOT_REQUESTED');
  await single().getByRole('button', { name: '取消', exact: true }).click();
  await until(() => model.calls.some(row => row.kind === 'suggestion' && row.disconnected), 'SUGGESTION_CANCEL_DID_NOT_ABORT_HTTP');
  model.release();
  await expect(single().getByRole('button', { name: '确认这条建议', exact: true })).toHaveCount(0);
  ensure((await children(fixture.source)).find(row => row.id === fixture.other).title === 'R07 独立条目', 'CANCELLED_SUGGESTION_WROTE');
  pass('single_generation_discloses_endpoint_and_data_and_cancel_aborts_real_http');

  stage = 'single-apply';
  await single().getByRole('button', { name: '生成建议', exact: true }).click();
  await expect(single().getByLabel('建议标题', { exact: true })).toHaveValue('R07 已审查建议');
  await single().getByLabel('保存标题', { exact: true }).check();
  const beforeSuggestion = (await operations()).length;
  await single().getByRole('button', { name: '确认这条建议', exact: true }).click();
  await until(async () => (await children(fixture.source)).find(row => row.id === fixture.other).title === 'R07 已审查建议', 'CONFIRMED_TITLE_NOT_APPLIED');
  await until(async () => (await operations()).length > beforeSuggestion, 'AI_HISTORY_MISSING');
  pass('editable_single_suggestion_requires_confirmation_and_tracks_actual_chrome_write');

  stage = 'organization-cancel';
  await selectTitles(['R07 重复保留', 'R07 已审查建议']);
  await center().getByRole('tab', { name: 'AI 文件夹', exact: true }).click();
  await expect(organization()).toContainText(model.endpoint);
  model.hold('folders');
  await organization().getByRole('button', { name: '提出文件夹', exact: true }).click();
  await until(() => model.calls.some(row => row.kind === 'folders'), 'FOLDERS_NOT_REQUESTED');
  await organization().getByRole('button', { name: '取消', exact: true }).click();
  await until(() => model.calls.some(row => row.kind === 'folders' && row.disconnected), 'FOLDER_CANCEL_DID_NOT_ABORT_HTTP');
  model.release();
  pass('initial_folder_generation_cancels_before_job_response_with_real_http_abort');

  stage = 'organization-stale';
  await organization().getByRole('button', { name: '提出文件夹', exact: true }).click();
  await expect(organization().getByRole('button', { name: '确认目录', exact: true })).toBeEnabled();
  await organization().getByRole('button', { name: '确认目录', exact: true }).click();
  await organization().getByRole('button', { name: '生成分配', exact: true }).click();
  await expect(organization().getByRole('button', { name: '应用', exact: true })).toBeEnabled();
  const beforeRevision = (await profile()).revision;
  await chrome.evaluate(`chrome.bookmarks.update(${JSON.stringify(fixture.keeper)},{title:'R07 外部改动保留'})`);
  await until(async () => (await profile()).revision > beforeRevision, 'EXTERNAL_CHANGE_NOT_MIRRORED');
  const staleApply = organization().getByRole('button', { name: '应用', exact: true });
  if (await staleApply.count()) await expect(staleApply).toBeDisabled();
  await expect(center()).toContainText('变化');
  pass('external_revision_invalidates_reviewed_organization_before_apply');

  stage = 'organization-apply';
  await selectTitles(['R07 外部改动保留', 'R07 已审查建议']);
  await center().getByRole('tab', { name: 'AI 文件夹', exact: true }).click();
  await organization().getByRole('button', { name: '提出文件夹', exact: true }).click();
  await expect(organization().getByRole('button', { name: '确认目录', exact: true })).toBeEnabled();
  await organization().getByRole('button', { name: '确认目录', exact: true }).click();
  await organization().getByRole('button', { name: '生成分配', exact: true }).click();
  await expect(organization().getByRole('button', { name: '应用', exact: true })).toBeEnabled();
  const beforeOrganize = (await operations()).map(row => row.operationId);
  ensure(!(await children(fixture.source)).some(row => row.title === 'R07 阅读' || row.title === 'R07 工具'), 'UNCONFIRMED_PLAN_CREATED_FOLDERS');
  await screenshot('organization-ready');
  await organization().getByRole('button', { name: '应用', exact: true }).click();
  const organized = await until(async () => (await operations()).find(row => !beforeOrganize.includes(row.operationId) && row.state === 'applied'), 'ORGANIZATION_NOT_APPLIED');
  const folders = (await children(fixture.source)).filter(row => row.title === 'R07 阅读' || row.title === 'R07 工具');
  ensure(folders.length === 2, 'ORGANIZATION_FOLDERS_MISSING');
  const placed = (await Promise.all(folders.map(row => children(row.id)))).flat().map(row => row.id).sort();
  ensure(JSON.stringify(placed) === JSON.stringify([fixture.keeper, fixture.other].sort()), 'ORGANIZATION_SCOPE_MISMATCH');
  const detail = await app.invoke('operation_detail', { profileId, operationId: organized.operationId });
  ensure(detail.steps.every(row => row.receipt?.state === 'applied'), 'ORGANIZATION_RECEIPTS_INCOMPLETE');
  await center().getByRole('button', { name: '前往操作历史', exact: true }).click();
  await expect(app.page.getByRole('region', { name: '操作历史记录', exact: true })).toBeVisible();
  await app.page.getByRole('button', { name: '整理', exact: true }).click();
  pass('reviewed_folder_plan_applies_only_selected_items_and_remains_traceable_in_history');

  stage = 'readonly-and-sizes';
  await chrome.close(); chrome = null;
  await until(async () => (await profile()).connection !== 'live', 'PROFILE_NOT_OFFLINE');
  const offlineApply = organization().getByRole('button', { name: '应用', exact: true });
  if (await offlineApply.count()) await expect(offlineApply).toBeDisabled();
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
    await app.resize(width, height);
    (report.viewports ??= []).push(await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })));
    ensure(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'ORGANIZE_HORIZONTAL_OVERFLOW');
    await screenshot(`organize-${width}x${height}`);
  }
  pass('readonly_organization_remains_reviewable_without_browser_apply_across_five_sizes');
  report.ipcCounts = await app.page.evaluate(() => window.r07Calls.reduce((counts, command) => ({ ...counts, [command]: (counts[command] ?? 0) + 1 }), {}));
  ensure(report.ipcCounts.inspect_library > 0 && report.ipcCounts.suggest_ai > 0 && report.ipcCounts.propose_organization > 0, 'IPC_OBSERVER_NOT_ACTIVE');
  ensure(report.errors.length === 0 && model.errors.length === 0, 'NATIVE_OR_FIXTURE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  if (stage !== 'prepare') report.assertion = error.message.slice(0, 1600);
  if (app && stage !== 'prepare') await screenshot(`failure-${stage}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (model) { report.modelCalls = model.calls; report.modelFixtureErrors = model.errors; report.publicLoopbackRequests = model.pageRequests; await model.close(); }
  if (chrome) await chrome.close();
  if (app) {
    try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
    await app.close();
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-organize-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode }));
}
