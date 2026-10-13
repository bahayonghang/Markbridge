// A real extension revision change must invalidate a paged query on the native UI.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, protocolNode, until } from './native-driver.mjs';
import { launchChrome, availablePort } from '../../10-12-mb-r02-connection/evidence/native-driver.mjs';

const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), scope: 'R03 actual Tauri + one disposable Chrome profile; paged revision recovery and 10 live create/remove samples; not full B10K V03', controls: [], latencyMs: [], errors: [] };
let app, chrome;
let stage = 'prepare';
function ensure(condition, code) { if (!condition) throw new Error(code); }
function pass(control, detail = {}) { report.controls.push({ control, status: 'PASS', ...detail }); console.log(JSON.stringify({ control, status: 'PASS' })); }
async function state() { return app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_bridge_state')); }
async function query(profileId, folderId, patch = {}, captureError = false) {
  const request = { folderId, folderScope: 'children', query: '', tagIds: [], includeSummary: false, includeNote: false, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null, ...patch };
  return app.page.evaluate(({ args, captureError }) => window.__TAURI_INTERNALS__.invoke('cache_query', args).catch(error => { if (captureError) return { error }; throw error; }), { args: { profileId, request }, captureError });
}
try {
  report.environment = await environment();
  report.isolationRoot = await fixtureRoot([
    protocolNode({ chromeId: '0', parentId: null, position: 0, kind: 'folder', title: '临时缓存根', url: null }),
    protocolNode({ chromeId: '1', parentId: '0', position: 0, kind: 'folder', title: '临时缓存', url: null }),
  ]);
  app = await launch(report.isolationRoot);
  await app.page.locator('#library-search').waitFor();
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR'));
  report.webview = app.webview;
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-live'));
  report.chrome = chrome.version;
  const folder = await chrome.evaluate(`(async () => { const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(node=>node.folderType==='bookmarks-bar');return chrome.bookmarks.create({parentId:bar.id,title:'R03 在线分页'}); })()`);
  await chrome.evaluate(`(async () => { for(let start=0;start<240;start+=40) await Promise.all(Array.from({length:40},(_,i)=>chrome.bookmarks.create({parentId:${JSON.stringify(folder.id)},title:'R03 LIVE '+String(start+i).padStart(5,'0'),url:'https://example.invalid/live/'+(start+i)}))); return true; })()`);

  stage = 'pair';
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
  const portInput = app.page.locator('#bridge-port');
  if (!await portInput.isVisible()) await app.page.locator('details:has(#bridge-port)>summary').click();
  await portInput.fill(String(await availablePort()));
  await app.page.getByRole('button', { name: '启动连接', exact: true }).click();
  await until(async () => (await state()).port, 'LISTENER_NOT_READY');
  await app.page.locator('#profile-name').fill('R03 临时在线');
  await app.page.getByRole('button', { name: '生成配对串', exact: true }).click();
  let ticket = await app.page.locator('#pairing-code').inputValue();
  await chrome.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(ticket)};document.querySelector('#pair').click();true`);
  ticket = '';
  const pending = await until(async () => (await state()).pending.find(item => item.displayName === 'R03 临时在线' && item.instanceId), 'PAIRING_NOT_PENDING');
  await app.page.getByRole('button', { name: '确认此扩展', exact: true }).click();
  await until(async () => (await state()).profiles.some(item => item.profileId === pending.profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE');
  const profileId = pending.profileId;
  await app.page.getByRole('button', { name: '书签', exact: true }).click();
  await app.page.locator('#library-source').selectOption(`profile:${profileId}`);

  stage = 'revision-pagination';
  const first = await query(profileId, folder.id);
  ensure(first.total === 240 && first.nextOffset === 200, 'FIRST_LIVE_PAGE_INVALID');
  await app.page.locator('#library-search').fill('R03 LIVE');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 LIVE 00000' })).toBeVisible();
  await chrome.evaluate(`chrome.bookmarks.create({parentId:${JSON.stringify(folder.id)},title:'R03 LIVE 99999',url:'https://example.invalid/live/new'})`);
  await until(async () => (await state()).profiles.find(item => item.profileId === profileId)?.revision > first.revision, 'NEW_REVISION_NOT_OBSERVED');
  const stale = await query(profileId, folder.id, { offset: 200, expectedRevision: first.revision, expectedSourceEpoch: first.sourceEpoch }, true);
  ensure(stale.error === 'CONFLICT', 'OLD_LIVE_PAGE_ACCEPTED');
  await app.page.getByRole('listbox').getByRole('option').first().focus();
  await app.page.keyboard.press('Control+End');
  await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: 'R03 LIVE 99999' })).toBeVisible({ timeout: 30000 });
  pass('real_chrome_revision_invalidates_old_page_and_ui_reaches_new_last_item');

  stage = 'live-visible';
  for (let index = 0; index < 5; index++) {
    const title = `R03 EVENT ${String(index).padStart(5, '0')}`;
    await app.page.locator('#library-search').fill(title);
    await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: title })).toHaveCount(0);
    let started = performance.now();
    const added = await chrome.evaluate(`chrome.bookmarks.create({parentId:${JSON.stringify(folder.id)},title:${JSON.stringify(title)},url:'https://example.invalid/event/${index}'})`);
    await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: title })).toBeVisible();
    report.latencyMs.push({ kind: 'created', ms: performance.now() - started });
    started = performance.now();
    await chrome.evaluate(`chrome.bookmarks.remove(${JSON.stringify(added.id)})`);
    await expect(app.page.getByRole('listbox').getByRole('option').filter({ hasText: title })).toHaveCount(0);
    report.latencyMs.push({ kind: 'removed', ms: performance.now() - started });
  }
  ensure(report.latencyMs.every(sample => sample.ms <= 3000), 'LIVE_EVENT_OVER_3000MS');
  pass('ten_real_chrome_events_visible_within_3s', { maxMs: Math.max(...report.latencyMs.map(sample => sample.ms)) });
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-live-query.png`) });
  ensure(report.errors.length === 0, 'PAGE_ERRORS');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  process.exitCode = 1;
} finally {
  if (app) {
    try {
      await app.page.evaluate(async () => { const invoke=window.__TAURI_INTERNALS__.invoke;const state=await invoke('get_bridge_state');for(const pending of state.pending)await invoke('cancel_pairing',{profileId:pending.profileId});for(const profile of state.profiles)if(profile.profileId!=='pb10k')await invoke('revoke_pairing',{profileId:profile.profileId}); });
      report.temporaryCredentialsRemoved = true;
    } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
  }
  if (chrome) await chrome.close();
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-live-query-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, failedStage: report.failedStage, failureCode: report.failureCode, controls: report.controls.length, temporaryCredentialsRemoved: report.temporaryCredentialsRemoved }));
}
