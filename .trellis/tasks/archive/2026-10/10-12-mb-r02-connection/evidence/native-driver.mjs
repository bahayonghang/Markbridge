// Task-local isolated native test driver. Never points at a daily Chrome profile.
import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const repo = resolve(import.meta.dirname, '../../../../../..');
export const evidence = import.meta.dirname;
const run = promisify(execFile);
export async function extensionHash() {
  const hash = createHash('sha256');
  const directory = join(repo, 'apps/extension/dist');
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  for (const path of paths) { hash.update(path.slice(directory.length)); hash.update(await readFile(path)); }
  return hash.digest('hex');
}
export async function until(probe, code, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await delay(100);
  }
  throw new Error(code);
}
export async function availablePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
export async function launchDesktop() {
  const root = await mkdtemp(join(tmpdir(), 'markbridge-r02-native-'));
  const port = await availablePort();
  const exe = join(repo, 'target/release/markbridge-desktop.exe');
  const hash = createHash('sha256').update(await readFile(exe)).digest('hex');
  const child = spawn(exe, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env,
    MARKBRIDGE_APP_DATA: join(root, 'app-data'),
    MARKBRIDGE_CREDENTIAL_NAMESPACE: `Markbridge.Task05.r02-${Date.now()}`,
    WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  } });
  let browser;
  const handle = { root, child, hash, async close() {
    try {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, '.trellis/tasks/archive/2026-10/10-12-mb-r01-shell/evidence/native-window.ps1'), '-TargetProcessId', String(child.pid), '-Close'], { windowsHide: true });
      await until(() => child.exitCode !== null, 'NATIVE_CLOSE_TIMEOUT', 10000);
    } catch { child.kill(); }
    if (browser) await browser.close().catch(() => {});
  } };
  try {
    const version = await until(async () => {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (!targets.some((target) => target.type === 'page' && target.url)) return null;
        return (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      } catch { return null; }
    }, 'WEBVIEW_START_TIMEOUT');
    browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
    const page = await until(() => browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().includes('tauri.localhost')), 'NATIVE_PAGE_TIMEOUT');
    await page.getByRole('heading', { name: '书签', exact: true, level: 1 }).waitFor();
    return { ...handle, page, webviewVersion: version.Browser,
      async resize(width, height) {
        const scale = await page.evaluate(() => devicePixelRatio);
        await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, '.trellis/tasks/archive/2026-10/10-12-mb-r01-shell/evidence/native-window.ps1'), '-TargetProcessId', String(child.pid), '-ClientWidth', String(Math.round(width * scale)), '-ClientHeight', String(Math.round(height * scale))], { windowsHide: true });
        await until(() => page.evaluate(({ width, height }) => innerWidth === width && innerHeight === height, { width, height }), 'RESIZE_TIMEOUT');
      },
      state: () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_bridge_state')),
      async cleanCredentials() {
        await page.evaluate(async () => {
          const invoke = window.__TAURI_INTERNALS__.invoke;
          const state = await invoke('get_bridge_state');
          for (const pending of state.pending) await invoke('cancel_pairing', { profileId: pending.profileId });
          for (const profile of state.profiles) await invoke('revoke_pairing', { profileId: profile.profileId });
        });
      },
    };
  } catch (error) { await handle.close(); throw error; }
}

export async function launchChrome(directory) {
  const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
      else request.resolve(message.result);
    }
  });
  child.on('exit', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('TEST_CHROME_EXIT')); } pending.clear(); });
  const client = { child, directory, call(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolveReply, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_${method}_TIMEOUT`)); }, 30000);
      pending.set(id, { resolve: resolveReply, reject, timeout, method });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }, async close() {
    if (child.exitCode !== null) return;
    try { await client.call('Browser.close'); await until(() => child.exitCode !== null, 'CHROME_CLOSE_TIMEOUT', 10000); }
    catch { child.kill(); }
  } };
  try {
    client.version = (await client.call('Browser.getVersion')).product;
    client.extensionId = (await client.call('Extensions.loadUnpacked', { path: join(repo, 'apps/extension/dist') })).id;
    const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
    const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
    await client.call('Runtime.enable', {}, sessionId);
    client.evaluate = async (expression) => {
      const result = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error('EXTENSION_EVALUATION_FAILED');
      return result.result.value;
    };
    await until(() => client.evaluate('!!document.querySelector("#pairing-code")'), 'OPTIONS_TIMEOUT');
    return client;
  } catch (error) { await client.close(); throw error; }
}
