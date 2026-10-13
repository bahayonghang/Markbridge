// R06 real desktop/extension tests use disposable data and credentials only.
import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, release, version } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { availablePort, extensionHash } from '../../10-12-mb-r02-connection/evidence/native-driver.mjs';
export { launchChrome } from './native-chrome.mjs';
export { availablePort };
export const repo = resolve(import.meta.dirname, '../../../../../..');
export const evidence = import.meta.dirname;
const run = promisify(execFile);
const helper = join(repo, '.trellis/tasks/archive/2026-10/10-12-mb-r01-shell/evidence/native-window.ps1');
export function ensure(condition, code) { if (!condition) throw new Error(code); }
export function fixtureRoot() { return mkdtemp(join(tmpdir(), 'markbridge-r06-native-')); }
export async function until(probe, code, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await delay(40); }
  throw new Error(code);
}
export async function environment() {
  const exe = join(repo, 'target/release/markbridge-desktop.exe');
  return { os: version(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version,
    exeBytes: (await stat(exe)).size, exeSha256: createHash('sha256').update(await readFile(exe)).digest('hex'), extensionHash: await extensionHash() };
}
export async function launch(root) {
  ensure(resolve(root, '..') === resolve(tmpdir()) && basename(root).startsWith('markbridge-r06-native-'), 'NON_ISOLATED_ROOT');
  ensure((await readFile(join(repo, 'target/release/markbridge-desktop.exe'))).includes(Buffer.from('main-webview')), 'REBUILD_FOR_ISOLATED_MAIN_REQUIRED');
  const port = await availablePort();
  const env = {
    ...process.env, MARKBRIDGE_APP_DATA: join(root, 'app-data'), MARKBRIDGE_CREDENTIAL_NAMESPACE: `Markbridge.Task06.r06-${basename(root)}`,
    MARKBRIDGE_OPEN_HTTP_SUSPEND: '1', MARKBRIDGE_OPEN_HTTP_PIDFILE: join(root, 'suspended-opener.pid'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  };
  // Main uses MARKBRIDGE_APP_DATA/main-webview; preview owns its per-profile directory.
  delete env.WEBVIEW2_USER_DATA_FOLDER;
  const child = spawn(join(repo, 'target/release/markbridge-desktop.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env });
  let browser;
  const close = async () => {
    try { await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetProcessId', String(child.pid), '-Close'], { windowsHide: true }); await until(() => child.exitCode !== null, 'CLOSE_TIMEOUT', 10000); }
    catch { child.kill(); }
    if (browser) await browser.close().catch(() => {});
  };
  try {
    const runtime = await until(async () => {
      try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (!targets.some(target => target.type === 'page' && target.url)) return null; return (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
      catch { return null; }
    }, 'WEBVIEW_START_TIMEOUT');
    browser = await chromium.connectOverCDP(runtime.webSocketDebuggerUrl);
    const page = await until(() => browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('tauri.localhost')), 'NATIVE_PAGE_TIMEOUT');
    await page.getByRole('heading', { name: '书签', exact: true, level: 1 }).waitFor();
    return { page, root, child, close, webview: runtime.Browser,
      async invoke(command, args = {}, captureError = false) {
        return page.evaluate(({ command, args, captureError }) => window.__TAURI_INTERNALS__.invoke(command, args).catch(error => { if (captureError) return { error }; throw error; }), { command, args, captureError });
      },
      async resize(width, height) {
        const scale = await page.evaluate(() => devicePixelRatio);
        await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetProcessId', String(child.pid), '-ClientWidth', String(Math.round(width * scale)), '-ClientHeight', String(Math.round(height * scale))], { windowsHide: true });
        await until(() => page.evaluate(size => innerWidth === size.width && innerHeight === size.height, { width, height }), 'RESIZE_TIMEOUT');
      },
    };
  } catch (error) { await close(); throw error; }
}
export async function pair(app, chrome, displayName = 'R06 临时在线') {
  await app.page.getByRole('button', { name: '设置', exact: true }).click();
  await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
  const state = () => app.invoke('get_bridge_state');
  if (!(await state()).port) {
    if (!await app.page.locator('#bridge-port').isVisible()) await app.page.locator('details:has(#bridge-port)>summary').click();
    await app.page.locator('#bridge-port').fill(String(await availablePort()));
    await app.page.getByRole('button', { name: '启动连接', exact: true }).click();
    await until(async () => (await state()).port, 'LISTENER_NOT_READY');
  }
  await app.page.locator('#profile-name').fill(displayName);
  await app.page.getByRole('button', { name: '生成配对串', exact: true }).click();
  let ticket = await app.page.locator('#pairing-code').inputValue();
  await chrome.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(ticket)};document.querySelector('#pair').click();true`);
  ticket = '';
  const pending = await until(async () => (await state()).pending.find(item => item.displayName === displayName && item.instanceId), 'PAIRING_NOT_PENDING');
  await app.page.getByRole('button', { name: '确认此扩展', exact: true }).click();
  await until(async () => (await state()).profiles.some(item => item.profileId === pending.profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE');
  await app.page.getByRole('button', { name: '书签', exact: true }).click();
  await app.page.locator('#library-source').selectOption(`profile:${pending.profileId}`);
  return pending.profileId;
}
export async function cleanCredentials(app) {
  const state = await app.invoke('get_bridge_state');
  for (const pending of state.pending) await app.invoke('cancel_pairing', { profileId: pending.profileId });
  for (const profile of state.profiles) await app.invoke('revoke_pairing', { profileId: profile.profileId });
}
export async function workerRuntime(chrome) {
  const target = await until(async () => (await chrome.call('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${chrome.extensionId}/`)), 'WORKER_NOT_FOUND');
  const { sessionId } = await chrome.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await chrome.call('Runtime.enable', {}, sessionId);
  return { async evaluate(expression) {
    const result = await chrome.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    ensure(!result.exceptionDetails, 'WORKER_EVALUATION_FAILED');
    return result.result.value;
  }, async close() { await chrome.call('Target.detachFromTarget', { sessionId }); } };
}
