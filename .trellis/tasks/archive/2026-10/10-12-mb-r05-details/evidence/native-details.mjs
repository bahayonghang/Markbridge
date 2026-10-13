// Real UI + real Rust local metadata + disposable Chrome. No daily profile access.
import { expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
import { startProbe } from './native-probe.mjs';
const run = promisify(execFile), runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), controls: [], errors: [] };
let app, chrome, probe, profileId, fixture, openerPid, stage = 'prepare';
const pass = (control, facts = {}) => { report.controls.push({ control, status: 'PASS', ...facts }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const tagState = () => app.invoke('tag_state', { profileId, chromeIds: [fixture.a, fixture.b], filterTagId: null });
async function screenshot(name) { await mkdir(join(evidence, 'native-screenshots'), { recursive: true }); await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) }); }
try {
  report.environment = await environment(); report.isolationRoot = await fixtureRoot();
  probe = await startProbe(); app = await launch(report.isolationRoot); report.webview = app.webview;
  await app.resize(1100, 760);
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-details')); report.chrome = chrome.version;
  fixture = await chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'R05 资料'});const a=await chrome.bookmarks.create({parentId:folder.id,title:'R05 条目 A | 原有竖线',url:${JSON.stringify(probe.base+'/a')}});const b=await chrome.bookmarks.create({parentId:folder.id,title:'R05 条目 B',url:${JSON.stringify(probe.base+'/b')}});const long=await chrome.bookmarks.create({parentId:folder.id,title:'R05 长网址',url:${JSON.stringify(probe.base+'/long?'+ 'q'.repeat(2500))}});const fail=await chrome.bookmarks.create({parentId:folder.id,title:'R05 失败网页',url:'http://127.0.0.1:1/r05-fail'});for(let i=0;i<40;i++)await chrome.bookmarks.create({parentId:folder.id,title:'R05 滚动条目 '+String(i).padStart(2,'0'),url:'https://example.invalid/r05/'+i});return {a:a.id,b:b.id,long:long.id,fail:fail.id,folder:folder.id};})()`);
  const originalTitles = await chrome.evaluate(`chrome.bookmarks.get(${JSON.stringify([fixture.a,fixture.b])}).then(nodes=>nodes.map(n=>({id:n.id,title:n.title,url:n.url})))`);
  profileId = await pair(app, chrome, 'R05 临时资料');
  const page = app.page, detail = page.locator('.detail-pane');
  page.on('pageerror', () => report.errors.push('MAIN_PAGE_ERROR'));
  const list = () => page.getByRole('listbox', { name: '书签列表', exact: true });
  const row = title => list().getByRole('option').filter({ hasText: title });
  const closeDetail = () => page.getByRole('button', { name: '关闭详情，返回列表', exact: true }).click();
  const metadata = () => page.getByRole('tab', { name: '标签备注', exact: true }).click();
  await page.locator('#library-search').fill('R05 资料');
  await page.getByRole('listbox', { name: '搜索结果', exact: true }).getByRole('option').filter({ hasText: 'R05 资料' }).dblclick();
  stage = 'draft-and-hidden-preview';
  await page.evaluate(() => {
    const fetch = window.fetch;
    window.__r05PreviewCalls = 0;
    window.__r05IpcCalls = 0;
    window.__r05DelayedReads = 0;
    window.__r05DelayTags = false;
    const instrumented = function(input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      const ipc = url.host === 'ipc.localhost';
      if (ipc) window.__r05IpcCalls++;
      if (ipc && url.pathname === '/content_preview') window.__r05PreviewCalls++;
      const result = fetch.call(this, input, init);
      if (!ipc || url.pathname !== '/tag_state' || !window.__r05DelayTags) return result;
      const readNumber = ++window.__r05DelayedReads;
      // Preserve the real backend Response and its opaque headers/body unchanged.
      return result.then(response => new Promise(resolve => setTimeout(() => resolve(response), readNumber % 2 ? 500 : 15)));
    };
    window.fetch = instrumented;
    window.__r05FetchInstalled = window.fetch === instrumented;
  });
  await row('R05 条目 A').click();
  await expect(page.getByRole('tab', { name: '信息', exact: true })).toHaveAttribute('aria-selected', 'true');
  await delay(300);
  ensure(await page.evaluate(() => window.__r05FetchInstalled && window.__r05IpcCalls > 0), 'IPC_OBSERVER_NOT_ACTIVE');
  ensure(await page.evaluate(() => window.__r05PreviewCalls) === 0, 'HIDDEN_PREVIEW_FETCHED');
  await metadata();
  await page.locator('#tag-note').fill('R05 尚未保存的草稿');
  await page.getByRole('tab', { name: '信息', exact: true }).click(); await metadata();
  await expect(page.locator('#tag-note')).toHaveValue('R05 尚未保存的草稿');
  await closeDetail(); await page.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.locator('#tag-note')).toHaveValue('R05 尚未保存的草稿');
  await row('R05 条目 B').click();
  const leave = page.getByRole('dialog', { name: '放弃未保存的本地草稿？', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '留在当前页面', exact: true }).click();
  await expect(page.locator('#tag-note')).toHaveValue('R05 尚未保存的草稿');
  await row('R05 条目 B').click();
  await leave.getByRole('button', { name: '放弃草稿并继续', exact: true }).click();
  await metadata(); await expect(page.locator('#tag-note')).toHaveValue('');
  ensure((await tagState()).entries.every(entry => !entry.note), 'DISCARDED_DRAFT_WAS_SAVED');
  pass('single_detail_sections_hidden_preview_and_explicit_unsaved_draft_leave');

  stage = 'offline-metadata';
  await chrome.close(); chrome = null;
  await until(async () => (await app.invoke('get_bridge_state')).profiles.find(p => p.profileId === profileId)?.connection !== 'live', 'SOURCE_NOT_OFFLINE');
  await page.locator('#tag-note').fill('R05 本地备注 B');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await until(async () => (await tagState()).entries.find(e => e.chromeId === fixture.b)?.note === 'R05 本地备注 B', 'OFFLINE_NOTE_NOT_SAVED');
  await row('R05 条目 A').click(); await metadata();
  await page.locator('#tag-note').fill('R05 本地备注 A');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await until(async () => (await tagState()).entries.find(e => e.chromeId === fixture.a)?.note === 'R05 本地备注 A', 'OFFLINE_NOTE_A_NOT_SAVED');
  await closeDetail();
  await list().getByRole('checkbox', { name: '选择 R05 条目 A | 原有竖线', exact: true }).check();
  await list().getByRole('checkbox', { name: '选择 R05 条目 B', exact: true }).check();
  await page.getByRole('button', { name: '标签', exact: true }).click();
  const common = page.getByRole('region', { name: '共同标签与备注', exact: true });
  await expect(common).toBeVisible();
  await expect(detail.getByRole('tablist')).toHaveCount(0);
  await common.locator('#tag-name').fill('R05 本地标签');
  await common.getByRole('button', { name: '添加标签', exact: true }).click();
  await until(async () => (await tagState()).entries.every(entry => entry.tagIds.length === 1), 'OFFLINE_BATCH_TAG_NOT_SAVED');
  await common.getByRole('list', { name: '当前标签' }).getByRole('button', { name: '移除', exact: true }).click();
  await until(async () => (await tagState()).entries.every(entry => entry.tagIds.length === 0), 'OFFLINE_BATCH_TAG_NOT_REMOVED');
  await common.locator('#tag-name').fill('R05 本地标签');
  await common.getByRole('button', { name: '添加标签', exact: true }).click();
  await until(async () => (await tagState()).entries.every(entry => entry.tagIds.length === 1), 'OFFLINE_BATCH_TAG_NOT_RESTORED');
  await screenshot('offline-common-metadata');
  chrome = await launchChrome(join(report.isolationRoot, 'chrome-details'));
  await until(async () => (await app.invoke('get_bridge_state')).profiles.find(p => p.profileId === profileId)?.connection === 'live', 'SOURCE_DID_NOT_RECONNECT');
  const unchanged = await chrome.evaluate(`chrome.bookmarks.get(${JSON.stringify([fixture.a,fixture.b])}).then(nodes=>nodes.map(n=>({id:n.id,title:n.title,url:n.url})))`);
  ensure(JSON.stringify(unchanged) === JSON.stringify(originalTitles), 'LOCAL_METADATA_CHANGED_CHROME');
  pass('offline_notes_batch_tag_add_remove_and_chrome_titles_unchanged');

  stage = 'rapid-selection';
  await closeDetail();
  const clearSelection = page.getByRole('button', { name: '取消选择', exact: true });
  // Reconnection can legitimately clear selection before this independent check.
  if (await clearSelection.isVisible()) await clearSelection.click();
  await page.evaluate(() => { window.__r05DelayTags = true; window.__r05DelayedReads = 0; });
  for (let i = 0; i < 20; i++) { report.switchCycle = i + 1; await row('R05 条目 A').click(); await metadata(); await row('R05 条目 B').click(); await metadata(); }
  await delay(650);
  await expect(detail.locator('.detail-summary')).toContainText('R05 条目 B');
  await expect(page.locator('#tag-note')).toHaveValue('R05 本地备注 B');
  await expect(page.getByRole('button', { name: '保存备注', exact: true })).toBeEnabled();
  ensure(await page.evaluate(() => window.__r05DelayedReads >= 40), 'DELAYED_READS_NOT_OBSERVED');
  pass('twenty_a_b_cycles_discard_late_real_ipc_results', { delayedReads: await page.evaluate(() => window.__r05DelayedReads) });

  stage = 'title-encoding';
  await row('R05 条目 A').click(); await metadata();
  await page.getByText('可选：将标签写入标题', { exact: true }).click();
  report.titleStep = 'enable';
  await page.locator('#title-encoding').click();
  await expect(page.locator('#title-encoding')).toBeChecked();
  report.titleStep = 'preview';
  await page.getByRole('button', { name: '预览标题差异', exact: true }).click();
  const encoding = page.getByRole('dialog', { name: '标题差异', exact: true });
  report.titleStep = 'review-diff';
  await expect(encoding).toContainText('R05 条目 A | 原有竖线');
  await expect(encoding).toContainText('R05 本地标签');
  report.titleStep = 'cancel';
  await encoding.getByRole('button', { name: '取消', exact: true }).click();
  ensure((await chrome.evaluate(`chrome.bookmarks.get(${JSON.stringify(fixture.a)})`))[0].title === originalTitles[0].title, 'ENCODING_PREVIEW_CHANGED_TITLE');
  pass('optional_title_encoding_requires_opt_in_and_full_review_cancel_zero_write');

  stage = 'long-url-and-content';
  await row('R05 长网址').click();
  await page.getByRole('tab', { name: '信息', exact: true }).click();
  report.viewports = [];
  for (const [width, height] of [[1440,900],[1100,760],[640,760],[1100,480],[640,480]]) {
    await app.resize(width,height);
    ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'DETAIL_HORIZONTAL_OVERFLOW');
    await expect(page.getByRole('button', { name: '关闭详情，返回列表', exact: true })).toBeInViewport();
    report.viewports.push(await page.evaluate(() => ({ width: innerWidth,height:innerHeight,scale:devicePixelRatio })));
    await screenshot(`long-url-${width}x${height}`);
  }
  await app.resize(1100,760); await closeDetail();
  await row('R05 失败网页').click(); await page.getByRole('tab', { name: '内容预览', exact: true }).click();
  await expect(page.getByRole('region', { name: '内容预览', exact: true })).toBeVisible();
  await until(() => page.evaluate(() => window.__r05PreviewCalls > 0), 'VISIBLE_PREVIEW_OBSERVER_POSITIVE_CONTROL_FAILED');
  report.ipcObserver = await page.evaluate(() => ({ installed: window.__r05FetchInstalled, calls: window.__r05IpcCalls, visiblePreviewCalls: window.__r05PreviewCalls, delayedTagReads: window.__r05DelayedReads }));
  await page.getByRole('button', { name: '打开应用内网页', exact: true }).click();
  await until(async () => (await app.invoke('web_preview_state')).phase === 'failed', 'FAILED_WEB_STATE_MISSING');
  await expect(page.getByText(/此网站没有在应用内网页中打开/)).toBeVisible();
  await page.getByRole('button', { name: '在 Chrome 中打开', exact: true }).click();
  openerPid = await until(async () => { const value = Number(await readFile(join(report.isolationRoot,'suspended-opener.pid'),'utf8').catch(()=>'')); return Number.isInteger(value)&&value>0?value:null; }, 'FALLBACK_HANDOFF_NOT_CREATED');
  const { stdout } = await run('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(evidence,'native-opener.ps1'),'-TargetProcessId',String(openerPid),'-ExpectedParentId',String(app.child.pid),'-ExpectedUrl','http://127.0.0.1:1/r05-fail'],{windowsHide:true,timeout:20000});
  const handoff = JSON.parse(stdout.trim());
  ensure(handoff.handler && handoff.urlMatched && handoff.childCount === 0 && handoff.threadCount === handoff.suspendedThreadCount && handoff.suspendCount >= 1, 'FALLBACK_NOT_SAFELY_SUSPENDED');
  await run('taskkill',['/PID',String(openerPid),'/F'],{windowsHide:true}); openerPid=null;
  await app.invoke('web_preview_action',{action:'close'});
  pass('long_url_five_native_sizes_content_tab_failed_web_and_suspended_chrome_handoff',{handoff});
  stage='list-scroll-return';
  await closeDetail();
  await list().evaluate(node=>{node.scrollTop=780;});
  await expect(row('R05 滚动条目 15')).toBeVisible();
  await row('R05 滚动条目 15').click();
  const beforeClose=await list().evaluate(node=>node.scrollTop);
  await closeDetail();
  const afterClose=await list().evaluate(node=>node.scrollTop);
  ensure(beforeClose>0&&Math.abs(afterClose-beforeClose)<1,'DETAIL_CLOSE_LOST_LIST_POSITION');
  pass('closing_detail_restores_same_scrolled_list_position',{beforeClose,afterClose});
  ensure(report.errors.length===0,'MAIN_PAGE_ERRORS'); report.status='PASS';
} catch(error) {
  report.status='FAIL';report.failedStage=stage;report.failureSummary=String(error.message).split('\n')[0].replace(/[^\x20-\x7E]/g,'?').slice(0,240);report.failureCode=/^[A-Z][A-Z0-9_:.-]+$/.test(error.message)?error.message:'NATIVE_ASSERTION_OR_ACTION_FAILED';process.exitCode=1;
  if(app&&profileId)await screenshot('failure').catch(()=>{});
} finally {
  if(openerPid)await run('taskkill',['/PID',String(openerPid),'/F'],{windowsHide:true}).catch(()=>{});
  if(app){await app.invoke('web_preview_action',{action:'close'}).catch(()=>{});try{await cleanCredentials(app);report.temporaryCredentialsRemoved=true;}catch{report.temporaryCredentialsRemoved=false;report.status='FAIL';process.exitCode=1;}}
  if(chrome)await chrome.close();if(app)await app.close();if(probe)await probe.close();
  report.finishedAt=new Date().toISOString();await writeFile(join(evidence,`native-details-${runId}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,controls:report.controls.length,failedStage:report.failedStage,failureCode:report.failureCode}));
}
