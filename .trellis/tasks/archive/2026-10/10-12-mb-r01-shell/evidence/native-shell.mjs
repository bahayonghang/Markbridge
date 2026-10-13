// Production Tauri/WebView2 with a disposable SQLite cache. No Chrome connection or writes.
import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, version, release, arch } from 'node:os';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const evidence = import.meta.dirname;
const repo = resolve(evidence, '../../../../../..');
const exe = join(repo, 'target/release/markbridge-desktop.exe');
const seeder = join(repo, 'target/debug/examples/seed_profile_cache.exe');
const windowHelper = join(evidence, 'native-window.ps1');
const report = { startedAt: new Date().toISOString(), scope: 'R01 native shell, synthetic cached read-only profile; no real Chrome', samples: [], assertions: [], errors: [] };
report.machine = { version: version(), release: release(), architecture: arch(), node: process.version };
const forcedScale = process.env.MARKBRIDGE_R01_SCALE;
if (forcedScale && forcedScale !== '1.5') throw new Error('Only the explicit 150% process-scale check is supported');
const suffix = forcedScale ? '-150-runtime' : '';
report.scaleMode = forcedScale ? 'WebView2 process scale override 150%; Windows desktop remains 125%' : 'Windows desktop scale 125%; no emulation';
const artifactRoot = await mkdtemp(join(tmpdir(), 'markbridge-r01-shell-'));
report.isolation = { root: artifactRoot, retainedForInspection: true };
report.executableSha256 = createHash('sha256').update(await readFile(exe)).digest('hex');
const screenshotRoot = join(evidence, `native-screenshots${suffix}`);
await mkdir(screenshotRoot, { recursive: true });

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitFor(fn, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch { /* WebView2 is starting. */ }
    await delay(200);
  }
  throw new Error('Timed out waiting for isolated native app');
}

const makeNode = (chromeId, parentId, position, kind, title) => ({
  chromeId, parentId, position, kind, title,
  url: kind === 'bookmark' ? `https://example.invalid/${chromeId}` : null,
  folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null,
});
const nodes = [makeNode('0', null, 0, 'folder', ''), makeNode('1', '0', 0, 'folder', '书签栏'), makeNode('2', '1', 0, 'folder', '产品与设计')];
nodes[1].folderType = 'bookmarks-bar';
for (let index = 0; index < 24; index++) nodes.push(makeNode(String(index + 10), '2', index, 'bookmark', index === 0 ? '合成样本 · 中文长标题用于检查窄窗口中的省略与详情排版' : `合成样本 ${index + 1} · 日常书签`));

let app;
let browser;
let page;
try {
  const appData = join(artifactRoot, 'data');
  const nodesFile = join(artifactRoot, 'nodes.json');
  await writeFile(nodesFile, JSON.stringify(nodes));
  await run(seeder, [join(appData, 'markbridge.sqlite'), nodesFile], { windowsHide: true });
  const port = await availablePort();
  app = spawn(exe, [], { cwd: artifactRoot, windowsHide: true, stdio: 'ignore', env: {
    ...process.env,
    MARKBRIDGE_APP_DATA: appData,
    MARKBRIDGE_CREDENTIAL_NAMESPACE: `Markbridge.Task05.r01-${Date.now()}`,
    WEBVIEW2_USER_DATA_FOLDER: join(artifactRoot, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*${forcedScale ? ` --force-device-scale-factor=${forcedScale}` : ''}`,
  } });
  report.pid = app.pid;
  const version = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok ? response.json() : null;
  });
  report.webview = version.Browser;
  await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some((target) => target.type === 'page' && target.url));
  browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  report.targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  report.playwrightPages = browser.contexts().flatMap((context) => context.pages()).map((candidate) => candidate.url());
  console.log(JSON.stringify({ targets: report.targets.map(({ type, url }) => ({ type, url })), pages: report.playwrightPages }));
  page = await waitFor(() => browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('tauri.localhost')));
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.getByRole('heading', { name: '书签', exact: true }).waitFor();
  if (forcedScale) expect(await page.evaluate(() => devicePixelRatio)).toBe(Number(forcedScale));

  // Assertions below use the production UI and are kept separate from browser fixture coverage.
  await expect(page.locator('#library-source')).toHaveValue('profile:pb10k');
  await expect(page.locator('.connection')).toContainText('只读');
  const search = page.getByLabel('搜索标题或网址', { exact: true });
  await search.fill('合成样本');
  await expect(page.getByRole('option').filter({ hasText: '合成样本' }).first()).toBeVisible();
  const first = page.getByRole('checkbox').first();
  await first.check();
  const checkboxSize = await first.boundingBox();
  expect(checkboxSize.width).toBeLessThanOrEqual(24);
  report.assertions.push('seeded cached profile rendered; read-only status; native search; checkbox <= 24 px');
  report.initialText = await page.locator('body').innerText();
  for (const [width, height] of [[1440, 900], [1100, 760], [640, 760], [1100, 480], [640, 480]]) {
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-TargetProcessId', String(app.pid), '-ClientWidth', String(Math.round(width * dpr)), '-ClientHeight', String(Math.round(height * dpr))], { windowsHide: true });
    await page.waitForFunction(({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1, { width, height });
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight, dpr: devicePixelRatio }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
    await page.screenshot({ path: join(screenshotRoot, `native-${width}x${height}.png`) });
    report.samples.push({ requested: { width, height }, physical: JSON.parse(stdout), dimensions });
  }
  report.assertions.push('actual native client resized to all five required viewports; no document overflow');
  await page.getByRole('option').filter({ hasText: '合成样本' }).first().click();
  const detailButton = page.getByRole('button', { name: '详情', exact: true });
  if (await detailButton.getAttribute('aria-pressed') !== 'true') await detailButton.click();
  await expect(page.getByRole('button', { name: '关闭详情，返回列表' })).toBeVisible();
  await page.screenshot({ path: join(screenshotRoot, 'native-640x480-detail.png') });
  await page.getByRole('button', { name: '关闭详情，返回列表' }).click();
  await expect(detailButton).toBeFocused();
  await expect(page.getByRole('listbox')).toBeVisible();
  for (const label of ['整理', '操作历史', '设置']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: label, exact: true, level: 1 })).toBeFocused();
    await page.screenshot({ path: join(screenshotRoot, `native-640x480-${label}.png`) });
  }
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '启用 AI' })).not.toBeChecked();
  await page.screenshot({ path: join(screenshotRoot, 'native-640x480-ai.png') });
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(search).toHaveValue('合成样本');
  await expect(first).toBeChecked();
  report.assertions.push('compact detail return restores focus; navigation to organize/history/settings; AI defaults off; bookmark search and selection preserved');
  expect(report.errors).toEqual([]);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = error.stack;
  if (page) {
    report.failureText = await page.locator('body').innerText().catch(() => 'unavailable');
    await page.screenshot({ path: join(screenshotRoot, 'failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (app?.pid) {
    try {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-TargetProcessId', String(app.pid), '-Close'], { windowsHide: true });
      await waitFor(() => app.exitCode !== null, 10000);
      report.closedNormally = true;
    } catch {
      // Only the captured disposable process tree can be stopped.
      report.forceStopSent = app.kill();
      await waitFor(() => app.exitCode !== null || app.signalCode !== null, 10000);
      report.closedNormally = false;
    }
  }
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-report${suffix}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, errors: report.errors, failure: report.failure, closedNormally: report.closedNormally }));
}
