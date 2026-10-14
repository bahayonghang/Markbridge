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
const root=await mkdtemp(join(tmpdir(),'markbridge-task13-native-s03-'));
const runId=`run-${Date.now()}-${randomUUID().slice(0,8)}`;
const output=join(import.meta.dirname,'native',runId);
await mkdir(output,{recursive:true}); await mkdir(join(root,'install')); await mkdir(join(root,'exports'));
const executable=join(root,'install/markbridge-desktop.exe');
await copyFile(join(repo,'target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe'),executable);
const exe=await readFile(executable),invokeHelper=promisify(execFile);
const sourceFingerprint=JSON.parse(await readFile(join(import.meta.dirname,'current-source.json'),'utf8'));
const result={runId,startedAt:new Date().toISOString(),os:version(),root,executable,appData:join(root,'app-data'),productionSourceFingerprint:sourceFingerprint.productionFingerprint,exeBytes:exe.length,exeSha256:createHash('sha256').update(exe).digest('hex'),controls:[],screens:[]};
let app,chrome,stage='launch';
const namespace=`Markbridge.Task06.s03-${randomUUID()}`;
const preferenceKey='markbridge.ui-preferences.v1';
const observedCommands=[];
const pass=(name,detail={})=>{result.controls.push({name,status:'PASS',...detail});console.log(JSON.stringify({name,status:'PASS'}));};
async function listGeometry(){
  return app.page.evaluate(()=>{
    const list=document.querySelector('[role="listbox"]');
    if(!list)return null;
    const box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const last=list.querySelector('[aria-posinset="120"]');
    return {scrollTop:list.scrollTop,clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,list:box(list),last:last?box(last):null,activeDescendant:list.getAttribute('aria-activedescendant'),focusedRole:document.activeElement?.getAttribute('role')};
  });
}
async function windowState(width,height,path,monitorIndex){
  const scale=await app.page.evaluate(()=>devicePixelRatio);
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(import.meta.dirname,'native-window.ps1'),'-TargetProcessId',String(app.child.pid),'-IsolationRoot',root,'-MainTitle','Markbridge · 签桥'];
  if(width)args.push('-ClientWidth',String(Math.round(width*scale)),'-ClientHeight',String(Math.round(height*scale)));
  if(path)args.push('-OutPath',path);
  if(monitorIndex!==undefined)args.push('-MonitorIndex',String(monitorIndex));
  const observed=JSON.parse((await invokeHelper('powershell',args,{windowsHide:true,timeout:20000})).stdout.trim());
  if(width)await until(()=>app.page.evaluate(({width,height})=>innerWidth===width&&innerHeight===height,{width,height}),'NATIVE_RESIZE_MISMATCH');
  return observed;
}
const exports=()=>app.page.getByRole('region',{name:'备份导出',exact:true});
async function beginHtml(){await exports().getByRole('button',{name:'导出 HTML',exact:true}).click();await waitDialog(app);}
async function save(path){await dialog(app,'save',path);await expect(exports().getByText('文件已保存到所选位置。',{exact:true})).toBeVisible();return readFile(path,'utf8');}
try{
  app=await launchInstalled({root,installDirectory:join(root,'install'),executable,appData:result.appData,namespace});
  result.webview=app.webview;result.mainDataEvidence=app.mainDataEvidence;
  app.page.on('request',request=>{
    const url=new URL(request.url());
    if(url.hostname==='ipc.localhost'||url.protocol==='ipc:')observedCommands.push(url.pathname.slice(1));
  });
  await app.invoke('get_bridge_state');
  result.ipcObserver={method:'CDP network request paths only',verified:observedCommands.includes('get_bridge_state')};
  chrome=await launchChrome(root,'chrome-a','C:/Program Files/Google/Chrome/Application/chrome.exe');
  result.chromeVersion=chrome.version;result.chromeProfile=chrome.directory;
  const fixture=await chrome.evaluate(`(async()=>{const tree=await chrome.bookmarks.getTree();const bar=tree[0].children.find(node=>node.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'S03 临时验收'});let first;for(let i=0;i<120;i++){const node=await chrome.bookmarks.create({parentId:folder.id,title:'S03 Settings Reference '+String(i).padStart(3,'0'),url:'https://example.invalid/s03/reference/'+i});first??=node.id;}return {folder:folder.id,node:first};})()`);
  stage='pair'; const profileId=await pair(app,chrome,'S03 临时资料');
  pass('first_run_pairing_through_current_settings_real_ipc',{profileId});
  const mirrorRoot=join(root,'synthetic-file'); await mkdir(join(mirrorRoot,'Default'),{recursive:true});
  await writeFile(join(mirrorRoot,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'S03 只读资料'}}}}));
  await writeFile(join(mirrorRoot,'Default/Bookmarks'),JSON.stringify({version:1,roots:{bookmark_bar:{id:'1',name:'S03 文件夹',type:'folder',children:[{id:'10',name:'S03 Mirror Reference',type:'url',url:'https://example.invalid/s02/mirror'}]},other:{id:'2',name:'其他',type:'folder',children:[]},synced:{id:'3',name:'移动',type:'folder',children:[]}}}));
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
    for(const tab of ['通用','Chrome 连接','AI','语义检索','备份导出']){
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
  pass('six_sizes_five_tabs_native_geometry_and_vertical_focus',{screens:result.screens.length});
  stage='draft';await windowState(1100,760);
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await app.page.locator('#library-search').fill('S03 Settings');
  await app.page.getByRole('option',{name:/S03 Settings Reference 000/}).click();
  await app.page.getByRole('tab',{name:'标签备注',exact:true}).click();
  await app.page.getByLabel('备注',{exact:true}).fill('S03 未保存原生备注');
  const from=observedCommands.length;
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'AI',exact:true}).click();await app.page.getByLabel('模型',{exact:true}).fill('S03-unsaved-model');
  await app.page.getByRole('tab',{name:'语义检索',exact:true}).click();await app.page.getByLabel('向量模型',{exact:true}).fill('S03-unsaved-embedding');
  await app.page.getByRole('tab',{name:'备份导出',exact:true}).click();await app.page.getByRole('tab',{name:'AI',exact:true}).click();
  await expect(app.page.getByLabel('模型',{exact:true})).toHaveValue('S03-unsaved-model');
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await expect(app.page.locator('#library-search')).toHaveValue('S03 Settings');await expect(app.page.getByLabel('备注',{exact:true})).toHaveValue('S03 未保存原生备注');
  const commands=observedCommands.slice(from);
  if(result.ipcObserver.verified)ensure(!commands.some(command=>/^(suggest_ai|test_ai(?:_connection)?|content_preview|open_web_preview|semantic_(start_index|query|model_check|resume|delete_index)|propose_organization|assign_organization|check_links|confirm_cleanup|tag_command|apply_|enumerate_chrome|save_export|save_diagnostics|start_bridge|begin_pairing)/.test(command)),'NAVIGATION_CAUSED_EXTERNAL_EFFECT');
  pass('real_ipc_navigation_retains_drafts',{ipcObserverVerified:result.ipcObserver.verified,commands:result.ipcObserver.verified?commands:undefined});
  await app.page.getByLabel('备注',{exact:true}).fill('');
  await app.page.locator('#library-search').fill('');
  if(await app.page.getByRole('dialog').count())await app.page.getByRole('button',{name:'放弃草稿并继续'}).click();
  stage='export'; await app.page.getByRole('button',{name:'操作历史',exact:true}).click();await app.page.getByRole('button',{name:'备份导出',exact:true}).click();
  await expect(app.page.locator('#library-source')).toHaveValue(`profile:${profileId}`);
  await beginHtml();await dialog(app,'cancel');await expect(exports().getByText('已取消保存，没有生成文件。')).toBeVisible();
  await beginHtml();const html=await save(join(root,'exports/profile.html'));ensure(html.includes('S03 Settings Reference')&&html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'),'PROFILE_EXPORT_INVALID');
  pass('history_exports_current_profile_with_real_cancel_and_saved_file');
  await beginHtml();
  // Adversarial source switch while the OS dialog delays a real IPC reply.
  await app.page.locator('#library-source').evaluate((select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},`mirror:${mirror.mirrorSourceId}`);
  await expect(exports()).toContainText('只读文件缓存');await dialog(app,'cancel');
  await expect(exports().getByText('已取消保存，没有生成文件。')).toHaveCount(0);
  ensure(await exports().getByRole('button',{name:'导出侧车 JSON',exact:true}).count()===0,'MIRROR_HAS_SIDECAR_BUTTON');
  const rejected=await app.invoke('save_export',{source:{kind:'mirror',id:mirror.mirrorSourceId},format:'sidecar'});
  ensure(rejected.status==='failed'&&rejected.errorCode==='READ_ONLY'&&!(await dialog(app)).found,'MIRROR_SIDECAR_NOT_REJECTED');
  await beginHtml();const mirrorHtml=await save(join(root,'exports/mirror.html'));ensure(mirrorHtml.includes('S03 Mirror Reference'),'MIRROR_EXPORT_INVALID');
  pass('mirror_html_only_real_failed_readonly_receipt_and_late_previous_source_reply_ignored',{rejected});
  stage='appearance';await windowState(1440,900);
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(app.page.getByRole('tab',{name:'通用',exact:true})).toHaveAttribute('aria-selected','true');
  const callsFrom=observedCommands.length;
  await app.page.getByRole('button',{name:'深色',exact:true}).click();
  await app.page.getByLabel('字体',{exact:true}).selectOption('song');
  await app.page.getByLabel('字号',{exact:true}).selectOption('large');
  await expect(app.page.locator('html')).toHaveAttribute('data-theme','dark');
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await app.page.locator('#library-source').selectOption(`profile:${profileId}`);
  await app.page.locator('#library-search').fill('S03 Settings');
  await expect(app.page.getByRole('status').filter({hasText:'已加载 120 / 120'})).toBeVisible();
  result.typography=[];
  for(const font of ['system','yahei','song'])for(const fontSize of ['small','standard','large']){
    await app.page.getByRole('button',{name:'设置',exact:true}).click();
    await app.page.getByLabel('字体',{exact:true}).selectOption(font);
    await app.page.getByLabel('字号',{exact:true}).selectOption(fontSize);
    await app.page.getByRole('button',{name:'书签',exact:true}).click();
    const metrics=await app.page.evaluate(()=>({tree:document.querySelector('[role="tree"] .library-row').getBoundingClientRect().height,bookmark:document.querySelector('[role="listbox"] .library-row').getBoundingClientRect().height,text:getComputedStyle(document.documentElement).fontSize,family:getComputedStyle(document.body).fontFamily}));
    ensure(metrics.tree===(fontSize==='large'?48:40)&&metrics.bookmark===({small:48,standard:52,large:60})[fontSize]&&metrics.text===({small:'12px',standard:'13px',large:'15px'})[fontSize],'NATIVE_TYPOGRAPHY_ROW_HEIGHT_MISMATCH');
    result.typography.push({font,fontSize,...metrics});
  }
  pass('native_all_fonts_sizes_and_tree_bookmark_row_geometry',{measurements:result.typography.length});
  await app.page.getByRole('option',{name:/S03 Settings Reference 000/}).click();
  await app.page.getByRole('tab',{name:'标签备注',exact:true}).click();
  await app.page.getByLabel('备注',{exact:true}).fill('S03 未保存原生字号草稿');
  const list=app.page.getByRole('listbox',{name:'搜索结果',exact:true});
  await list.evaluate(node=>{node.scrollTop=30*60+11;});
  await expect.poll(()=>list.evaluate(node=>Math.abs(node.scrollTop-1811)<1)).toBe(true);
  const oldScroll=await list.evaluate(node=>node.scrollTop);
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByLabel('字号',{exact:true}).selectOption('standard');
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  const expectedScroll=Math.floor(oldScroll/60)*52+oldScroll%60;
  await expect.poll(()=>list.evaluate((node,expected)=>Math.abs(node.scrollTop-expected)<1,expectedScroll)).toBe(true);
  const newScroll=await list.evaluate(node=>node.scrollTop);
  await expect(app.page.getByLabel('备注',{exact:true})).toHaveValue('S03 未保存原生字号草稿');
  await expect(app.page.getByRole('checkbox',{name:'选择 S03 Settings Reference 000',exact:true})).toBeChecked();
  const row=app.page.getByRole('option',{name:/S03 Settings Reference 000/});
  await row.focus();await app.page.keyboard.press('End');
  await expect(app.page.getByRole('dialog',{name:'放弃未保存的本地草稿？'})).toBeVisible();
  await app.page.keyboard.press('Escape');
  await expect(app.page.getByLabel('备注',{exact:true})).toHaveValue('S03 未保存原生字号草稿');
  await row.focus();await app.page.keyboard.press('End');
  await app.page.getByRole('button',{name:'放弃草稿并继续'}).click();
  result.endNavigationGeometry=await listGeometry();
  const last=list.locator('[aria-posinset="120"]');await expect(last).toBeInViewport();
  await last.locator('input[type="checkbox"]').focus();await app.page.keyboard.press('Space');
  await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  await app.page.keyboard.press('Enter');await expect(last.locator('input[type="checkbox"]')).toBeFocused();
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByLabel('字号',{exact:true}).selectOption('large');
  await app.page.getByRole('button',{name:'书签',exact:true}).click();
  await expect(list.locator('[aria-posinset="120"]')).toBeInViewport();
  ensure(await last.evaluate(node=>node.getBoundingClientRect().height)===60,'NATIVE_LARGE_ROW_GEOMETRY');
  pass('native_hidden_library_anchor_draft_selection_last_item_and_checkbox',{oldScroll,newScroll,expectedScroll,anchorIndex:30,offset:oldScroll%60,toleranceCssPx:1,standardRow:52,largeRow:60});
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByRole('button',{name:'跟随系统'}).click();
  await app.page.emulateMedia({colorScheme:'light'});await expect(app.page.locator('html')).toHaveAttribute('data-theme','light');
  await app.page.emulateMedia({colorScheme:'dark'});await expect(app.page.locator('html')).toHaveAttribute('data-theme','dark');
  await app.page.getByRole('button',{name:'浅色',exact:true}).click();
  await app.page.emulateMedia({colorScheme:'dark'});await expect(app.page.locator('html')).toHaveAttribute('data-theme','light');
  await app.page.getByRole('button',{name:'深色',exact:true}).click();
  const preferences=await app.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),preferenceKey);
  ensure(preferences.theme==='dark'&&preferences.font==='song'&&preferences.fontSize==='large','NATIVE_PREFERENCES_NOT_SAVED');
  const preferenceCommands=observedCommands.slice(callsFrom);
  if(result.ipcObserver.verified)ensure(!preferenceCommands.some(command=>/^(suggest_ai|test_ai(?:_connection)?|content_preview|open_web_preview|semantic_(start_index|query|model_check|resume|delete_index)|propose_organization|assign_organization|check_links|confirm_cleanup|tag_command|apply_|save_ai|save_semantic)/.test(command)),'APPEARANCE_CAUSED_BUSINESS_EFFECT');
  pass('native_preferences_session_and_emulated_system_media',{preferences,ipcObserverVerified:result.ipcObserver.verified,commands:result.ipcObserver.verified?preferenceCommands:undefined,systemStimulus:'CDP emulated prefers-color-scheme, no OS preference changes'});
  stage='actual-dpi';result.displays=[];
  const inventory=await windowState();
  for(let index=0;index<inventory.monitors.length;index++){
    await windowState(undefined,undefined,undefined,index);
    await until(async()=>{const native=await windowState();return await app.page.evaluate(()=>devicePixelRatio)===native.dpi/96;},'NATIVE_DPI_DPR_MISMATCH');
    for(const theme of ['light','dark']){
      await app.page.getByRole('button',{name:theme==='light'?'浅色':'深色',exact:true}).click();
      for(const [width,height] of [[1100,760],[640,480]]){
        const os=await windowState(width,height);
        const geometry=await app.page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,text:getComputedStyle(document.documentElement).fontSize}));
        ensure(geometry.width===width&&geometry.height===height&&geometry.documentWidth===width&&geometry.documentHeight===height&&geometry.text==='15px'&&geometry.dpr===os.dpi/96,'NATIVE_DPI_LAYOUT_MISMATCH');
        await app.page.screenshot({path:join(output,`dpi-${os.dpi}-${theme}-large-${width}x${height}.png`)});
        await windowState(width,height,join(output,`owned-dpi-${os.dpi}-${theme}-${width}x${height}.png`));
        result.displays.push({theme,width,height,os,geometry});
      }
    }
  }
  ensure(result.displays.some(n=>n.os.dpi===120)&&result.displays.some(n=>n.os.dpi===144),'ACTUAL_125_150_DPI_NOT_AVAILABLE');
  pass('actual_125_and_150_percent_native_monitors_large_font',{displays:result.displays.length});
  stage='restart';result.firstClose=await app.close();
  ensure(result.firstClose.exitCode===0,'FIRST_PROCESS_EXIT_NOT_CONFIRMED');
  app=await launchInstalled({root,installDirectory:join(root,'install'),executable,appData:result.appData,namespace});
  result.restartWebview=app.webview;result.restartMainDataEvidence=app.mainDataEvidence;
  const restarted=await app.page.evaluate(key=>({preferences:JSON.parse(localStorage.getItem(key)),theme:document.documentElement.dataset.theme,font:document.documentElement.dataset.font,fontSize:document.documentElement.dataset.fontSize,family:getComputedStyle(document.body).fontFamily,text:getComputedStyle(document.documentElement).fontSize}),preferenceKey);
  ensure(restarted.preferences.theme==='dark'&&restarted.preferences.font==='song'&&restarted.preferences.fontSize==='large'&&restarted.theme==='dark'&&restarted.font==='song'&&restarted.fontSize==='large'&&restarted.text==='15px','ACTUAL_RESTART_PREFERENCES_LOST');
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(app.page.getByLabel('字体',{exact:true})).toHaveValue('song');
  await expect(app.page.getByLabel('字号',{exact:true})).toHaveValue('large');
  await app.page.screenshot({path:join(output,'true-restart-dark-song-large.png')});
  pass('true_native_process_exit_restart_persists_theme_font_size',{restarted});
  await app.page.getByRole('button',{name:'恢复默认外观'}).click();
  const restored=await app.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),preferenceKey);
  ensure(restored.theme==='system'&&restored.font==='system'&&restored.fontSize==='standard','NATIVE_RESET_FAILED');
  pass('native_reset_only_appearance');
  await app.page.getByRole('tab',{name:'Chrome 连接',exact:true}).click();await windowState(1440,900,join(output,'owned-window-1440x900.png'));
  result.status='PASS';
}catch(error){app??=error.fixtureApp;chrome??=error.fixtureChrome;result.status='FAIL';result.stage=stage;result.error=error.message;process.exitCode=1;if(app?.page){result.failureListGeometry=await listGeometry().catch(()=>null);await app.page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}}
finally{
  if(app){try{await cleanCredentials(app);}catch{result.credentialCleanup='FAILED';process.exitCode=1;result.status='FAIL';}}
  if(chrome){try{result.chromeClose=await chrome.close();}catch(error){result.closeError=error.message;result.chromeClose=chrome.lastCloseEvidence;result.status='FAIL';process.exitCode=1;}}
  if(app){try{result.appClose=await app.close();}catch(error){result.closeError=error.message;result.appClose=app.lastCloseEvidence;result.status='FAIL';process.exitCode=1;}}
  result.finalProcesses=await system('processes',root);
  if(result.finalProcesses.processes.length){result.status='FAIL';process.exitCode=1;}
  await writeFile(join(output,'result.json'),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify({runId,status:result.status,stage:result.stage,output}));
}
