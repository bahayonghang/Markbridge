import { expect } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir, version } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let repo=resolve(import.meta.dirname);
while(!existsSync(join(repo,'pnpm-workspace.yaml'))){
  const parent=resolve(repo,'..');
  if(parent===repo)throw new Error('WORKSPACE_ROOT_NOT_FOUND');
  repo=parent;
}
const { launchInstalled, launchChrome, pair, cleanCredentials, dialog, waitDialog, system, until, ensure } = await import(pathToFileURL(join(repo,'.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs')).href);
const root=await mkdtemp(join(tmpdir(),'markbridge-task13-native-s02-'));
const runId=`run-${Date.now()}-${randomUUID().slice(0,8)}`;
const output=join(import.meta.dirname,'native',runId);
await mkdir(output,{recursive:true}); await mkdir(join(root,'install')); await mkdir(join(root,'exports'));
const executable=join(root,'install/markbridge-desktop.exe');
await copyFile(join(repo,'target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe'),executable);
const exe=await readFile(executable),invokeHelper=promisify(execFile);
const sourceFingerprint=JSON.parse(await readFile(join(import.meta.dirname,'current-source.json'),'utf8'));
const result={runId,startedAt:new Date().toISOString(),os:version(),root,executable,appData:join(root,'app-data'),productionSourceFingerprint:sourceFingerprint.productionFingerprint,exeBytes:exe.length,exeSha256:createHash('sha256').update(exe).digest('hex'),controls:[],screens:[]};
let app,chrome,stage='launch';
const observedCommands=[];
const pass=(name,detail={})=>{result.controls.push({name,status:'PASS',...detail});console.log(JSON.stringify({name,status:'PASS'}));};
async function windowState(width,height,path){
  const scale=await app.page.evaluate(()=>devicePixelRatio);
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(import.meta.dirname,'native-window.ps1'),'-TargetProcessId',String(app.child.pid),'-IsolationRoot',root,'-MainTitle','Markbridge · 签桥'];
  if(width)args.push('-ClientWidth',String(Math.round(width*scale)),'-ClientHeight',String(Math.round(height*scale)));
  if(path)args.push('-OutPath',path);
  const observed=JSON.parse((await invokeHelper('powershell',args,{windowsHide:true,timeout:20000})).stdout.trim());
  if(width)await until(()=>app.page.evaluate(({width,height})=>innerWidth===width&&innerHeight===height,{width,height}),'NATIVE_RESIZE_MISMATCH');
  return observed;
}
const exports=()=>app.page.getByRole('region',{name:'备份导出',exact:true});
async function beginHtml(){await exports().getByRole('button',{name:'导出 HTML',exact:true}).click();await waitDialog(app);}
async function save(path){await dialog(app,'save',path);await expect(exports().getByText('文件已保存到所选位置。',{exact:true})).toBeVisible();return readFile(path,'utf8');}
try{
  app=await launchInstalled({root,installDirectory:join(root,'install'),executable,appData:result.appData,namespace:`Markbridge.Task06.s02-${randomUUID()}`});
  result.webview=app.webview;result.mainDataEvidence=app.mainDataEvidence;
  app.page.on('request',request=>{
    const url=new URL(request.url());
    if(url.hostname==='ipc.localhost'||url.protocol==='ipc:')observedCommands.push(url.pathname.slice(1));
  });
  await app.invoke('get_bridge_state');
  result.ipcObserver={method:'CDP network request paths only',verified:observedCommands.includes('get_bridge_state')};
  chrome=await launchChrome(root,'chrome-a','C:/Program Files/Google/Chrome/Application/chrome.exe');
  result.chromeVersion=chrome.version;result.chromeProfile=chrome.directory;
  const fixture=await chrome.evaluate(`(async()=>{const tree=await chrome.bookmarks.getTree();const bar=tree[0].children.find(node=>node.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'S02 临时验收'});const node=await chrome.bookmarks.create({parentId:folder.id,title:'S02 Settings Reference',url:'https://example.invalid/s02/reference'});return {folder:folder.id,node:node.id};})()`);
  stage='pair'; const profileId=await pair(app,chrome,'S02 临时资料');
  pass('first_run_pairing_through_current_settings_real_ipc',{profileId});
  const mirrorRoot=join(root,'synthetic-file'); await mkdir(join(mirrorRoot,'Default'),{recursive:true});
  await writeFile(join(mirrorRoot,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'S02 只读资料'}}}}));
  await writeFile(join(mirrorRoot,'Default/Bookmarks'),JSON.stringify({version:1,roots:{bookmark_bar:{id:'1',name:'S02 文件夹',type:'folder',children:[{id:'10',name:'S02 Mirror Reference',type:'url',url:'https://example.invalid/s02/mirror'}]},other:{id:'2',name:'其他',type:'folder',children:[]},synced:{id:'3',name:'移动',type:'folder',children:[]}}}));
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'Chrome 连接',exact:true}).click();
  await app.page.getByText('选择只读文件目录',{exact:true}).click();
  await app.page.locator('#user-data-path').fill(mirrorRoot); await app.page.getByRole('button',{name:'枚举资料',exact:true}).click();
  await app.page.getByRole('button',{name:'接入只读镜像',exact:true}).click();
  const mirror=await until(async()=> (await app.invoke('get_bridge_state')).mirrors[0],'MIRROR_NOT_ATTACHED');
  stage='geometry';
  for(const [width,height] of [[1440,900],[1100,760],[640,760],[1100,480],[640,480],[1920,1080]]){
    const os=await windowState(width,height);
    await app.page.getByRole('tab',{name:'备份导出',exact:true}).click();
    for(const tab of ['Chrome 连接','AI','语义检索','备份导出']){
      await app.page.getByRole('tab',{name:tab,exact:true}).click();
      const panel=app.page.getByRole('tabpanel',{name:tab,exact:true});await expect(panel).toBeVisible();
      const geometry=await app.page.evaluate(()=>{const box=selector=>{const node=document.querySelector(selector),rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},tabs:box('.settings-tabs'),content:box('.settings-scroll'),bodyWidth:document.documentElement.scrollWidth,bodyHeight:document.documentElement.scrollHeight,scrollTop:document.querySelector('.settings-scroll').scrollTop};});
      result.lastGeometry={tab,width,height,os,geometry};
      ensure(geometry.bodyWidth===width&&geometry.bodyHeight===height&&geometry.scrollTop===0,'NATIVE_LAYOUT_OVERFLOW_OR_OLD_SCROLL');
      ensure(geometry.tabs.x+geometry.tabs.width<=geometry.content.x,'NATIVE_SIDEBAR_OVERLAP');
      ensure(Math.round(width*geometry.viewport.devicePixelRatio)===os.clientWidth,'NATIVE_PHYSICAL_CLIENT_MISMATCH');
      const path=join(output,`${tab}-${width}x${height}.png`);await app.page.screenshot({path});
      result.screens.push({tab,width,height,os,geometry});
    }
  }
  await app.page.getByRole('tab',{name:'Chrome 连接',exact:true}).click();await windowState(640,480,join(output,'owned-window-640x480.png'));
  const tab=app.page.getByRole('tab',{name:'Chrome 连接',exact:true});await tab.focus();await app.page.keyboard.press('ArrowDown');
  await expect(app.page.getByRole('tab',{name:'AI',exact:true})).toBeFocused();await app.page.keyboard.press('Tab');await expect(app.page.getByRole('tabpanel',{name:'AI',exact:true})).toBeFocused();
  pass('six_sizes_four_tabs_native_geometry_and_vertical_focus',{screens:result.screens.length});
  stage='draft';await windowState(1100,760);
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await app.page.locator('#library-search').fill('S02 Settings');
  await app.page.getByRole('option',{name:/S02 Settings Reference/}).click();
  await app.page.getByRole('tab',{name:'标签备注',exact:true}).click();
  await app.page.getByLabel('备注',{exact:true}).fill('S02 未保存原生备注');
  const from=observedCommands.length;
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'AI',exact:true}).click();await app.page.getByLabel('模型',{exact:true}).fill('S02-unsaved-model');
  await app.page.getByRole('tab',{name:'语义检索',exact:true}).click();await app.page.getByLabel('向量模型',{exact:true}).fill('S02-unsaved-embedding');
  await app.page.getByRole('tab',{name:'备份导出',exact:true}).click();await app.page.getByRole('tab',{name:'AI',exact:true}).click();
  await expect(app.page.getByLabel('模型',{exact:true})).toHaveValue('S02-unsaved-model');
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await expect(app.page.locator('#library-search')).toHaveValue('S02 Settings');await expect(app.page.getByLabel('备注',{exact:true})).toHaveValue('S02 未保存原生备注');
  const commands=observedCommands.slice(from);
  if(result.ipcObserver.verified)ensure(!commands.some(command=>/^(suggest_ai|test_ai(?:_connection)?|content_preview|open_web_preview|semantic_(start_index|query|model_check|resume|delete_index)|propose_organization|assign_organization|check_links|confirm_cleanup|tag_command|apply_|enumerate_chrome|save_export|save_diagnostics|start_bridge|begin_pairing)/.test(command)),'NAVIGATION_CAUSED_EXTERNAL_EFFECT');
  pass('real_ipc_navigation_retains_drafts',{ipcObserverVerified:result.ipcObserver.verified,commands:result.ipcObserver.verified?commands:undefined});
  await app.page.getByLabel('备注',{exact:true}).fill('');
  await app.page.locator('#library-search').fill('');
  if(await app.page.getByRole('dialog').count())await app.page.getByRole('button',{name:'放弃草稿并继续'}).click();
  stage='export'; await app.page.getByRole('button',{name:'操作历史',exact:true}).click();await app.page.getByRole('button',{name:'备份导出',exact:true}).click();
  await expect(app.page.locator('#library-source')).toHaveValue(`profile:${profileId}`);
  await beginHtml();await dialog(app,'cancel');await expect(exports().getByText('已取消保存，没有生成文件。')).toBeVisible();
  await beginHtml();const html=await save(join(root,'exports/profile.html'));ensure(html.includes('S02 Settings Reference')&&html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'),'PROFILE_EXPORT_INVALID');
  pass('history_exports_current_profile_with_real_cancel_and_saved_file');
  await beginHtml();
  // Adversarial source switch while the OS dialog delays a real IPC reply.
  await app.page.locator('#library-source').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},`mirror:${mirror.mirrorSourceId}`);
  await expect(exports()).toContainText('只读文件缓存');await dialog(app,'cancel');
  await expect(exports().getByText('已取消保存，没有生成文件。')).toHaveCount(0);
  ensure(await exports().getByRole('button',{name:'导出侧车 JSON',exact:true}).count()===0,'MIRROR_HAS_SIDECAR_BUTTON');
  const rejected=await app.invoke('save_export',{source:{kind:'mirror',id:mirror.mirrorSourceId},format:'sidecar'});
  ensure(rejected.status==='failed'&&rejected.errorCode==='READ_ONLY'&&!(await dialog(app)).found,'MIRROR_SIDECAR_NOT_REJECTED');
  await beginHtml();const mirrorHtml=await save(join(root,'exports/mirror.html'));ensure(mirrorHtml.includes('S02 Mirror Reference'),'MIRROR_EXPORT_INVALID');
  pass('mirror_html_only_real_failed_readonly_receipt_and_late_previous_source_reply_ignored',{rejected});
  await app.page.getByRole('tab',{name:'Chrome 连接',exact:true}).click();await windowState(1440,900,join(output,'owned-window-1440x900.png'));
  result.status='PASS';
}catch(error){app??=error.fixtureApp;chrome??=error.fixtureChrome;result.status='FAIL';result.stage=stage;result.error=error.message;process.exitCode=1;if(app?.page)await app.page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
finally{
  if(app){try{await cleanCredentials(app);}catch{result.credentialCleanup='FAILED';process.exitCode=1;result.status='FAIL';}}
  if(chrome){try{result.chromeClose=await chrome.close();}catch(error){result.closeError=error.message;result.chromeClose=chrome.lastCloseEvidence;result.status='FAIL';process.exitCode=1;}}
  if(app){try{result.appClose=await app.close();}catch(error){result.closeError=error.message;result.appClose=app.lastCloseEvidence;result.status='FAIL';process.exitCode=1;}}
  result.finalProcesses=await system('processes',root);
  if(result.finalProcesses.processes.length){result.status='FAIL';process.exitCode=1;}
  await writeFile(join(output,'result.json'),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify({runId,status:result.status,stage:result.stage,output}));
}
