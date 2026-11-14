// Task-local page generations prevent a closing preview from consuming another page's job.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repo, ensure, until } from './current-native-driver.mjs';

export async function startProbe() {
  const source = await readFile(join(repo, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
  const commands = source.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1].split(',').map(name => name.trim()).filter(Boolean);
  ensure(commands?.length > 0 && commands.every(name => /^[a-z_]+$/.test(name)), 'PROBE_HANDLER_LIST_INVALID');
  const reports = [];
  let pending = null, sequence = 0;
  const html = pageId => `<!doctype html><html><meta charset="utf-8"><title>Task13 isolated preview</title>
<style>body{font:18px system-ui;margin:48px;color:#182231;background:#f3f6fb}</style><h1>Task13 isolated preview</h1>
<script>
const pageId=${JSON.stringify(pageId)},commands=${JSON.stringify(commands)};
function snapshot(){return {path:location.pathname,pageId,local:localStorage.getItem('r08'),cookie:document.cookie,main:localStorage.getItem('r08-main')};}
async function report(value){await fetch('/report',{method:'POST',body:JSON.stringify({...value,...snapshot()})});}
report({kind:'hello'});
let busy=false;
setInterval(async()=>{if(busy)return;busy=true;try{
const job=await(await fetch('/next?path='+encodeURIComponent(location.pathname)+'&pageId='+pageId,{cache:'no-store'})).json();if(!job)return;
if(job.action==='store'){localStorage.setItem('r08',job.value);document.cookie='r08='+job.value+'; path=/; max-age=86400';await report({kind:'job',id:job.id});}
else if(job.action==='read')await report({kind:'job',id:job.id});
else if(job.action==='invoke'){const results=[];for(const name of commands){const invoke=window.__TAURI_INTERNALS__?.invoke;
if(typeof invoke!=='function'){results.push({name,outcome:'NO_IPC'});continue;}
try{await Promise.race([invoke(name,{}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),1500))]);results.push({name,outcome:'ACCEPTED'});}
catch(error){const text=String(error?.message??error);results.push({name,outcome:text.includes('not allowed')?'DENIED':text==='TIMEOUT'?'TIMEOUT':'OTHER_ERROR'});}}
await report({kind:'job',id:job.id,results});}
}catch{}finally{busy=false;}},100);
</script></html>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/next') {
      const matches = pending && pending.path === url.searchParams.get('path') && pending.pageId === url.searchParams.get('pageId');
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(matches ? pending : null));
      if (matches) pending = null;
      return;
    }
    if (url.pathname === '/report' && request.method === 'POST') {
      const chunks = []; let size = 0;
      request.on('data', chunk => { size += chunk.length; if (size <= 65536) chunks.push(chunk); });
      request.on('end', () => { if (size <= 65536) { try { reports.push(JSON.parse(Buffer.concat(chunks).toString())); } catch {} } response.end('ok'); });
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html(randomUUID()));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { base: `http://127.0.0.1:${server.address().port}`, reports, commands,
    hello(path, since) { return until(() => reports.slice(since).find(item => item.kind === 'hello' && item.path === path), 'PROBE_FRESH_PAGE_NOT_READY'); },
    async job(page, action, fields = {}) {
      ensure(!pending && page.pageId && page.path, 'PROBE_JOB_TARGET_INVALID');
      const id = ++sequence; pending = { action, ...fields, id, path: page.path, pageId: page.pageId };
      return until(() => reports.find(item => item.kind === 'job' && item.id === id && item.path === page.path && item.pageId === page.pageId), 'PROBE_CURRENT_PAGE_JOB_TIMEOUT', 15000);
    },
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); },
  };
}
