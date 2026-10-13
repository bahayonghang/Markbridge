// One daily workflow through real UI. IDs are used only to verify effects, never as user input.
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
import { dialog, waitDialog } from './native-dialog.mjs';
import { startProbe } from './native-probe.mjs';
const runId = randomUUID().slice(0, 8);
const report = { runId, startedAt: new Date().toISOString(), controls: [], errors: [], scope: 'Fresh isolated native app, two actual temporary Chrome profiles, UI daily workflow' };
let app, a, b, probe, profileA, profileB, fixtureA, fixtureB, stage = 'prepare';
const pass = (control, facts = {}) => { report.controls.push({ control, status: 'PASS', ...facts }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const state = () => app.invoke('get_bridge_state');
const profile = async id => (await state()).profiles.find(row => row.profileId === id);
const operations = async () => (await app.invoke('list_operations', { profileId: profileA })).operations;
const children = id => a.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(id)})`);
const detail = () => app.page.locator('.detail-pane');
const list = () => app.page.getByRole('listbox', { name: /^(书签列表|搜索结果)$/ });
const row = title => list().getByRole('option').filter({ hasText: title });
const review = () => app.page.getByRole('dialog', { name: '确认变更', exact: true });
const semantic = nodes => nodes.map(node => ({ id: node.id, title: node.title, url: node.url ?? null, children: semantic(node.children ?? []) }));
async function screenshot(name) { await mkdir(join(evidence, 'native-screenshots'), { recursive: true }); await app.page.screenshot({ path: join(evidence, 'native-screenshots', `${runId}-${name}.png`) }); }
async function closeDetail() { const button = app.page.getByRole('button', { name: '关闭详情，返回列表', exact: true }); if (await button.isVisible()) await button.click(); }
async function find(title) { await app.page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '书签', exact: true }).click(); await closeDetail(); const cancel = app.page.getByRole('button', { name: '取消选择', exact: true }); if (await cancel.isVisible()) await cancel.click(); await app.page.locator('#library-search').fill(title); await expect(row(title)).toBeVisible(); }
async function choose(id) { await app.page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '书签', exact: true }).click(); await closeDetail(); await app.page.locator('#library-source').selectOption(`profile:${id}`); }
async function note(title, value) { await find(title); await row(title).click(); await app.page.getByRole('tab', { name: '标签备注', exact: true }).click(); await detail().locator('#tag-note').fill(value); await detail().getByRole('button', { name: '保存备注', exact: true }).click(); await expect(detail().getByRole('button', { name: '保存备注', exact: true })).toBeEnabled(); }
async function seed(chrome, name) { return chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');const source=await chrome.bookmarks.create({parentId:bar.id,title:'R08 工作目录'});const target=await chrome.bookmarks.create({parentId:bar.id,title:'R08 归档目录'});const seed=await chrome.bookmarks.create({parentId:source.id,title:${JSON.stringify(name)},url:'https://example.invalid/r08/source'});return {source:source.id,target:target.id,seed:seed.id};})()`); }
try {
  report.environment = await environment(); report.isolationRoot = await fixtureRoot();
  probe = await startProbe(); app = await launch(report.isolationRoot); report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('NATIVE_PAGE_ERROR')); await app.resize(1100,760);
  a = await launchChrome(join(report.isolationRoot,'chrome-a')); b = await launchChrome(join(report.isolationRoot,'chrome-b')); report.chrome = a.version;
  fixtureA = await seed(a,'R08 相同编号 A'); fixtureB = await seed(b,'R08 相同编号 B');
  ensure(fixtureA.seed === fixtureB.seed, 'FIXTURE_IDS_NOT_OVERLAPPING');
  profileA = await pair(app,a,'R08 工作资料 A'); profileB = await pair(app,b,'R08 工作资料 B');
  stage = 'profile-isolation';
  await choose(profileA); await note('R08 相同编号 A','R08 本地备注 A');
  await choose(profileB); await note('R08 相同编号 B','R08 本地备注 B');
  for(const [id,chromeId,value] of [[profileA,fixtureA.seed,'R08 本地备注 A'],[profileB,fixtureB.seed,'R08 本地备注 B']]) {
    await until(async()=>(await app.invoke('tag_state',{profileId:id,chromeIds:[chromeId],filterTagId:null})).entries[0]?.note===value,'PROFILE_NOTE_NOT_ISOLATED');
  }
  await expect(detail().locator('#tag-note')).toHaveValue('R08 本地备注 B');
  await choose(profileA); await find('R08 相同编号 A'); await row('R08 相同编号 A').click(); await app.page.getByRole('tab',{name:'标签备注',exact:true}).click();
  await expect(detail().locator('#tag-note')).toHaveValue('R08 本地备注 A');
  const bBefore = JSON.stringify(await b.evaluate('chrome.bookmarks.getTree()'));
  pass('same_chrome_id_in_two_profiles_keeps_titles_and_local_notes_separate');

  stage = 'create-edit';
  await find('R08 工作目录'); await row('R08 工作目录').dblclick();
  await app.page.getByRole('button',{name:'新建',exact:true}).click();
  await app.page.locator('#edit-title').fill('R08 新建书签'); await app.page.locator('#edit-url').fill(probe.base+'/a');
  await app.page.getByRole('button',{name:'预览新书签',exact:true}).click(); await review().getByRole('button',{name:'取消',exact:true}).click();
  ensure((await children(fixtureA.source)).length===1,'CANCEL_CREATE_WROTE');
  await app.page.getByRole('button',{name:'预览新书签',exact:true}).click(); await review().getByRole('button',{name:'确认变更',exact:true}).click();
  const created = await until(async()=>(await children(fixtureA.source)).find(n=>n.title==='R08 新建书签'),'CREATE_NOT_OBSERVED');
  await closeDetail(); await row('R08 新建书签').click(); await app.page.getByRole('tab',{name:'信息',exact:true}).click(); await app.page.locator('#edit-title').fill('R08 已审查书签');
  await app.page.getByRole('button',{name:'预览修改',exact:true}).click(); await expect(review()).toContainText('R08 已审查书签'); await review().getByRole('button',{name:'确认变更',exact:true}).click();
  await until(async()=>(await children(fixtureA.source)).some(n=>n.id===created.id&&n.title==='R08 已审查书签'),'EDIT_NOT_OBSERVED');
  await closeDetail(); await app.page.getByRole('button',{name:'新建',exact:true}).click();
  await app.page.locator('[aria-label="新建类型"]').getByRole('button',{name:'文件夹',exact:true}).click(); await app.page.locator('#edit-title').fill('R08 新建文件夹');
  await app.page.getByRole('button',{name:'预览新文件夹',exact:true}).click(); await review().getByRole('button',{name:'确认变更',exact:true}).click();
  await until(async()=>(await children(fixtureA.source)).some(n=>n.title==='R08 新建文件夹'),'FOLDER_NOT_OBSERVED'); await closeDetail();
  pass('search_enter_folder_create_cancel_confirm_edit_and_create_folder_without_id_input');

  stage = 'batch-tags-and-move';
  await list().getByRole('checkbox',{name:'选择 R08 相同编号 A',exact:true}).check(); await list().getByRole('checkbox',{name:'选择 R08 已审查书签',exact:true}).check();
  await app.page.getByRole('button',{name:'标签',exact:true}).click();
  const common = app.page.getByRole('region',{name:'共同标签与备注',exact:true}); await common.locator('#tag-name').fill('R08 资料'); await common.getByRole('button',{name:'添加标签',exact:true}).click();
  await until(async()=>(await app.invoke('tag_state',{profileId:profileA,chromeIds:[fixtureA.seed,created.id],filterTagId:null})).entries.every(n=>n.tagIds.length===1),'BATCH_TAG_NOT_SAVED');
  await closeDetail(); await app.page.getByRole('button',{name:'移动所选',exact:true}).click();
  const batch=app.page.getByRole('region',{name:'多选变更',exact:true}); await batch.locator('.folder-picker > summary').click(); await batch.getByLabel('搜索文件夹路径',{exact:true}).fill('R08 归档目录'); await batch.getByRole('listbox',{name:'目标文件夹',exact:true}).getByRole('option').click();
  await batch.getByRole('button',{name:'预览批量移动',exact:true}).click(); const batchReview=app.page.getByRole('dialog',{name:'确认批量变更',exact:true});
  await expect(batchReview).toContainText('含子树共 2 项'); await screenshot('daily-batch-review');
  const beforeMove = await a.evaluate(`chrome.bookmarks.getSubTree(${JSON.stringify(fixtureA.source)})`);
  await batchReview.getByRole('button',{name:'确认批量变更',exact:true}).click(); await expect(batch.getByRole('heading',{name:'全部回执已确认',exact:true})).toBeVisible({timeout:30000});
  ensure((await children(fixtureA.target)).length===2,'BATCH_MOVE_NOT_OBSERVED');
  pass('local_multi_tag_and_path_selected_batch_move_have_confirmed_real_receipts');

  stage = 'undo';
  await app.page.getByRole('button',{name:'操作历史',exact:true}).click();
  const batchHistory = app.page.getByRole('list',{name:'操作记录',exact:true}).locator(':scope > li').filter({has:app.page.locator('.history-summary').filter({hasText:'批量移动'})}).first();
  await batchHistory.getByRole('button',{name:'撤销此记录',exact:true}).click(); const undo=app.page.getByRole('region',{name:'撤销预览',exact:true});
  await expect(undo.getByRole('list',{name:'完整撤销差异',exact:true}).locator(':scope > li')).toHaveCount(2);
  await undo.getByRole('button',{name:'确认条件撤销',exact:true}).click(); await until(async()=>(await operations()).some(n=>n.kind==='undo'&&n.state==='rolled_back'),'UNDO_NOT_CONFIRMED');
  const afterMoveUndo = await a.evaluate(`chrome.bookmarks.getSubTree(${JSON.stringify(fixtureA.source)})`);
  report.undoRestoredSemanticTree = JSON.stringify(semantic(afterMoveUndo))===JSON.stringify(semantic(beforeMove));
  report.undoRawTreeEqual = JSON.stringify(afterMoveUndo)===JSON.stringify(beforeMove);
  ensure(report.undoRestoredSemanticTree,'UNDO_TREE_OR_ORDER_CHANGED');
  pass('visible_history_record_conditional_undo_restores_original_order');

  stage = 'export';
  await app.page.getByRole('button',{name:'备份导出',exact:true}).click(); const exportDesk=app.page.getByRole('region',{name:'备份导出',exact:true});
  const outputs=join(report.isolationRoot,'exports'); await mkdir(outputs);
  for(const [button,name] of [['导出 HTML','daily.html'],['导出侧车 JSON','daily.json']]) {
    await exportDesk.getByRole('button',{name:button,exact:true}).click(); await waitDialog(app); await dialog(app,'save',join(outputs,name)); await expect(exportDesk.getByText('文件已保存到所选位置。',{exact:true})).toBeVisible({timeout:15000});
  }
  const html=await readFile(join(outputs,'daily.html'),'utf8');
  const parsed=await app.page.evaluate(({html,title,url})=>{const doc=new DOMParser().parseFromString(html,'text/html');return {netscape:html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'),folders:doc.querySelectorAll('h3').length,match:[...doc.querySelectorAll('a')].some(n=>n.textContent===title&&n.getAttribute('href')===url)};},{html,title:'R08 已审查书签',url:probe.base+'/a'});
  ensure(parsed.netscape&&parsed.folders>=3&&parsed.match,'HTML_EXPORT_PARSE_OR_CONTENT_INVALID');
  report.htmlParsed=parsed;
  const json=JSON.parse(await readFile(join(outputs,'daily.json'),'utf8')); ensure(JSON.stringify(json).includes('R08 资料')&&JSON.stringify(json).includes('R08 本地备注 A'),'SIDECAR_EXPORT_MISSING_LOCAL_DATA');
  pass('history_to_native_export_saves_parseable_html_and_sidecar_with_local_data');

  stage = 'preview';
  await find('R08 已审查书签'); await row('R08 已审查书签').click(); await app.page.getByRole('tab',{name:'内容预览',exact:true}).click();
  await expect(app.page.getByRole('region',{name:'内容预览',exact:true})).toBeVisible();
  await app.page.getByRole('button',{name:'打开应用内网页',exact:true}).click(); await probe.hello('/a'); await until(async()=>(await app.invoke('web_preview_state')).phase==='ready','WEB_NOT_READY');
  await app.page.getByRole('button',{name:'关闭预览',exact:true}).click(); await until(async()=>(await app.invoke('web_preview_state')).phase==='closed','WEB_NOT_CLOSED');
  pass('content_section_to_actual_separate_web_preview_and_back');

  stage = 'offline-and-restart';
  const port=(await state()).port; await a.close(); a=null; await until(async()=>(await profile(profileA)).connection!=='live','A_NOT_OFFLINE');
  await app.page.getByRole('tab',{name:'标签备注',exact:true}).click(); await detail().locator('#tag-note').fill('R08 离线备注'); await detail().getByRole('button',{name:'保存备注',exact:true}).click(); await expect(detail().getByRole('button',{name:'保存备注',exact:true})).toBeEnabled();
  await until(async()=>(await app.invoke('tag_state',{profileId:profileA,chromeIds:[created.id],filterTagId:null})).entries[0].note==='R08 离线备注','OFFLINE_NOTE_NOT_SAVED');
  await closeDetail(); await screenshot('daily-offline');
  const count=(await operations()).length; await app.close(); app=await launch(report.isolationRoot); app.page.on('pageerror',()=>report.errors.push('NATIVE_PAGE_ERROR'));
  ensure((await operations()).length===count,'RESTART_CREATED_OPERATION');
  await app.page.getByRole('button',{name:'设置',exact:true}).click(); await app.page.getByRole('tab',{name:'Chrome 连接',exact:true}).click();
  if(!await app.page.locator('#bridge-port').isVisible())await app.page.locator('details:has(#bridge-port)>summary').click(); await app.page.locator('#bridge-port').fill(String(port)); await app.page.getByRole('button',{name:'启动连接',exact:true}).click();
  a=await launchChrome(join(report.isolationRoot,'chrome-a')); await until(async()=>(await profile(profileA)).connection==='live'&&(await profile(profileB)).connection==='live','PROFILES_NOT_RECONCILED');
  await choose(profileA); await find('R08 已审查书签'); await row('R08 已审查书签').click(); await app.page.getByRole('tab',{name:'标签备注',exact:true}).click(); await expect(detail().locator('#tag-note')).toHaveValue('R08 离线备注');
  ensure(JSON.stringify(await b.evaluate('chrome.bookmarks.getTree()'))===bBefore,'PROFILE_B_TREE_CHANGED');
  ensure((await operations()).length===count,'RECONNECT_REPLAYED_OPERATION');
  pass('offline_local_note_survives_native_restart_and_reconnect_without_replay_or_cross_profile_change');
  stage='window-matrix'; await closeDetail(); await find('R08 工作目录'); await row('R08 工作目录').dblclick();
  for(const [width,height] of [[1440,900],[1100,760],[640,760],[1100,480],[640,480]]) { await app.resize(width,height); ensure(await app.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HORIZONTAL_OVERFLOW'); await screenshot(`daily-library-${width}x${height}`); (report.viewports??=[]).push(await app.page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio}))); }
  ensure(report.errors.length===0,'PAGE_ERRORS'); report.status='PASS';
} catch(error) { report.status='FAIL'; report.failedStage=stage; report.failureCode=/^[A-Z][A-Z0-9_:.-]+$/.test(error.message)?error.message:'NATIVE_ASSERTION_OR_ACTION_FAILED'; if(stage!=='prepare')report.assertion=error.message.slice(0,1800); if(app&&stage!=='prepare')await screenshot(`failure-${stage}`).catch(()=>{}); process.exitCode=1; }
finally { if(app){try{await cleanCredentials(app);report.temporaryCredentialsRemoved=true;}catch{report.temporaryCredentialsRemoved=false;report.status='FAIL';process.exitCode=1;}} if(a)await a.close(); if(b)await b.close(); if(app)await app.close(); if(probe)await probe.close(); report.finishedAt=new Date().toISOString(); await writeFile(join(evidence,`native-daily-${runId}.json`),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify({status:report.status,controls:report.controls.length,failedStage:report.failedStage,failureCode:report.failureCode})); }
