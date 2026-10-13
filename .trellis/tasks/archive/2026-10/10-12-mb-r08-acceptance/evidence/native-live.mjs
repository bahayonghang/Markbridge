// V03: real Chrome events and real WebView2 rendering, no mocked IPC or daily profile.
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildB10k, B10K_SEED } from '../../../../../../apps/desktop/src/features/library/b10k.ts';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
const runId=randomUUID().slice(0,8);
const report={runId,startedAt:new Date().toISOString(),seed:B10K_SEED,scope:'B10K real Chrome create/update/move/delete 25 each; event listener Date.now to matching DOM plus animation frame on the same host clock',latency:[],errors:[]};
let app,chrome,profileId,stage='prepare';
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
const row=title=>app.page.getByRole('listbox').getByRole('option').filter({has:app.page.locator('.library-title').filter({hasText:new RegExp('^'+title+'$')})});
async function enterFolder(title){await app.page.locator('#library-scope').selectOption('all');await app.page.locator('#library-search').fill(title);await row(title).dblclick();await app.page.locator('#library-scope').selectOption('subtree');await app.page.locator('#library-search').fill('R08LIVE');await expect(app.page.locator('#library-search')).toHaveValue('R08LIVE');}
async function sample(kind,title,visible,expression,id){
  ensure((await app.invoke('get_bridge_state')).profiles.find(n=>n.profileId===profileId).connection==='live','NOT_LIVE_AT_SAMPLE_START');
  await app.page.evaluate(({title,visible})=>{
    window.r08VisibleAt=null;
    window.r08Observer?.disconnect();
    const ready=()=>{const workspace=document.querySelector('[aria-label="书签工作区"]');const status=[...workspace.querySelectorAll('[role="status"]')].find(n=>n.textContent.includes('已加载'));const count=visible?'已加载 1 / 1 项':'已加载 0 / 0 项';const found=[...workspace.querySelectorAll('[role="option"] .library-title')].some(n=>n.textContent===title&&n.getClientRects().length);return status?.textContent.includes(count)&&!status.textContent.includes('正在读取')&&![...workspace.querySelectorAll('[role="status"]')].some(n=>n.textContent.includes('正在读取'))&&found===visible;};
    const check=()=>{if(!ready())return;requestAnimationFrame(()=>{if(!ready()||window.r08VisibleAt!==null)return;window.r08VisibleAt=Date.now();window.r08Observer.disconnect();});};
    window.r08Observer=new MutationObserver(check);window.r08Observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
  },{title,visible});
  const result=await chrome.evaluate(expression); const affected=id??result.id;
  const rendered=await until(()=>app.page.evaluate(()=>window.r08VisibleAt),'UI_EVENT_NOT_VISIBLE',5000);
  const event=await chrome.evaluate(`window.r08Events.findLast(n=>n.kind===${JSON.stringify(kind)}&&n.id===${JSON.stringify(affected)})`);
  ensure(event&&rendered>=event.at,'CHROME_EVENT_OR_CLOCK_INVALID');
  report.latency.push({kind,ms:rendered-event.at});
  ensure(rendered-event.at<=3000,'LIVE_EVENT_OVER_3000MS');
  return result;
}
try{
  report.environment=await environment();report.isolationRoot=await fixtureRoot();app=await launch(report.isolationRoot);report.webview=app.webview;await app.resize(1100,760);app.page.on('pageerror',()=>report.errors.push('NATIVE_PAGE_ERROR'));
  chrome=await launchChrome(join(report.isolationRoot,'chrome-b10k'));report.chrome=chrome.version;
  const fixture=buildB10k();ensure(fixture.bookmarks===10000&&fixture.folders===1000&&fixture.maxDepth===20,'WRONG_B10K_SHAPE');
  await chrome.evaluate(`(async()=>{const roots=await chrome.bookmarks.getTree();const bar=roots[0].children.find(n=>n.folderType==='bookmarks-bar');window.r08Map={'0':roots[0].id,'1':bar.id};return true;})()`);
  const nodes=fixture.nodes.filter(n=>!['0','1','2','3'].includes(n.chromeId));
  for(let offset=0;offset<nodes.length;offset+=100){const part=nodes.slice(offset,offset+100);await chrome.evaluate(`(async()=>{for(const node of ${JSON.stringify(part)}){const created=await chrome.bookmarks.create({parentId:window.r08Map[node.parentId],title:node.title,...(node.url?{url:node.url}:{})});window.r08Map[node.chromeId]=created.id;}return true;})()`);}
  report.fixture=await chrome.evaluate(`(async()=>{let bookmarks=0,folders=0,maxDepth=0;function visit(n,depth){if(n.url)bookmarks++;else if(depth>=2)folders++;maxDepth=Math.max(depth,maxDepth);for(const c of n.children??[])visit(c,depth+1);}for(const n of await chrome.bookmarks.getTree())visit(n,0);return {bookmarks,folders,maxDepth};})()`);
  ensure(report.fixture.bookmarks===10000&&report.fixture.folders===1000&&report.fixture.maxDepth===20,'CHROME_B10K_SHAPE_MISMATCH');
  profileId=await pair(app,chrome,'R08 在线一万条');
  await app.page.getByRole('button',{name:'筛选',exact:true}).click();
  await chrome.evaluate(`window.r08Events=[];chrome.bookmarks.onCreated.addListener((id)=>window.r08Events.push({kind:'create',id,at:Date.now()}));chrome.bookmarks.onChanged.addListener((id)=>window.r08Events.push({kind:'update',id,at:Date.now()}));chrome.bookmarks.onMoved.addListener((id)=>window.r08Events.push({kind:'move',id,at:Date.now()}));chrome.bookmarks.onRemoved.addListener((id)=>window.r08Events.push({kind:'delete',id,at:Date.now()}));true`);
  const source=await chrome.evaluate('window.r08Map.f20');const target=await chrome.evaluate('window.r08Map.f21');
  stage='live-events';
  for(let i=0;i<25;i++){
    await enterFolder('中文文件夹');
    const title=`R08LIVE ${i} original`,updated=`R08LIVE ${i} updated`;
    const created=await sample('create',title,true,`chrome.bookmarks.create({parentId:${JSON.stringify(source)},title:${JSON.stringify(title)},url:'https://example.invalid/r08/live/${i}'})`);
    await sample('update',updated,true,`chrome.bookmarks.update(${JSON.stringify(created.id)},{title:${JSON.stringify(updated)}})`,created.id);
    await sample('move',updated,false,`chrome.bookmarks.move(${JSON.stringify(created.id)},{parentId:${JSON.stringify(target)}})`,created.id);
    await enterFolder('文件夹21');await expect(row(updated)).toBeVisible();
    await sample('delete',updated,false,`chrome.bookmarks.remove(${JSON.stringify(created.id)}).then(()=>true)`,created.id);
    if((i+1)%5===0)console.log(JSON.stringify({cycles:i+1,samples:report.latency.length}));
  }
  stage='final-tree';
  const actual=await chrome.evaluate(`(async()=>{const flat=[];function visit(n,parentId=null,position=0){flat.push({chromeId:n.id,parentId,position,title:n.title,url:n.url??null});(n.children??[]).forEach((c,i)=>visit(c,n.id,i));}for(const root of await chrome.bookmarks.getTree())visit(root);return flat.sort((a,b)=>a.chromeId.localeCompare(b.chromeId));})()`);
  const cache=await app.invoke('cache_tree',{profileId});
  const cached=cache.nodes.map(n=>({chromeId:n.chromeId,parentId:n.parentId,position:n.position,title:n.title,url:n.url})).sort((a,b)=>a.chromeId.localeCompare(b.chromeId));
  ensure(JSON.stringify(actual)===JSON.stringify(cached),'FINAL_CACHE_TREE_NOT_EQUIVALENT');
  report.stats=stats(report.latency.map(n=>n.ms));report.byKind=Object.fromEntries(['create','update','move','delete'].map(kind=>[kind,stats(report.latency.filter(n=>n.kind===kind).map(n=>n.ms))]));
  ensure(report.latency.length===100&&Object.values(report.byKind).every(n=>n.count===25)&&report.errors.length===0,'SAMPLES_OR_ERRORS');
  await app.page.locator('#library-scope').selectOption('all');await app.page.locator('#library-search').fill('MB05MARK');await expect(row('MB05MARK')).toBeVisible();
  await mkdir(join(evidence,'native-screenshots'),{recursive:true});await app.page.screenshot({path:join(evidence,'native-screenshots',`${runId}-live-b10k.png`)});report.status='PASS';
}catch(error){report.status='FAIL';report.failedStage=stage;report.failureCode=/^[A-Z][A-Z0-9_:.-]+$/.test(error.message)?error.message:'NATIVE_ASSERTION_OR_ACTION_FAILED';if(stage!=='prepare')report.assertion=error.message.slice(0,1600);process.exitCode=1;}
finally{if(app){try{await cleanCredentials(app);report.temporaryCredentialsRemoved=true;}catch{report.temporaryCredentialsRemoved=false;report.status='FAIL';process.exitCode=1;}}if(chrome)await chrome.close();if(app)await app.close();report.finishedAt=new Date().toISOString();await writeFile(join(evidence,`native-live-${runId}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,samples:report.latency.length,stats:report.stats,failedStage:report.failedStage,failureCode:report.failureCode}));}
