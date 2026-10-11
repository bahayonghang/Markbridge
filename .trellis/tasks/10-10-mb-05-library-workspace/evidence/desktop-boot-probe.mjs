import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../../../..');
const root = await mkdtemp(join(tmpdir(), 'mb05-boot-'));
const appData = join(root, 'app-data');
const webviewData = join(root, 'webview');
let stderr = '';
const child = spawn(resolve(repo, 'target/release/markbridge-desktop.exe'), [], {
  env: {
    ...process.env,
    MARKBRIDGE_APP_DATA: appData,
    MARKBRIDGE_CREDENTIAL_NAMESPACE: 'Markbridge.Task05.boot-probe',
    WEBVIEW2_USER_DATA_FOLDER: webviewData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9345 --remote-allow-origins=*',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: false,
});
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
const facts = { targets: null, page: null };
try {
  const started = Date.now();
  while (Date.now() - started < 12_000) {
    try {
      const list = await fetch('http://127.0.0.1:9345/json/list').then((response) => response.json());
      facts.targets = list.map((item) => ({ type: item.type, url: String(item.url ?? '').slice(0, 120) }));
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolveOpen, reject) => {
          socket.addEventListener('open', () => resolveOpen());
          socket.addEventListener('error', () => reject(new Error('SOCKET')));
        });
        const result = await new Promise((resolveResult, reject) => {
          socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data.toString());
            if (message.id === 1) resolveResult(message.result);
          });
          socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `({ hasPort: Boolean(document.getElementById('bridge-port')), disabled: document.getElementById('bridge-port')?.disabled ?? null, startup: document.body?.innerText?.includes('无法读取启动状态') === true, length: document.body?.innerText?.length ?? 0 })`, returnByValue: true } }));
          setTimeout(() => reject(new Error('EVAL')), 3000);
        });
        facts.page = result?.result?.value ?? result;
        socket.close();
        if (facts.page?.hasPort && facts.page.disabled === false) break;
      }
    } catch { /* debugger not ready */ }
    await delay(250);
  }
} finally {
  if (child.exitCode == null) {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolveStop());
    });
  }
  await delay(400);
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
process.stdout.write(`${JSON.stringify({ facts, stderr: stderr.slice(0, 400), exit: child.exitCode })}\n`);
