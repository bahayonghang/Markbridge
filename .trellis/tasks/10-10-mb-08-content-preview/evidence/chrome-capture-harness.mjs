// Disposable Chrome capture observation. Reports booleans, counts, and hashes only.
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidence, '../../../..');
const extensionDir = resolve(repo, 'apps/extension/dist');
const uiScript = join(evidence, 'chrome-capture-ui.ps1');
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const runId = randomUUID();
const failureText = '未能采集当前页。请在要采集的标签页上打开扩展后再试。';
const secretList = [
  `pw-${randomBytes(9).toString('hex')}`,
  `cp-${randomBytes(9).toString('hex')}`,
  `cc-${randomBytes(9).toString('hex')}`,
  `em-${randomBytes(9).toString('hex')}`,
  `hd-${randomBytes(9).toString('hex')}`,
  `nt-${randomBytes(9).toString('hex')}`,
  `sc-${randomBytes(9).toString('hex')}`,
  `ck-${randomBytes(9).toString('hex')}`,
  `hc-${randomBytes(9).toString('hex')}`,
  `op-${randomBytes(9).toString('hex')}`,
  `oc-${randomBytes(9).toString('hex')}`,
];
const [password, currentPassword, card, email, hidden, note, scriptSecret, cookie, httpCookie, otherPassword, otherCookie] = secretList;
const report = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'disposable Chrome user-data-dir, unpacked extension, no daily profile',
  loadExtensionFlag: false,
  paired: false,
  desktopStarted: false,
  controls: [],
};
let lastCdp = '';
let lastEval = '';
let stage = 'init';
process.on('unhandledRejection', () => {});
const processes = [];
let chrome;
let ui;
let server;
let chromeDirectory;
let uiFailed = false;

