// Actual monitor DPI observation and a manually coordinated OS sleep/wake gate.
// This script never changes display settings or invokes OS suspend by itself.
import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { environment, evidence, fixtureRoot, launch, launchChrome, pair, cleanCredentials, until, ensure } from './native-driver.mjs';
const run=promisify(execFile), runId=randomUUID().slice(0,8), mode=process.argv[2]??'probe';
ensure(['probe','display','sleep'].includes(mode),'INVALID_MODE');
const report={runId,mode,startedAt:new Date().toISOString(),scope:'Own isolated window across actual monitors; genuine Kernel-Power sleep/resume events required for sleep acceptance',displays:[],errors:[]};
let app,chrome,profileId,stage='prepare';
async function powershell(file,args){const result=await run('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(evidence,file),...args],{windowsHide:true});return JSON.parse(result.stdout);}
const display=index=>powershell('native-display.ps1',['-TargetProcessId',String(app.child.pid),...(index===undefined?[]:['-MonitorIndex',String(index)])]);
const state=()=>app.invoke('get_bridge_state');
const profile=async()=>(await state()).profiles.find(n=>n.profileId===profileId);
const operations=async()=>(await app.invoke('list_operations',{profileId})).operations;
const power=()=>powershell('native-power-events.ps1',['-Since',report.sleepReadyAt??report.startedAt]);
async function cursor(){const result=await run('python',['-c',"import json,sqlite3,sys,pathlib; p=pathlib.Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); print(json.dumps(c.execute('SELECT source_epoch,session_id,last_seq,revision FROM source_cursors WHERE profile_id=?',[sys.argv[2]]).fetchone())); c.close()",join(report.isolationRoot,'app-data/markbridge.sqlite'),profileId],{windowsHide:true});return JSON.parse(result.stdout);}
async function compareTree(){const actual=await chrome.evaluate(`(async()=>{const flat=[];function visit(n,parentId=null,position=0){flat.push({chromeId:n.id,parentId,position,title:n.title,url:n.url??null});(n.children??[]).forEach((c,i)=>visit(c,n.id,i));}for(const n of await chrome.bookmarks.getTree())visit(n);return flat.sort((a,b)=>a.chromeId.localeCompare(b.chromeId));})()`);const cached=(await app.invoke('cache_tree',{profileId})).nodes.map(n=>({chromeId:n.chromeId,parentId:n.parentId,position:n.position,title:n.title,url:n.url})).sort((a,b)=>a.chromeId.localeCompare(b.chromeId));return JSON.stringify(actual)===JSON.stringify(cached);}
async function screenshot(name){await app.page.screenshot({path:join(evidence,'native-screenshots',`${runId}-${name}.png`)});}
try{
  report.environment=await environment();report.isolationRoot=await fixtureRoot();app=await launch(report.isolationRoot);report.webview=app.webview;app.page.on('pageerror',()=>report.errors.push('NATIVE_PAGE_ERROR'));
  chrome=await launchChrome(join(report.isolationRoot,'chrome-system'));report.chrome=chrome.version;
  await chrome.evaluate(`(async()=>{const root=(await chrome.bookmarks.getTree())[0];const bar=root.children.find(n=>n.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'R08 系统验收资料'});for(let i=0;i<12;i++)await chrome.bookmarks.create({parentId:folder.id,title:'R08 中文长标题与键盘导航 '+i,url:'https://example.invalid/r08/system/'+i});return true;})()`);
  profileId=await pair(app,chrome,'R08 系统验收');stage='initial-search';await app.page.locator('#library-search').fill('R08 中文');await expect(app.page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await mkdir(join(evidence,'native-screenshots'),{recursive:true});
  stage='instrumentation';report.initialCursor=await cursor();ensure(report.initialCursor&&report.initialCursor[3]>0,'CURSOR_NOT_READABLE');ensure(await compareTree(),'INITIAL_TREE_MISMATCH');await power();
  await app.page.evaluate(async id=>{
    window.r08Transitions=[];window.r08StableUi=[];
    const record=payload=>{const p=payload.profiles.find(n=>n.profileId===id);if(!p)return;window.r08Transitions.push({at:Date.now(),connection:p.connection,revision:p.revision});requestAnimationFrame(()=>requestAnimationFrame(async()=>{const state=await window.__TAURI_INTERNALS__.invoke('get_bridge_state');const current=state.profiles.find(n=>n.profileId===id);if(!current)return;const create=[...document.querySelectorAll('button')].find(n=>n.textContent==='新建');window.r08StableUi.push({at:Date.now(),connection:current.connection,revision:current.revision,createDisabled:create?.disabled??null});}));};
    await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'bridge-state',target:{kind:'Any'},handler:window.__TAURI_INTERNALS__.transformCallback(event=>record(event.payload))});
  },profileId);
  if(mode!=='display'){
    stage='nonlive-positive-control';const nodes=(await app.invoke('cache_tree',{profileId})).nodes;const bookmark=nodes.find(n=>n.url);ensure(bookmark,'NO_PROBE_BOOKMARK');
    const count=(await operations()).length;await chrome.close();chrome=null;await until(async()=>(await profile()).connection!=='live','CONTROL_NOT_OFFLINE');
    await expect(app.page.getByRole('button',{name:'新建',exact:true})).toBeDisabled();const offline=await profile();const action={kind:'update',chromeId:bookmark.chromeId,title:'R08 must never apply offline',url:null};
    const preview=await app.invoke('preview_edit',{profileId,expectedRevision:offline.revision,action});ensure(!preview.writable,'NONLIVE_PREVIEW_WRITABLE');
    const refused=await app.invoke('apply_edit',{profileId,expectedRevision:offline.revision,action,secondConfirm:false},true);ensure(refused.error==='READ_ONLY','NONLIVE_APPLY_NOT_REFUSED');
    await until(()=>app.page.evaluate(()=>window.r08Transitions.some(n=>n.connection!=='live')),'STATE_EVENT_LISTENER_NOT_PROVEN');
    chrome=await launchChrome(join(report.isolationRoot,'chrome-system'));await until(async()=>(await profile()).connection==='live','CONTROL_NOT_RECONNECTED');
    ensure(await compareTree()&&(await operations()).length===count,'CONTROL_REPLAY_OR_TREE_CHANGED');
    report.nonliveControl={previewWritable:preview.writable,applyError:refused.error,createDisabled:true,stateEventObserved:true,noOperationReplay:true};
  }
  if(mode==='display'){
    stage='actual-display';const initial=await display();
    let matrix150=false;
    for(let i=0;i<initial.monitors.length;i++){
      await display(i);await delay(500);const observed=await display();
      await until(()=>app.page.evaluate(dpi=>Math.abs(devicePixelRatio-dpi/96)<.001,observed.dpi),'WEBVIEW_DPI_MISMATCH');
      await app.resize(800,600);await expect(app.page.getByRole('listbox').getByRole('option').first()).toBeVisible();
      const view=await app.page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth}));ensure(!view.overflow,'DPI_HORIZONTAL_OVERFLOW');
      report.displays.push({native:observed,view});await screenshot(`actual-monitor-${i}`);
      if(observed.dpi===144&&!matrix150){
        report.actual150Viewports=[];
        for(const [width,height] of [[1440,900],[1100,760],[640,760],[1100,480],[640,480]]){
          await app.resize(width,height);const checked=await app.page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth}));
          ensure(checked.scale===1.5&&!checked.overflow,'ACTUAL_150_MATRIX_FAILED');report.actual150Viewports.push(checked);await screenshot(`actual150-${width}x${height}`);
        }
        matrix150=true;
      }
    }
    report.actual150=report.displays.some(n=>n.native.dpi===144&&n.view.scale===1.5);
    report.crossMonitor=report.displays.length>=2;
    report.crossDifferentDpi=new Set(report.displays.map(n=>n.native.dpi)).size>=2;
    report.status=report.actual150&&report.crossMonitor&&report.crossDifferentDpi?'PASS':'PARTIAL';
  }else if(mode==='probe'){
    report.powerInstrumentation='READABLE';report.currentDisplay=await display();report.stateListenerInstalled=report.nonliveControl.stateEventObserved;
    ensure(report.stateListenerInstalled,'STATE_LISTENER_NOT_INSTALLED');report.status='PROBE_PASS';report.sleepAcceptance='NOT_RUN';
  }else{
    stage='waiting-for-real-sleep';report.before=await profile();report.beforeCursor=await cursor();report.operationCount=(await operations()).length;report.sleepReadyAt=new Date().toISOString();
    await app.page.evaluate(()=>{window.r08Transitions=[];window.r08StableUi=[];});
    await writeFile(join(evidence,`native-system-ready-${runId}.json`),JSON.stringify({runId,readyAt:report.sleepReadyAt,process:app.child.pid,root:report.isolationRoot},null,2)+'\n');
    console.log(JSON.stringify({readyForManualSleep:true,runId,instruction:'Select Windows Sleep, wait at least 60 seconds, then wake. No automated suspend is performed.'}));
    const deadline=Date.now()+30*60*1000;
    while(Date.now()<deadline){if(await access(join(report.isolationRoot,'cancel-sleep')).then(()=>true,()=>false)){report.status='NOT_RUN';report.pending='Manual sleep not performed; observation cancelled and isolated resources closed';break;}const events=await power();const enter=events.find(n=>[42,506].includes(n.id));const leave=enter&&events.find(n=>n.id===(enter.id===42?107:507)&&n.recordId>enter.recordId&&Date.parse(n.at)>Date.parse(enter.at));if(enter&&leave){report.powerEvents=events;report.wakeAt=leave.at;report.sleepIntervalMs=Date.parse(leave.at)-Date.parse(enter.at);break;}await delay(10000);}
    if(report.status==='NOT_RUN')throw new Error('MANUAL_SLEEP_PENDING');
    ensure(report.powerEvents&&report.sleepIntervalMs>=60000,'REAL_SLEEP_NOT_OBSERVED_OR_TOO_SHORT');stage='resume-reconcile';
    await until(async()=>(await profile()).connection==='live','PROFILE_NOT_LIVE_AFTER_REAL_SLEEP',60000);
    report.after=await profile();report.afterCursor=await cursor();report.transitions=await app.page.evaluate(()=>window.r08Transitions);
    report.fullTreeEquivalent=await compareTree();report.noOperationReplay=(await operations()).length===report.operationCount;
    report.newSession=report.afterCursor[1]!==report.beforeCursor[1];report.revisionAdvanced=report.afterCursor[3]>report.beforeCursor[3];
    report.sameSourceEpoch=report.afterCursor[0]===report.beforeCursor[0];ensure(report.sameSourceEpoch,'SLEEP_CHANGED_SOURCE_EPOCH');
    report.stableUi=await app.page.evaluate(()=>window.r08StableUi);const nonlive=report.stableUi.filter(n=>n.at>=Date.parse(report.wakeAt)&&n.connection!=='live');
    report.nonliveResumeUi=nonlive.length?'OBSERVED':'NOT_OBSERVED';ensure(nonlive.every(n=>n.createDisabled===true),'NONLIVE_RESUME_UI_WRITABLE');
    ensure(report.fullTreeEquivalent&&report.noOperationReplay,'POST_SLEEP_TREE_OR_OPERATIONS_MISMATCH');ensure(report.newSession&&report.revisionAdvanced,'NO_FULL_RECONCILE_AFTER_REAL_SLEEP');
    await expect(app.page.getByRole('listbox').getByRole('option').first()).toBeVisible();await screenshot('after-real-sleep');ensure(report.errors.length===0,'PAGE_ERRORS');report.status='PASS';
  }
}catch(error){if(error.message!=='MANUAL_SLEEP_PENDING'){report.status='FAIL';report.failedStage=stage;report.failureCode=/^[A-Z][A-Z0-9_:.-]+$/.test(error.message)?error.message:'SYSTEM_INSTRUMENTATION_OR_ASSERTION_FAILED';process.exitCode=1;}}
finally{if(app){try{await cleanCredentials(app);report.temporaryCredentialsRemoved=true;}catch{report.temporaryCredentialsRemoved=false;report.status='FAIL';process.exitCode=1;}}if(chrome)await chrome.close();if(app)await app.close();report.finishedAt=new Date().toISOString();await writeFile(join(evidence,`native-system-${mode}-${runId}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,runId,mode,failedStage:report.failedStage,failureCode:report.failureCode,actual150:report.actual150,crossDifferentDpi:report.crossDifferentDpi}));}
