// Controlled remote page for actual preview-* isolation. Never reads user data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repo, until, ensure } from './native-driver.mjs';

export async function startProbe() {
  const main = await readFile(join(repo, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
  const handlers = main.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  ensure(!!handlers, 'HANDLER_LIST_MISSING');
  const commands = handlers.split(',').map(name => name.trim()).filter(Boolean);
  ensure(commands.every(name => /^[a-z_]+$/.test(name)), 'INVALID_HANDLER_NAME');
  const reports = [], hits = [];
  let pending = null, sequence = 0;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>R08 隔离网页</title>
<style>body{font:18px system-ui;margin:48px;color:#182231;background:#f3f6fb}main{max-width:600px}p{line-height:1.7}</style>
<main id="r08-probe"><h1>R08 独立网页预览</h1><p>这是本次验收专用的本机页面。页面可以运行自己的脚本，但不能调用签桥命令或读取主窗口会话。</p><a href="/a2">第二页</a></main>
<script>
const commands=${JSON.stringify(commands)};
function snapshot(){return {path:location.pathname,local:localStorage.getItem('r08'),cookie:document.cookie,main:localStorage.getItem('r08-main')};}
async function report(data){await fetch('/report',{method:'POST',body:JSON.stringify(data)});}
report({kind:'hello',...snapshot()});
let busy=false;
setInterval(async()=>{
 if(busy)return;busy=true;
 try{
  const job=await(await fetch('/next',{cache:'no-store'})).json();if(!job)return;
  if(job.action==='invoke'){
   const results=[];
   for(const name of commands){
    const invoke=window.__TAURI_INTERNALS__?.invoke;
    if(typeof invoke!=='function'){results.push({name,outcome:'NO_IPC'});continue;}
    try{await Promise.race([invoke(name,{}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),1500))]);results.push({name,outcome:'ACCEPTED'});}
    catch(error){const text=String(error?.message??error);results.push({name,outcome:text.includes('not allowed')?'DENIED':text==='TIMEOUT'?'TIMEOUT':'OTHER_ERROR'});}
   }
   await report({kind:'job',id:job.id,results});
  }else if(job.action==='store'){
   localStorage.setItem('r08',job.value);document.cookie='r08='+job.value+'; path=/; max-age=86400';await report({kind:'job',id:job.id,...snapshot()});
  }else if(job.action==='read')await report({kind:'job',id:job.id,...snapshot()});
  else if(job.action==='go'){await report({kind:'job',id:job.id});location.href=job.path;}
  else if(job.action==='popup'){window.open('/popup','_blank','noopener');await report({kind:'job',id:job.id});}
  else if(job.action==='scheme'||job.action==='file'){const target=job.action==='scheme'?'javascript:void(0)':'file:///C:/markbridge-r08-nonexistent.txt';location.href=target;const link=document.createElement('a');link.href=target;link.textContent='R08 navigation probe';document.body.appendChild(link);link.click();await report({kind:'job',id:job.id});}
  else if(job.action==='userinfo'){await report({kind:'job',id:job.id});location.href='http://r08:r08@127.0.0.1:'+location.port+'/userinfo';}
  else if(job.action==='download'){await report({kind:'job',id:job.id});location.href='/download.bin';}
 }catch{}finally{busy=false;}
},100);
</script></html>`;
  const server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    response.setHeader('cache-control', 'no-store');
    if (path === '/next') { response.setHeader('content-type','application/json'); response.end(JSON.stringify(pending)); pending = null; return; }
    if (path === '/report' && request.method === 'POST') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => { try { reports.push(JSON.parse(Buffer.concat(chunks).toString())); } catch {} response.end('ok'); });
      return;
    }
    hits.push(path);
    if (path === '/download.bin') { response.setHeader('content-type','application/octet-stream'); response.setHeader('content-disposition','attachment; filename="r08.bin"'); response.end('R08 isolated download probe'); return; }
    response.setHeader('content-type','text/html; charset=utf-8'); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, reports, hits, commands,
    async job(action, fields = {}) {
      ensure(!pending, 'PROBE_JOB_ALREADY_PENDING');
      const id = ++sequence; pending = { action, ...fields, id };
      return until(() => reports.find(report => report.kind === 'job' && report.id === id), 'PROBE_JOB_TIMEOUT', 15000);
    },
    hello(path, since = 0) { return until(() => reports.slice(since).find(report => report.kind === 'hello' && report.path === path), 'PROBE_PAGE_NOT_READY'); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