function scrub(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const secret of secretList) if (secret) out = out.split(secret).join('[redacted]');
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrub(item);
    return out;
  }
  return value;
}
function record(control, status, details = {}) {
  const row = scrub({ control, status, ...details });
  report.controls.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
class Halt extends Error {}
function ensure(condition, code) { if (!condition) throw new Error(code); }
function safeMessage(error) {
  const message = error instanceof Error ? error.message : 'FAILED';
  return /^[A-Z0-9_]+$/.test(message) ? message : 'FAILED';
}
async function until(probe, code, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await probe(); if (last) return last; } catch (error) { last = error; }
    await delay(80);
  }
  if (last instanceof Error && /^[A-Z0-9_]+$/.test(last.message)) throw last;
  throw new Error(code);
}
function run(command, args, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: stdout ?? '', stderr: stderr ?? '' }));
      else resolveRun(stdout ?? '');
    });
  });
}
function pwsh(script, extraEnv = {}) {
  return run('pwsh', ['-NoProfile', '-Command', script], extraEnv);
}
function assertDisposable(directory) {
  const normalized = directory.replaceAll('\\', '/').toLowerCase();
  ensure(normalized.includes('/temp/') || normalized.includes('/tmp/'), 'NOT_TEMP');
  ensure(!normalized.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  ensure(!normalized.includes('com.markbridge.desktop'), 'APP_DATA_PATH');
  ensure(!normalized.includes('markbridge-06-chromium'), 'PATCHED_CHROMIUM');
}
async function sha256(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', rejectHash);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}
async function fileStamp(path) {
  try {
    const info = await stat(path);
    return { exists: true, length: info.size, hash: await sha256(path), mtimeMs: info.mtimeMs };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, length: 0, hash: '', mtimeMs: 0 };
    throw error;
  }
}
async function containsSecret(path) {
  const data = await readFile(path);
  return secretList.some((secret) => secret && data.includes(Buffer.from(secret)));
}
function desktopDatabases() {
  return [
    join(process.env.APPDATA ?? '', 'com.markbridge.desktop', 'markbridge.sqlite'),
    join(process.env.LOCALAPPDATA ?? '', 'com.markbridge.desktop', 'markbridge.sqlite'),
  ];
}
async function desktopSnapshot() {
  const files = [];
  for (const path of desktopDatabases()) {
    const stamp = await fileStamp(path);
    let secret = false;
    if (stamp.exists && stamp.length > 0 && stamp.length < 200_000_000) secret = await containsSecret(path);
    files.push({ path: path.includes('Roaming') || path.includes('roaming') ? 'roaming' : 'local', ...stamp, secret });
  }
  return files;
}
async function hostSnapshot() {
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'
$dpiKey = 'HKCU:\\Control Panel\\Desktop\\WindowMetrics'
$dpi = 'ABSENT'
if (Test-Path -LiteralPath $dpiKey) {
  $names = @((Get-Item -LiteralPath $dpiKey).GetValueNames())
  if ($names -contains 'AppliedDPI') { $dpi = [string](Get-ItemProperty -LiteralPath $dpiKey -Name AppliedDPI).AppliedDPI }
}
$hklmKey = 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome'
if (Test-Path -LiteralPath $hklmKey) {
  $hklmNames = (@((Get-Item -LiteralPath $hklmKey).GetValueNames()) | Sort-Object) -join ','
  $hklmSubs = @(Get-ChildItem -LiteralPath $hklmKey -ErrorAction SilentlyContinue).Count
} else { $hklmNames = 'ABSENT'; $hklmSubs = -1 }
$policyRoot = Test-Path -LiteralPath 'HKCU:\\Software\\Policies'
$googlePolicy = Test-Path -LiteralPath 'HKCU:\\Software\\Policies\\Google\\Chrome'
$chromiumPolicy = Test-Path -LiteralPath 'HKCU:\\Software\\Policies\\Chromium'
$daily = Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Bookmarks'
$dailyItem = Get-Item -LiteralPath $daily
$dailyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $daily).Hash
Write-Output ('dpi=' + $dpi)
Write-Output ('hklmNames=' + $hklmNames)
Write-Output ('hklmSubs=' + $hklmSubs)
Write-Output ('policyRoot=' + $policyRoot)
Write-Output ('googlePolicy=' + $googlePolicy)
Write-Output ('chromiumPolicy=' + $chromiumPolicy)
Write-Output ('dailyHash=' + $dailyHash)
Write-Output ('dailyLen=' + $dailyItem.Length)
$chromeItem = Get-Item -LiteralPath $env:MB08_CHROME
Write-Output ('chromeLen=' + $chromeItem.Length)
Write-Output ('chromeTicks=' + $chromeItem.LastWriteTimeUtc.Ticks)`, { MB08_CHROME: chromeExe });
  const read = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(stdout)?.[1]?.trim() ?? '';
  return {
    dpi: read('dpi'), hklmNames: read('hklmNames'), hklmSubs: read('hklmSubs'), policyRoot: read('policyRoot'),
    googlePolicy: read('googlePolicy'), chromiumPolicy: read('chromiumPolicy'), dailyHash: read('dailyHash'),
    dailyLen: Number(read('dailyLen')), chromeLen: read('chromeLen'), chromeTicks: read('chromeTicks'),
  };
}
function hostValid(snapshot) {
  return /^[0-9A-F]{64}$/.test(snapshot.dailyHash)
    && Number.isInteger(snapshot.dailyLen) && snapshot.dailyLen > 0
    && snapshot.dpi.length > 0 && snapshot.hklmNames.length > 0 && /^-?\d+$/.test(snapshot.hklmSubs)
    && (snapshot.policyRoot === 'True' || snapshot.policyRoot === 'False')
    && (snapshot.googlePolicy === 'True' || snapshot.googlePolicy === 'False')
    && (snapshot.chromiumPolicy === 'True' || snapshot.chromiumPolicy === 'False')
    && /^\d+$/.test(snapshot.chromeLen) && Number(snapshot.chromeLen) > 0
    && /^\d+$/.test(snapshot.chromeTicks);
}
function sameHost(before, after) {
  return hostValid(before) && hostValid(after)
    && before.dpi === after.dpi && before.hklmNames === after.hklmNames && before.hklmSubs === after.hklmSubs
    && before.policyRoot === after.policyRoot && before.googlePolicy === after.googlePolicy
    && before.chromiumPolicy === after.chromiumPolicy && before.dailyHash === after.dailyHash
    && before.dailyLen === after.dailyLen && before.chromeLen === after.chromeLen
    && before.chromeTicks === after.chromeTicks;
}
async function credentialCount() {
  const stdout = await new Promise((resolveHits, rejectHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (error, text) => {
      const body = text ?? '';
      if (!body.trim()) rejectHits(Object.assign(new Error('CREDENTIAL_LIST_FAILED'), { status: error?.code }));
      else resolveHits(body);
    });
  });
  return stdout.split(/\r?\n/).filter((line) => line.includes('Markbridge.Pairing')).length;
}
async function chromeIdentity() {
  const normalized = chromeExe.replaceAll('\\', '/').toLowerCase();
  ensure(normalized === 'c:/program files/google/chrome/application/chrome.exe', 'CHROME_PATH');
  const stdout = await pwsh("$item = Get-Item -LiteralPath $env:MB08_CHROME; $info = $item.VersionInfo; Write-Output ('product=' + $info.ProductName); Write-Output ('version=' + $info.ProductVersion)", { MB08_CHROME: chromeExe });
  const product = /product=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  const version = /version=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  ensure(product === 'Google Chrome', 'NOT_GOOGLE_CHROME');
  ensure(version.length > 0, 'CHROME_MISSING');
  return { product, version };
}
function startUi() {
  const child = spawn('pwsh', ['-NoProfile', '-File', uiScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  processes.push(child);
  let buffer = '';
  const pending = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('{')) continue;
      const wait = pending.shift();
      if (!wait) continue;
      try { wait.resolve(JSON.parse(scrub(line))); } catch (error) { wait.reject(error); }
    }
  });
  child.on('exit', () => {
    for (const wait of pending.splice(0)) wait.reject(new Error('UI_EXIT'));
  });
  return { child, call(op) {
    return new Promise((resolveReply, reject) => {
      pending.push({ resolve: resolveReply, reject });
      child.stdin.write(`${JSON.stringify(op)}\n`);
    });
  } };
}
function launchChrome(directory) {
  assertDisposable(directory);
  const args = [
    '--remote-debugging-pipe', `--user-data-dir=${directory}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble', '--disable-features=ChromeWhatsNewUI',
    '--window-position=60,60', '--window-size=1200,860', 'about:blank',
  ];
  ensure(!args.some((arg) => arg.startsWith('--load-extension')), 'LOAD_EXTENSION_FLAG');
  const child = spawn(chromeExe, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  processes.push(child);
  let next = 0;
  let buffer = '';
  const pending = new Map();
  const events = [];
  const failPending = (code) => {
    for (const request of pending.values()) request.reject(new Error(code));
    pending.clear();
  };
  child.on('error', () => failPending('CHROME_SPAWN'));
  child.stdio[4]?.setEncoding('utf8');
  child.stdio[4]?.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!message.id) {
        if (message.method === 'Network.webSocketCreated') {
          const url = String(message.params?.url ?? '');
          events.push({ method: 'Network.webSocketCreated', loopback: url.startsWith('ws://127.') || url.startsWith('wss://127.') });
        }
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) {
        lastCdp = scrub(JSON.stringify(message.error)).slice(0, 240);
        request.reject(new Error('CHROME_CDP_FAILED'));
      } else request.resolve(message.result);
    }
  });
  child.on('exit', () => failPending('CHROME_EXIT'));
  return { child, events, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  } };
}
async function confirmChrome(directory) {
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'
$dir = $env:MB08_DIR
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*' + $dir + '*') })
$joined = (($procs | ForEach-Object { $_.CommandLine }) -join "\`n").ToLower().Replace('\\','/')
$want = $dir.ToLower().Replace('\\','/')
Write-Output ('count=' + $procs.Count)
Write-Output ('hasDir=' + $joined.Contains($want))
Write-Output ('hasLoad=' + $joined.Contains('--load-extension='))
Write-Output ('hasDaily=' + $joined.Contains('google/chrome/user data'))
Write-Output ('hasPatched=' + $joined.Contains('markbridge-06-chromium'))
Write-Output ('hasUnsafe=' + $joined.Contains('--enable-unsafe-extension-debugging'))`, { MB08_DIR: directory });
  const read = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(stdout)?.[1]?.trim() ?? '';
  ensure(Number(read('count')) > 0 && read('hasDir') === 'True', 'CHROME_PROFILE_UNCONFIRMED');
  ensure(read('hasLoad') === 'False', 'LOAD_EXTENSION_FLAG');
  ensure(read('hasDaily') === 'False', 'DAILY_PROFILE_PATH');
  ensure(read('hasPatched') === 'False', 'PATCHED_CHROMIUM');
  ensure(read('hasUnsafe') === 'False', 'UNSAFE_DEBUG_FLAG');
}
async function chromePids(rootPid, directory) {
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ForEach-Object {
  $match = $_.CommandLine -like ('*' + $env:MB08_DIR + '*')
  Write-Output ($_.ProcessId.ToString() + ',' + $_.ParentProcessId.ToString() + ',' + $match)
}`, { MB08_DIR: directory });
  const rows = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pid, parent, match] = line.split(',');
    return { pid: Number(pid), parent: Number(parent), match: match === 'True' };
  });
  const ids = new Set(rows.filter((row) => row.match).map((row) => row.pid));
  if (rootPid) ids.add(rootPid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
    }
  }
  return [...ids].filter((pid) => Number.isInteger(pid) && pid > 0);
}
async function evaluate(sessionId, expression) {
  const response = await chrome.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails;
    lastEval = scrub(String(detail.exception?.className || detail.text || 'ERROR')).slice(0, 160);
    throw new Error('CHROME_EVALUATION_FAILED');
  }
  return response.result?.value;
}
async function attach(targetId) {
  const attached = await chrome.call('Target.attachToTarget', { targetId, flatten: true });
  await chrome.call('Runtime.enable', {}, attached.sessionId);
  return attached.sessionId;
}
async function detach(sessionId) {
  try { await chrome.call('Target.detachFromTarget', { sessionId }); } catch { /* The target may already be gone. */ }
}
function pageHtml(kind) {
  if (kind === 'active') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>MB08 Active</title></head><body><p>MB08-VISIBLE</p><p>MB08-VISIBLE-2</p><script>void ${JSON.stringify(scriptSecret)}</script><input id="pw" type="password" autocomplete="current-password" value="${password}"><input type="text" autocomplete="current-password" value="${currentPassword}"><input type="text" autocomplete="cc-number" value="${card}"><input type="email" autocomplete="username" value="${email}"><input type="hidden" value="${hidden}"><textarea>${note}</textarea><script>document.querySelector('#pw').value=${JSON.stringify(password)}</script></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>MB08 Other</title></head><body><p>MB08-OTHER</p><input type="password" value="${otherPassword}"></body></html>`;
}
function startPages() {
  const pages = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/active' && url.pathname !== '/other') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('not found');
      return;
    }
    const active = url.pathname === '/active';
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': active
        ? [`mb08a=${httpCookie}; Path=/; HttpOnly`, `mb08b=${cookie}; Path=/`]
        : [`mb08c=${otherCookie}; Path=/; HttpOnly`],
    };
    response.writeHead(200, headers);
    response.end(pageHtml(active ? 'active' : 'other'));
  });
  return new Promise((resolveListen, rejectListen) => {
    pages.once('error', rejectListen);
    pages.listen(0, '127.0.0.1', () => resolveListen(pages));
  });
}
async function targets() {
  const listed = await chrome.call('Target.getTargets');
  return listed.targetInfos ?? [];
}
async function kill(child) {
  if (!child?.pid || child.exitCode != null) return;
  await new Promise((resolveKill) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('exit', () => resolveKill());
    child.on('exit', () => resolveKill());
  });
}
async function removeDir(directory) {
  if (!directory) return false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await rm(directory, { recursive: true, force: true }); return true; } catch { await delay(250); }
  }
  return false;
}
function sameFiles(before, after) {
  return before.length === after.length && before.every((file, index) => file.exists === after[index]?.exists && file.length === after[index]?.length && file.hash === after[index]?.hash && file.secret === false && after[index]?.secret === false);
}
function fail(control, details) {
  record(control, 'FAIL', details);
  report.status = 'FAIL';
  throw new Halt(control);
}

const shortcuts = [
  { shortcut: 'Alt+Shift+Y', vk: 0x59 },
  { shortcut: 'Alt+Shift+J', vk: 0x4a },
  { shortcut: 'Alt+Shift+H', vk: 0x48 },
];

process.stdout.write(`${JSON.stringify({ control: 'start', status: 'RUN', runId })}\n`);
try {
  ensure(scrub(`x ${password} y`) === 'x [redacted] y', 'SCRUB');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  const popupHtml = await readFile(join(extensionDir, 'index.html'), 'utf8');
  ensure(manifest.permissions?.includes('scripting') && manifest.permissions?.includes('activeTab'), 'DIST_STALE');
  ensure(!manifest.host_permissions && !manifest.permissions?.includes('tabs'), 'HOST_PERMISSION');
  ensure(popupHtml.includes('id="capture"'), 'DIST_STALE');
  const browser = await chromeIdentity();
  report.browserProduct = browser.product;
  report.chromeVersion = browser.version;
  report.hostBefore = await hostSnapshot();
  ensure(hostValid(report.hostBefore), 'HOST_BASELINE');
  report.desktopBefore = await desktopSnapshot();
  report.pairingBefore = await credentialCount();
  ui = startUi();
  const ping = await until(() => ui.call({ op: 'ping' }).then((value) => value?.ok ? value : null), 'UI_HELPER', 20000);
  ensure(ping.inputSize === 40, 'UI_INPUT_SIZE');
  server = await startPages();
  const port = server.address().port;
  ensure(server.address().address === '127.0.0.1', 'SERVER_HOST');
  chromeDirectory = await mkdtemp(join(tmpdir(), 'markbridge-08-chrome-'));
  assertDisposable(chromeDirectory);
  report.chromeDirectory = 'temp';
  chrome = launchChrome(chromeDirectory);
  await confirmChrome(chromeDirectory);
  chrome.version = (await chrome.call('Browser.getVersion')).product;
  ensure(String(chrome.version).startsWith('Chrome/'), 'NOT_GOOGLE_CHROME');
  const loaded = await chrome.call('Extensions.loadUnpacked', { path: extensionDir });
  ensure(/^[a-p]{32}$/.test(loaded.id), 'EXTENSION_ID');
  chrome.extensionId = loaded.id;
  const workerInfo = await until(async () => (await targets()).find((target) => target.type === 'service_worker' && target.url.includes(chrome.extensionId)), 'EXTENSION_WORKER');
  const worker = await attach(workerInfo.targetId);
  await chrome.call('Network.enable', {}, worker);
  const manifestSeen = await evaluate(worker, `(() => { const manifest = chrome.runtime.getManifest(); return { permissions: manifest.permissions || [], hosts: (manifest.host_permissions || []).length, popup: manifest.action && manifest.action.default_popup || '' }; })()`);
  ensure(manifestSeen.popup === 'index.html', 'POPUP_ENTRY');
  ensure(manifestSeen.hosts === 0 && manifestSeen.permissions.includes('activeTab') && manifestSeen.permissions.includes('scripting'), 'EXTENSION_PERMISSIONS');
  record('extension_loaded', 'PASS', { chrome: chrome.version, loadExtensionFlag: false, loadUnpacked: true, hostPermissions: manifestSeen.hosts });

  stage = 'pages';
  const otherTarget = await chrome.call('Target.createTarget', { url: `http://127.0.0.1:${port}/other`, background: true, newWindow: false });
  const activeTarget = await chrome.call('Target.createTarget', { url: `http://127.0.0.1:${port}/active`, background: false, newWindow: false });
  for (const target of await targets()) {
    if (target.type === 'page' && target.url === 'about:blank') await chrome.call('Target.closeTarget', { targetId: target.targetId });
  }
  await chrome.call('Target.activateTarget', { targetId: activeTarget.targetId });
  async function pageFacts(targetId, expression) {
    const session = await attach(targetId);
    try { return await evaluate(session, expression); }
    finally { await detach(session); }
  }
  const activePage = await until(async () => {
    const value = await pageFacts(activeTarget.targetId, `({ title: document.title, visibility: document.visibilityState, ready: document.readyState, paragraphs: document.querySelectorAll('p').length, inputs: document.querySelectorAll('input,textarea').length, cookieNameSet: document.cookie.split(';').some((part) => part.trim().startsWith('mb08b=')), httpOnlyHidden: !document.cookie.includes('mb08a=') })`);
    return value.title === 'MB08 Active' && value.ready === 'complete' ? value : null;
  }, 'ACTIVE_PAGE', 15000);
  const otherPage = await until(async () => {
    const value = await pageFacts(otherTarget.targetId, `({ title: document.title, visibility: document.visibilityState, ready: document.readyState, paragraphs: document.querySelectorAll('p').length })`);
    return value.title === 'MB08 Other' && value.ready === 'complete' ? value : null;
  }, 'OTHER_PAGE', 15000);
  if (otherPage.visibility !== 'hidden') {
    await chrome.call('Target.activateTarget', { targetId: activeTarget.targetId });
    await delay(200);
    const again = await pageFacts(otherTarget.targetId, `document.visibilityState`);
    otherPage.visibility = again;
  }
  ensure(activePage.visibility === 'visible' && activePage.paragraphs === 2 && activePage.inputs === 6, 'ACTIVE_CONTENT');
  ensure(activePage.cookieNameSet === true && activePage.httpOnlyHidden === true, 'COOKIE_FIXTURE');
  if (!(otherPage.visibility === 'hidden' && otherPage.paragraphs === 1)) {
    record('page_state', 'RUN', { activeVisibility: activePage.visibility, otherVisibility: otherPage.visibility, otherParagraphs: otherPage.paragraphs });
    throw new Error('OTHER_CONTENT');
  }
  stage = 'before-gesture';
  await delay(400);
  const before = await evaluate(worker, `(async () => {
    const all = await chrome.tabs.query({});
    const active = all.filter((tab) => tab.active).map((tab) => tab.id);
    const inactive = all.filter((tab) => !tab.active).map((tab) => tab.id);
    let execute = active.length === 1 ? 'REJECTED' : 'NO_TAB';
    if (active.length === 1) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: active[0] }, func: () => 1 });
        execute = 'EXECUTED';
      } catch (error) {
        const message = String(error && error.message || '');
        execute = message.includes('Cannot access') || message.toLowerCase().includes('permission') ? 'NO_PERMISSION' : 'REJECTED';
      }
    }
    const local = await chrome.storage.local.get(null);
    const stored = await chrome.storage.session.get(null);
    const blob = JSON.stringify({ local, stored });
    const secrets = ${JSON.stringify(secretList)};
    const markers = ['MB08-VISIBLE', 'MB08-VISIBLE-2', 'MB08-OTHER', 'MB08 Active', 'MB08 Other'];
    return {
      activeCount: active.length, inactiveCount: inactive.length, execute,
      localKeys: Object.keys(local).sort(), sessionKeys: Object.keys(stored).sort(),
      secretHits: secrets.filter((secret) => blob.includes(secret)).length,
      markerHits: markers.filter((marker) => blob.includes(marker)).length,
      hasAuth: Object.prototype.hasOwnProperty.call(local, 'markbridge-auth'),
      hasPending: Object.prototype.hasOwnProperty.call(stored, 'markbridge-pending'),
    };
  })()`);
  const popupBefore = (await targets()).some((target) => target.url.startsWith(`chrome-extension://${chrome.extensionId}/index.html`));
  const obs1Base = {
    popupBefore, workerExecute: before.execute, activeCount: before.activeCount, inactiveCount: before.inactiveCount,
    secretHits: before.secretHits, markerHits: before.markerHits, hasAuth: before.hasAuth, hasPending: before.hasPending,
    localKeys: before.localKeys, sessionKeys: before.sessionKeys,
  };
  if (popupBefore || before.execute !== 'NO_PERMISSION' || before.secretHits !== 0 || before.markerHits !== 0 || before.hasAuth || before.hasPending || before.activeCount !== 1 || before.inactiveCount < 1) {
    fail('obs1_before_gesture', obs1Base);
  }

  stage = 'gesture';
  const pids = await chromePids(chrome.child.pid, chromeDirectory);
  const windowsBefore = await ui.call({ op: 'windows', pids });
  const hwndsBefore = new Set(String(windowsBefore.rows ?? '').split(';').filter(Boolean).map((row) => row.split(',')[1]));
  const browserWindow = String(windowsBefore.rows ?? '').split(';').filter(Boolean).map((row) => {
    const [pid, hwnd, x, y, w, h] = row.split(',').map(Number);
    return { pid, hwnd, x, y, w, h, area: w * h };
  }).sort((left, right) => right.area - left.area)[0];
  ensure(browserWindow?.hwnd, 'BROWSER_WINDOW');
  const listed = (value) => [].concat(value?.matches ?? []).filter((item) => item && Number.isFinite(item.x)).map((item) => ({ ...item, name: String(item.name ?? '').slice(0, 80) }));
  let actionGesture = 'none';
  let popupInfo;
  await ui.call({ op: 'focus', hwnd: browserWindow.hwnd });
  await delay(300);
  const toolbar = listed(await ui.call({ op: 'find', hwnds: [browserWindow.hwnd], maxDy: 240 }));
  const actionButton = toolbar.find((item) => item.name.includes('签桥'));
  const menuButton = toolbar.find((item) => item.name.includes('扩展程序') || item.name === '扩展' || item.name.includes('Extensions'));
  record('toolbar', 'RUN', { count: toolbar.length, names: toolbar.map((item) => item.name), hasAction: Boolean(actionButton), hasMenu: Boolean(menuButton) });
  async function clickAt(match, raise = true) {
    const currentPids = await chromePids(chrome.child.pid, chromeDirectory);
    if (raise) {
      await ui.call({ op: 'topmost', hwnd: browserWindow.hwnd });
      await delay(150);
    }
    return ui.call({ op: 'click', x: match.x, y: match.y, pids: currentPids });
  }
  async function openFrom(match, kind, raise = true) {
    const click = await clickAt(match, raise);
    if (click.result !== 'clicked') return click.result ?? 'miss';
    try {
      popupInfo = await until(async () => (await targets()).find((target) => target.url.startsWith(`chrome-extension://${chrome.extensionId}/index.html`)), 'POPUP_TARGET', 4000);
      actionGesture = kind;
      return 'opened';
    } catch { return 'no-popup'; }
  }
  let actionClick = 'skipped';
  if (actionButton) actionClick = await openFrom(actionButton, 'toolbar-click');
  let menuClick = 'skipped';
  if (!popupInfo && menuButton) {
    const opened = await clickAt(menuButton);
    menuClick = opened.result ?? 'miss';
    if (opened.result === 'clicked') {
      await delay(400);
      const freshPids = await chromePids(chrome.child.pid, chromeDirectory);
      const freshWindows = await ui.call({ op: 'windows', pids: freshPids });
      const hwnds = String(freshWindows.rows ?? '').split(';').filter(Boolean).map((row) => Number(row.split(',')[1])).filter((hwnd) => hwnd > 0);
      const menuItems = listed(await ui.call({ op: 'find', queryB64: Buffer.from('签桥').toString('base64'), hwnds }));
      record('extension_menu', 'RUN', { count: menuItems.length });
      if (menuItems[0]) menuClick = await openFrom(menuItems[0], 'menu-click', false);
    }
  }
  let shortcutUsed = '';
  if (!popupInfo) {
    for (const candidate of shortcuts) {
      const assigned = await evaluate(worker, `(async () => {
        try {
          if (!chrome.commands || !chrome.commands.update) return { assigned: false };
          await chrome.commands.update({ name: '_execute_action', shortcut: ${JSON.stringify(candidate.shortcut)} });
          const all = await chrome.commands.getAll();
          const action = all.find((item) => item.name === '_execute_action');
          return { assigned: Boolean(action && action.shortcut === ${JSON.stringify(candidate.shortcut)}) };
        } catch { return { assigned: false }; }
      })()`);
      if (!assigned?.assigned) continue;
      const freshPids = await chromePids(chrome.child.pid, chromeDirectory);
      const freshWindows = await ui.call({ op: 'windows', pids: freshPids });
      const currentBrowser = String(freshWindows.rows ?? '').split(';').filter(Boolean).map((row) => {
        const parts = row.split(',').map(Number);
        return { hwnd: parts[1], area: parts[4] * parts[5] };
      }).sort((left, right) => right.area - left.area)[0];
      ensure(currentBrowser?.hwnd, 'BROWSER_WINDOW');
      await ui.call({ op: 'keys', hwnd: currentBrowser.hwnd, vk: candidate.vk });
      shortcutUsed = candidate.shortcut;
      try {
        popupInfo = await until(async () => (await targets()).find((target) => target.url.startsWith(`chrome-extension://${chrome.extensionId}/index.html`)), 'POPUP_TARGET', 4000);
        actionGesture = 'os-shortcut';
        break;
      } catch { /* Try another shortcut if this one did not open the popup. */ }
    }
  }
  record('gesture_attempt', 'RUN', { actionGesture, shortcutUsed: shortcutUsed !== '', actionClick, menuClick });
  ensure(popupInfo?.targetId, 'POPUP_TARGET');
  stage = 'popup';
  const popup = await attach(popupInfo.targetId);
  const armed = await evaluate(popup, `(() => {
    const button = document.querySelector('#capture');
    const output = document.querySelector('#capture-result');
    if (!button || !output) return null;
    const rect = button.getBoundingClientRect();
    document.documentElement.dataset.mbHit = 'miss';
    document.documentElement.dataset.mbExec = '';
    button.addEventListener('pointerdown', (event) => {
      document.documentElement.dataset.mbHit = event.isTrusted ? 'trusted' : 'untrusted';
    }, true);
    const scripting = chrome.scripting;
    const original = scripting.executeScript;
    scripting.executeScript = function (details) {
      const tabId = details && details.target ? details.target.tabId : null;
      return Promise.resolve(original.call(scripting, details)).then((value) => {
        document.documentElement.dataset.mbExec = 'ok:' + String(tabId);
        return value;
      }, (error) => {
        const message = String(error && error.message || '');
        const code = message.includes('Cannot access') ? 'NO_ACCESS' : message.includes('chrome://') ? 'CHROME_URL' : 'ERROR';
        document.documentElement.dataset.mbExec = code + ':' + String(tabId);
        throw error;
      });
    };
    const scale = window.devicePixelRatio || 1;
    const chromeTop = window.outerHeight - window.innerHeight;
    const x = window.screenX + rect.left + rect.width / 2;
    const y = window.screenY + chromeTop + rect.top + rect.height / 2;
    return { empty: output.textContent === '', width: rect.width, height: rect.height, scale, x: x * scale, y: y * scale, xCss: x, yCss: y };
  })()`);
  ensure(armed?.empty === true && armed.width > 4 && armed.height > 4, 'POPUP_NOT_EMPTY');
  record('obs1_before_gesture', 'PASS', { ...obs1Base, popupResultEmpty: armed.empty === true, actionGesture, shortcutAssigned: shortcutUsed !== '' });

  const clickPids = await chromePids(chrome.child.pid, chromeDirectory);
  const windowsAfter = await ui.call({ op: 'windows', pids: clickPids });
  const popupWindow = String(windowsAfter.rows ?? '').split(';').filter(Boolean).map((row) => {
    const [pid, hwnd, x, y, w, h] = row.split(',').map(Number);
    return { pid, hwnd, x, y, w, h, fresh: !hwndsBefore.has(String(hwnd)) };
  }).filter((item) => item.fresh).sort((left, right) => (left.w * left.h) - (right.w * right.h))[0];
  if (popupWindow?.hwnd) await ui.call({ op: 'topmost', hwnd: popupWindow.hwnd });
  let clickResult = await ui.call({ op: 'click', x: Math.round(armed.x), y: Math.round(armed.y), pids: clickPids });
  let hit = await evaluate(popup, `document.documentElement.dataset.mbHit || 'miss'`);
  if (hit !== 'trusted') {
    clickResult = await ui.call({ op: 'click', x: Math.round(armed.xCss), y: Math.round(armed.yCss), pids: clickPids });
    hit = await evaluate(popup, `document.documentElement.dataset.mbHit || 'miss'`);
  }
  if (hit !== 'trusted' && popupWindow) {
    const captureButton = await ui.call({ op: 'find', queryB64: Buffer.from('采集当前页可见文字').toString('base64'), hwnds: [popupWindow.hwnd] });
    const captureMatches = [].concat(captureButton.matches ?? []);
    if (captureButton.ok && captureMatches.length > 0) {
      clickResult = await ui.call({ op: 'click', x: captureMatches[0].x, y: captureMatches[0].y, pids: clickPids });
      hit = await evaluate(popup, `document.documentElement.dataset.mbHit || 'miss'`);
    }
  }
  stage = 'capture';
  ensure(hit === 'trusted', 'CLICK_NOT_TRUSTED');
  const captured = await until(async () => {
    const value = await evaluate(popup, `(async () => {
      const text = document.querySelector('#capture-result')?.textContent ?? '';
      if (!text) return null;
      const payload = ${JSON.stringify({ failureText, secrets: secretList })};
      const markers = ['MB08-VISIBLE-2', 'MB08-VISIBLE', 'MB08 Active'];
      let rest = text;
      for (const marker of markers) rest = rest.split(marker).join('');
      rest = rest.replace(/\\s+/g, '');
      const all = await chrome.tabs.query({});
      const exec = document.documentElement.dataset.mbExec || '';
      const splitAt = exec.lastIndexOf(':');
      const execCode = splitAt === -1 ? exec : exec.slice(0, splitAt);
      const execTab = splitAt === -1 ? '' : exec.slice(splitAt + 1);
      const calls = execTab && execTab !== 'null' && execTab !== 'undefined' ? [Number(execTab)] : [];
      return {
        failure: text === payload.failureText,
        hasTitle: text.includes('MB08 Active'),
        hasVisible: text.includes('MB08-VISIBLE'),
        hasVisible2: text.includes('MB08-VISIBLE-2'),
        hasOther: text.includes('MB08-OTHER') || text.includes('MB08 Other'),
        secretHits: payload.secrets.filter((secret) => text.includes(secret)).length,
        remainderLength: rest.length,
        length: text.length,
        execCode,
        calls,
        activeIds: all.filter((tab) => tab.active).map((tab) => tab.id),
        inactiveIds: all.filter((tab) => !tab.active).map((tab) => tab.id),
      };
    })()`);
    return value || null;
  }, 'RESULT_TIMEOUT', 8000);
  const callId = captured.calls.length === 1 ? captured.calls[0] : null;
  const callIsActive = callId != null && captured.activeIds.includes(callId);
  const callIsInactive = callId != null && captured.inactiveIds.includes(callId);
  const onlyVisible = captured.failure === false && captured.hasTitle && captured.hasVisible && captured.hasVisible2 && captured.hasOther === false && captured.secretHits === 0 && captured.remainderLength === 0;
  const obs2 = {
    actionGesture, shortcutUsed: shortcutUsed !== '', captureClick: clickResult.result, trusted: hit === 'trusted',
    onlyVisible, failure: captured.failure, remainderLength: captured.remainderLength, length: captured.length, callCount: captured.calls.length, execCode: captured.execCode,
  };
  if (!onlyVisible || hit !== 'trusted' || captured.calls.length !== 1) fail('obs2_visible_text', obs2);
  record('obs2_visible_text', 'PASS', obs2);
  const obs3 = { secretHits: captured.secretHits, passwordAbsent: captured.secretHits === 0, sensitiveAbsent: captured.secretHits === 0 };
  if (captured.secretHits !== 0) fail('obs3_sensitive_inputs', obs3);
  record('obs3_sensitive_inputs', 'PASS', obs3);
  const storedAfter = await evaluate(worker, `(async () => {
    const local = await chrome.storage.local.get(null);
    const stored = await chrome.storage.session.get(null);
    const blob = JSON.stringify({ local, stored });
    const secrets = ${JSON.stringify(secretList)};
    const markers = ['MB08-VISIBLE', 'MB08-VISIBLE-2', 'MB08-OTHER', 'MB08 Active', 'MB08 Other'];
    return {
      localKeys: Object.keys(local).sort(), sessionKeys: Object.keys(stored).sort(),
      secretHits: secrets.filter((secret) => blob.includes(secret)).length,
      markerHits: markers.filter((marker) => blob.includes(marker)).length,
      hasAuth: Object.prototype.hasOwnProperty.call(local, 'markbridge-auth'),
      hasPending: Object.prototype.hasOwnProperty.call(stored, 'markbridge-pending'),
    };
  })()`);
  const loopbackSockets = chrome.events.filter((event) => event.loopback).length;
  const obs4 = {
    cookieAbsentFromResult: captured.secretHits === 0, extensionSecretHits: storedAfter.secretHits,
    extensionMarkerHits: storedAfter.markerHits, hasAuth: storedAfter.hasAuth, hasPending: storedAfter.hasPending,
    loopbackSockets, cookieNameSet: activePage.cookieNameSet === true, httpOnlyHidden: activePage.httpOnlyHidden === true,
  };
  if (storedAfter.secretHits !== 0 || storedAfter.markerHits !== 0 || storedAfter.hasAuth || storedAfter.hasPending || loopbackSockets !== 0 || captured.secretHits !== 0 || obs4.cookieNameSet !== true || obs4.httpOnlyHidden !== true) {
    fail('obs4_cookies', obs4);
  }
  record('obs4_cookies', 'PASS', obs4);
  const obs5 = {
    otherHidden: otherPage.visibility === 'hidden', activeVisible: activePage.visibility === 'visible',
    inactiveCount: captured.inactiveIds.length, callCount: captured.calls.length, callIsActive, callIsInactive,
    otherMarkerPresent: captured.hasOther,
  };
  if (!obs5.otherHidden || !obs5.activeVisible || obs5.inactiveCount < 1 || obs5.callCount !== 1 || !obs5.callIsActive || obs5.callIsInactive || obs5.otherMarkerPresent) {
    fail('obs5_other_tab', obs5);
  }
  record('obs5_other_tab', 'PASS', obs5);
  await detach(popup);
  await detach(worker);
} catch (error) {
  if (!(error instanceof Halt)) record('run', report.status === 'FAIL' ? 'FAIL' : 'UNVERIFIED', { code: safeMessage(error), stage, eval: lastEval || undefined, cdp: lastCdp || undefined });
  if (report.status !== 'FAIL') { report.status = 'UNVERIFIED'; report.exitCode = 2; }
  else report.exitCode = 1;
} finally {
  if (ui) { try { ui.child.stdin.write('exit\n'); } catch { /* The helper may already be gone. */ } }
  if (server) await new Promise((resolveClose) => server.close(() => resolveClose()));
  try { server?.closeAllConnections?.(); } catch { /* Node may not expose the method. */ }
  if (chrome) await kill(chrome.child);
  for (const child of processes) await kill(child);
  await delay(400);
  const chromeRemoved = await removeDir(chromeDirectory);
  try { report.hostAfter = await hostSnapshot(); } catch { report.hostAfter = null; }
  try { report.desktopAfter = await desktopSnapshot(); } catch { report.desktopAfter = null; }
  try { report.pairingAfter = await credentialCount(); } catch { report.pairingAfter = -1; }
  const hostSame = report.hostBefore && report.hostAfter ? sameHost(report.hostBefore, report.hostAfter) : false;
  const desktopSame = report.desktopBefore && report.desktopAfter ? sameFiles(report.desktopBefore, report.desktopAfter) : false;
  report.cleanup = {
    chromeRemoved, pairingUnchanged: report.pairingBefore === report.pairingAfter,
    dailyBookmarksUnchanged: hostSame, policiesUnchanged: hostSame, chromeUnchanged: hostSame,
    desktopSqliteUnchanged: desktopSame, desktopSqliteHasSecret: report.desktopAfter?.some((file) => file.secret) === true,
  };
  const cleanupOk = report.cleanup.chromeRemoved && report.cleanup.pairingUnchanged && report.cleanup.dailyBookmarksUnchanged && report.cleanup.policiesUnchanged && report.cleanup.chromeUnchanged && report.cleanup.desktopSqliteUnchanged && report.cleanup.desktopSqliteHasSecret === false;
  report.cleanup.ok = cleanupOk;
  const names = ['obs1_before_gesture', 'obs2_visible_text', 'obs3_sensitive_inputs', 'obs4_cookies', 'obs5_other_tab'];
  const rows = names.map((name) => report.controls.filter((item) => item.control === name));
  const proved = rows.every((items) => items.length === 1 && items[0].status === 'PASS');
  const anyFail = report.status === 'FAIL' || report.controls.some((item) => item.status === 'FAIL');
  if (proved && cleanupOk && !anyFail && !uiFailed) { report.status = 'PASS'; report.exitCode = 0; }
  else if (anyFail) { report.status = 'FAIL'; report.exitCode = 1; }
  else { report.status = 'UNVERIFIED'; report.exitCode = 2; }
  report.finishedAt = new Date().toISOString();
  let body = scrub(JSON.stringify(report, null, 2));
  if (secretList.some((secret) => secret && body.includes(secret))) {
    report.status = 'FAIL';
    report.exitCode = 1;
    report.secretLeak = true;
    body = scrub(JSON.stringify(report, null, 2));
  }
  await writeFile(join(evidence, 'ac08-4-report.json'), `${body}\n`);
  process.exit(report.exitCode ?? 2);
}
