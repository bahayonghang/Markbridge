// R03 task-local native acceptance. Rust seeds only a disposable application cache.
import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, release, version } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const repo = resolve(import.meta.dirname, '../../../../../..');
export const evidence = import.meta.dirname;
const run = promisify(execFile);
const windowHelper = join(repo, '.trellis/tasks/archive/2026-10/10-12-mb-r01-shell/evidence/native-window.ps1');
export async function until(probe, code, timeout = 30000, interval = 25) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await delay(interval); }
  throw new Error(code);
}
export async function fixtureRoot(nodes) {
  const root = await mkdtemp(join(tmpdir(), 'markbridge-r03-native-'));
  const file = join(root, 'nodes.json');
  await writeFile(file, JSON.stringify(nodes));
  await run(join(repo, 'target/debug/examples/seed_profile_cache.exe'), [join(root, 'app-data/markbridge.sqlite'), file], { windowsHide: true });
  return root;
}
export function protocolNode(node) {
  return { ...node, folderType: node.folderType ?? null, unmodifiable: node.unmodifiable ?? null, dateAdded: node.dateAdded ?? null, dateLastUsed: node.dateLastUsed ?? null };
}
export async function environment() {
  const exe = join(repo, 'target/release/markbridge-desktop.exe');
  return { os: version(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version,
    exeBytes: (await stat(exe)).size, exeSha256: createHash('sha256').update(await readFile(exe)).digest('hex') };
}
export async function launch(root) {
  if (resolve(root, '..') !== resolve(tmpdir()) || !basename(root).startsWith('markbridge-r03-native-')) throw new Error('NON_ISOLATED_ROOT');
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  const started = performance.now();
  const child = spawn(join(repo, 'target/release/markbridge-desktop.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env,
    MARKBRIDGE_APP_DATA: join(root, 'app-data'),
    MARKBRIDGE_CREDENTIAL_NAMESPACE: `Markbridge.Task05.r03-${basename(root)}`,
    WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  } });
  let browser;
  const close = async () => {
    try {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-TargetProcessId', String(child.pid), '-Close'], { windowsHide: true });
      await until(() => child.exitCode !== null, 'CLOSE_TIMEOUT', 10000);
    } catch { child.kill(); }
    if (browser) await browser.close().catch(() => {});
  };
  try {
    const version = await until(async () => {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (!targets.some(target => target.type === 'page' && target.url)) return null;
        return (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      } catch { return null; }
    }, 'WEBVIEW_START_TIMEOUT');
    browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
    const page = await until(() => browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('tauri.localhost')), 'PAGE_TIMEOUT');
    return { page, root, child, started, webview: version.Browser, close,
      async resize(width, height) {
        const scale = await page.evaluate(() => devicePixelRatio);
        await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-TargetProcessId', String(child.pid), '-ClientWidth', String(Math.round(width * scale)), '-ClientHeight', String(Math.round(height * scale))], { windowsHide: true });
        await until(() => page.evaluate(({ width, height }) => innerWidth === width && innerHeight === height, { width, height }), 'RESIZE_TIMEOUT');
      },
    };
  } catch (error) { await close(); throw error; }
}
