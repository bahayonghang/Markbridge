// One V15 surface read after 启动连接. Does not rebuild, launch Chrome, or load an extension.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidenceDir, '../../../..');
const installer = path.join(repo, 'target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe');
const tempRoot = path.resolve(process.env.TEMP || '');
const installDir = path.join(tempRoot, 'mb13-v15-bridge-install');
const appData = path.join(tempRoot, 'mb13-v15-bridge-data');
const webviewDir = path.join(installDir, 'webview2');
const helperPath = path.join(tempRoot, 'mb13-v15-bridge-win.ps1');
const logPath = path.join(evidenceDir, 'v15-bridge-run.log');
const resultPath = path.join(evidenceDir, 'v15-bridge-result.json');
const stderrPath = path.join(evidenceDir, 'v15-bridge-stderr.log');
const stdoutPath = path.join(evidenceDir, 'v15-bridge-stdout.log');
const namespace = 'Markbridge.Task05.mb13-bridge-text-20261012';
const expectedBookmarks = 'len=849515 sha256=DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82';
const dailyBookmarks = path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data/Default/Bookmarks');
const dailyEb = path.join(process.env.LOCALAPPDATA || '', 'com.markbridge.desktop/EBWebView');
const runStart = new Date();
const surfaceExpr = `(() => {
  const body = document.body ? document.body.innerText : '';
  const alerts = [...document.querySelectorAll('[role="alert"]')].map((el) => el.innerText.trim()).filter(Boolean);
  const status = document.querySelector('[role="status"]')?.innerText?.trim() || '';
  const listenerNode = document.querySelector('#listener-title');
  const listener = listenerNode && listenerNode.parentElement ? listenerNode.parentElement.innerText.trim() : '';
  const buttons = [...document.querySelectorAll('button')].map((el) => ({ text: el.textContent.trim(), disabled: !!el.disabled }));
  const match = body.match(/127\\.0\\.0\\.1:\\d+/);
  return { text: body, alerts, status, listener, buttons, port: match ? match[0] : '' };
})()`;

const obs = {
  install: 'NOT_RUN', startExit: 'NOT_RUN', uninstall: 'NOT_RUN', clickStart: 'NOT_RUN',
  listenerPort: 'ABSENT', pairClick: 'NOT_CLICKED', cmdkey: 'NOT_RUN', ebwebview: 'NOT_RUN',
  ai: 'NOT_RUN', ac13_2: 'FAIL', ac13_3: 'NOT_RUN', ac13_4: 'NOT_RUN', v15: 'FAIL', v16: 'UNVERIFIED',
};
const notes = [];
const exitCodes = {};
let bookmarksBad = false;
let installed = false;
let webPort = 0;
let appRun = null;
let stderrText = '';
let stdoutText = '';
let stderrAfterClick = '';
const sockets = [];

function redact(value) {
  return String(value)
    .replace(/credential\\?":\s*\\?"[^"\\]*/gi, 'credential:[redacted]')
    .replace(/pairingCode\\?":\s*\\?"[^"\\]*/gi, 'pairingCode:[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}
function log(line) {
  const text = `[${new Date().toISOString()}] ${redact(line)}\n`;
  fs.appendFileSync(logPath, text);
  process.stdout.write(text);
}
function note(line) {
  notes.push(redact(line));
  log(line);
}
function inside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
function assertTemp(dir) {
  const resolved = path.resolve(dir);
  const lower = resolved.toLowerCase();
  if (lower.includes('com.markbridge.desktop') || lower.includes('google\\chrome\\user data') || lower.includes('google/chrome/user data')) {
    throw new Error(`refusing daily path ${resolved}`);
  }
  if (!path.isAbsolute(resolved) || !inside(tempRoot, resolved) || !path.basename(resolved).startsWith('mb13-v15-bridge')) {
    throw new Error(`refusing path ${resolved}`);
  }
}
function forbiddenInstall(dir) {
  const resolved = path.resolve(dir).toLowerCase();
  const localMarkbridge = path.resolve(process.env.LOCALAPPDATA || '', 'Markbridge').toLowerCase();
  const roaming = path.resolve(process.env.APPDATA || '', 'com.markbridge.desktop').toLowerCase();
  return resolved === localMarkbridge || resolved === roaming || resolved.includes('\\com.markbridge.desktop');
}
function assertLaunchEnv(env) {
  const folder = env.WEBVIEW2_USER_DATA_FOLDER;
  const data = env.MARKBRIDGE_APP_DATA;
  const name = env.MARKBRIDGE_CREDENTIAL_NAMESPACE;
  if (!folder || !path.isAbsolute(folder) || !inside(installDir, folder) || !fs.existsSync(folder)) {
    throw new Error('WEBVIEW2_USER_DATA_FOLDER refused');
  }
  if (!data || !path.isAbsolute(data) || data.toLowerCase().includes('com.markbridge.desktop')) {
    throw new Error('MARKBRIDGE_APP_DATA refused');
  }
  if (path.basename(path.join(data, 'markbridge.sqlite')) !== 'markbridge.sqlite') throw new Error('database name refused');
  if (!/^Markbridge\.Task05\.[A-Za-z0-9-]{1,80}$/.test(name || '')) throw new Error('credential namespace refused');
  if (name === 'Markbridge.Pairing' || name.includes('Markbridge.Pairing')) throw new Error('pairing namespace refused');
}
function appEnv() {
  const env = { ...process.env };
  for (const key of ['MARKBRIDGE_APP_DATA', 'MARKBRIDGE_CREDENTIAL_NAMESPACE', 'WEBVIEW2_USER_DATA_FOLDER', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']) {
    delete env[key];
  }
  env.MARKBRIDGE_APP_DATA = appData;
  env.MARKBRIDGE_CREDENTIAL_NAMESPACE = namespace;
  env.WEBVIEW2_USER_DATA_FOLDER = webviewDir;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${webPort} --remote-allow-origins=*`;
  assertLaunchEnv(env);
  return env;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function poll(fn, cap, gap = 400) {
  const end = Date.now() + cap;
  let last = null;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
      last = value;
    } catch (error) {
      last = redact(error && error.message ? error.message : error);
    }
    await sleep(Math.min(gap, Math.max(0, end - Date.now())));
  }
  return last;
}
function run(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('exit', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
function bookmarks() {
  if (!fs.existsSync(dailyBookmarks)) return 'ABSENT';
  const data = fs.readFileSync(dailyBookmarks);
  const hash = crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
  return `len=${data.length} sha256=${hash}`;
}
function walkFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
}
function ebSnapshot() {
  if (!fs.existsSync(dailyEb)) return { absent: true, files: 0, newer: 0, newest: '', names: [] };
  const files = [];
  try { walkFiles(dailyEb, files); } catch (error) {
    return { error: redact(error.message || error), files: files.length, newer: NaN, newest: '', names: [] };
  }
  const start = runStart.getTime();
  const newer = [];
  let newest = 0;
  for (const file of files) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (mtime > newest) newest = mtime;
    if (mtime > start) newer.push(path.relative(dailyEb, file));
  }
  return { absent: false, files: files.length, newer: newer.length, newest: newest ? new Date(newest).toISOString() : '', names: newer.slice(0, 20) };
}
function writeHelper() {
  const content = `\ufeffparam([Parameter(Mandatory=$true)][string]$Action, [int]$RootPid = 0, [string]$Stamp = '', [string]$Namespace = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
function Get-Tree([uint32]$root) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
  $queue = New-Object 'System.Collections.Generic.Queue[uint32]'
  $queue.Enqueue($root)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $set.Add($current)) { continue }
    foreach ($row in $all) { if ([uint32]$row.ParentProcessId -eq $current) { $queue.Enqueue([uint32]$row.ProcessId) } }
  }
  return @($set)
}
if (-not ('Mb15BridgeWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Mb15BridgeWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static HashSet<uint> Ids = new HashSet<uint>();
  public static readonly List<string> Titles = new List<string>();
  public static readonly List<string> Children = new List<string>();
  public static IntPtr Main;
  static string TextOf(IntPtr hWnd) {
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    return buffer.ToString().Replace("\\r", " ").Replace("\\n", " ");
  }
  public static bool EnumChild(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    var title = TextOf(hWnd);
    if (title.Length == 0 || title.Length > 500 || Children.Count >= 40) return true;
    Children.Add(title);
    return true;
  }
  public static bool EnumTop(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner; GetWindowThreadProcessId(hWnd, out owner);
    if (!Ids.Contains(owner)) return true;
    var title = TextOf(hWnd);
    if (title.Length == 0) return true;
    Titles.Add(title);
    if (title.IndexOf("Markbridge", StringComparison.Ordinal) >= 0 && title.IndexOf("网页预览", StringComparison.Ordinal) < 0) Main = hWnd;
    EnumChildWindows(hWnd, EnumChild, IntPtr.Zero);
    return true;
  }
  public static void SetIds(uint[] values) {
    Ids = new HashSet<uint>(values ?? new uint[0]);
    Titles.Clear();
    Children.Clear();
    Main = IntPtr.Zero;
    EnumWindows(EnumTop, IntPtr.Zero);
  }
}
"@
}
function Use-Tree([uint32]$root) {
  $values = @(Get-Tree $root)
  [Mb15BridgeWin]::SetIds([uint32[]]$values)
}
switch ($Action) {
  'windows' {
    Use-Tree ([uint32]$RootPid)
    [Mb15BridgeWin]::Titles | ForEach-Object { "TITLE $_" }
    [Mb15BridgeWin]::Children | ForEach-Object { "CHILD $_" }
  }
  'close' {
    Use-Tree ([uint32]$RootPid)
    $posted = $false
    if ([Mb15BridgeWin]::Main -ne [IntPtr]::Zero) { $posted = [Mb15BridgeWin]::PostMessage([Mb15BridgeWin]::Main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    Write-Output $(if ($posted) { 'posted' } else { 'missing' })
  }
  'cmdkey' {
    $raw = cmdkey /list 2>&1 | Out-String
    $pairing = ([regex]::Matches($raw, 'Markbridge\\.Pairing')).Count
    $model = ([regex]::Matches($raw, 'Markbridge\\.Model')).Count
    $task = 0
    if ($Namespace) { $task = ([regex]::Matches($raw, [regex]::Escape($Namespace))).Count }
    Write-Output "pairing=$pairing model=$model task=$task"
  }
  'reg' {
    $key = 'HKCU:\\Software\\markbridge\\Markbridge'
    if (-not (Test-Path -LiteralPath $key)) { Write-Output 'ABSENT'; break }
    $item = Get-Item -LiteralPath $key
    $value = [string]$item.GetValue('')
    $names = @($item.GetValueNames()) -join ','
    Write-Output "value=$value names=$names"
  }
  'regdel' {
    $parent = 'HKCU:\\Software\\markbridge'
    $key = Join-Path $parent 'Markbridge'
    if (-not (Test-Path -LiteralPath $key)) { Write-Output 'ABSENT'; break }
    $item = Get-Item -LiteralPath $key
    $foreign = @($item.GetValueNames() | ForEach-Object { [string]$item.GetValue($_) } | Where-Object { $_ -and ($_ -ne $Stamp) })
    if ($foreign.Count -gt 0) { Write-Output 'LEFT'; break }
    Remove-Item -LiteralPath $parent -Recurse -Force
    Write-Output 'DELETED'
  }
  default { throw "unknown action $Action" }
}
`;
  fs.writeFileSync(helperPath, content, 'utf8');
}
async function helper(action, extra = []) {
  const result = await run('pwsh', ['-NoProfile', '-File', helperPath, '-Action', action, ...extra]);
  if (result.code !== 0) throw new Error(`${action} ${redact(result.err || result.out)}`);
  return result.out;
}
async function cmdkey() {
  const text = await helper('cmdkey', ['-Namespace', namespace]);
  return {
    pairing: Number(text.match(/pairing=(\d+)/)?.[1] ?? 'NaN'),
    model: Number(text.match(/model=(\d+)/)?.[1] ?? 'NaN'),
    task: Number(text.match(/task=(\d+)/)?.[1] ?? 'NaN'),
    text,
  };
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let next = 1;
    const timer = setTimeout(() => { ws.close(); reject(new Error('cdp open timeout')); }, 8000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      const client = {
        ws,
        call(method, params = {}) {
          const id = next++;
          return new Promise((resolveCall, rejectCall) => {
            const callTimer = setTimeout(() => { pending.delete(id); rejectCall(new Error(`timeout ${method}`)); }, 8000);
            pending.set(id, {
              resolve: (value) => { clearTimeout(callTimer); resolveCall(value); },
              reject: (error) => { clearTimeout(callTimer); rejectCall(error); },
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        async eval(expression) {
          const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) {
            const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'exception';
            throw new Error(redact(text).slice(0, 240));
          }
          return result.result?.value;
        },
      };
      sockets.push(ws);
      resolve(client);
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString());
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(redact(JSON.stringify(message.error))));
      else waiter.resolve(message.result || {});
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp error')); });
  });
}
async function jsonList(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`json/list ${response.status}`);
  return response.json();
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
async function removeDir(dir) {
  assertTemp(dir);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
async function withPage(fn) {
  const list = await jsonList(webPort);
  const page = list.find((target) => target.type === 'page' && String(target.title || '').includes('签桥') && !String(target.title || '').includes('网页预览'));
  if (!page?.webSocketDebuggerUrl) return null;
  const client = await connect(page.webSocketDebuggerUrl);
  try { return await fn(client); } finally { client.ws.close(); }
}
async function readSurface() {
  return withPage(async (client) => {
    await client.call('Runtime.enable');
    return client.eval(surfaceExpr);
  });
}
async function clickStart() {
  const found = await poll(async () => withPage(async (client) => {
    await client.call('Runtime.enable');
    const value = await client.eval(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '启动连接'); if (!button || button.disabled) return null; button.click(); return { ok: true }; })()`);
    return value && value.ok ? value : null;
  }), 20000, 400);
  return !!(found && found.ok);
}
function sameSurface(left, right) {
  return JSON.stringify([left?.text, left?.alerts, left?.status, left?.listener, left?.port])
    === JSON.stringify([right?.text, right?.alerts, right?.status, right?.listener, right?.port]);
}
async function readAfterChange(before) {
  const end = Date.now() + 10000;
  let last = before;
  while (Date.now() < end) {
    try {
      const next = await readSurface();
      if (next) last = next;
      if (last && !sameSurface(before, last) && (last.port || (Array.isArray(last.alerts) && last.alerts.length > 0) || last.status !== before?.status || last.listener !== before?.listener)) {
        return last;
      }
    } catch (error) {
      last = { error: redact(error.message || error), text: '', alerts: [], status: '', listener: '', buttons: [], port: '' };
    }
    await sleep(400);
  }
  try {
    const finalSurface = await readSurface();
    if (finalSurface) return finalSurface;
  } catch (error) {
    note(`SURFACE ${redact(error.message || error)}`);
  }
  return last;
}
function appendChunk(file, current, chunk) {
  const text = chunk.toString('utf8');
  fs.appendFileSync(file, text);
  if (current.length >= 100000) return current;
  return current + text.slice(0, 100000 - current.length);
}
async function startApp() {
  const snap = bookmarks();
  note(`BOOKMARKS before-launch ${snap}`);
  if (snap !== expectedBookmarks) {
    bookmarksBad = true;
    throw new Error('BOOKMARKS_CHANGED before-launch');
  }
  if (!fs.existsSync(webviewDir) || forbiddenInstall(installDir)) throw new Error('launch path refused');
  webPort = await freePort();
  const env = appEnv();
  fs.writeFileSync(stderrPath, '');
  fs.writeFileSync(stdoutPath, '');
  const child = spawn(path.join(installDir, 'markbridge-desktop.exe'), [], { env, cwd: appData, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child.stdout.on('data', (chunk) => { stdoutText = appendChunk(stdoutPath, stdoutText, chunk); });
  child.stderr.on('data', (chunk) => { stderrText = appendChunk(stderrPath, stderrText, chunk); });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  appRun = { child, exited, pid: child.pid };
  note(`APP_START pid=${child.pid}`);
  return appRun;
}
async function closeApp(run) {
  const posted = await helper('close', ['-RootPid', String(run.pid)]);
  note(`WM_CLOSE ${posted} pid=${run.pid}`);
  const result = await Promise.race([run.exited, sleep(20000).then(() => null)]);
  if (result) return result;
  await run('taskkill', ['/PID', String(run.pid), '/T', '/F']);
  return Promise.race([run.exited, sleep(10000).then(() => ({ code: null, signal: 'kill-timeout' }))]);
}
async function install() {
  const snap = bookmarks();
  note(`BOOKMARKS before-install ${snap}`);
  if (snap !== expectedBookmarks) {
    bookmarksBad = true;
    throw new Error('BOOKMARKS_CHANGED before-install');
  }
  if (forbiddenInstall(installDir)) throw new Error('install path refused');
  assertTemp(installDir);
  assertTemp(appData);
  if (fs.existsSync(installDir)) await removeDir(installDir);
  const installCommand = `$ErrorActionPreference='Stop'; $psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = '${installer.replaceAll("'", "''")}'; $psi.Arguments = '/S /D=${installDir}'; $psi.UseShellExecute = $false; $psi.WorkingDirectory = $env:TEMP; $p = [Diagnostics.Process]::Start($psi); if (-not $p.WaitForExit(120000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Write-Output 'TIMEOUT' } else { Write-Output $p.ExitCode }`;
  const result = await run('pwsh', ['-NoProfile', '-Command', installCommand]);
  if (result.out.includes('TIMEOUT')) {
    exitCodes.install = null;
    obs.install = 'FAIL';
    note('INSTALL timeout');
    return false;
  }
  const code = Number(result.out.trim().split(/\s+/).pop());
  exitCodes.install = Number.isInteger(code) ? code : null;
  const exe = path.join(installDir, 'markbridge-desktop.exe');
  installed = exitCodes.install === 0 && fs.existsSync(exe);
  obs.install = installed ? 'PASS' : 'FAIL';
  note(`INSTALL code=${exitCodes.install} exe=${fs.existsSync(exe)}`);
  const after = bookmarks();
  note(`BOOKMARKS after-install ${after}`);
  if (after !== expectedBookmarks) {
    bookmarksBad = true;
    throw new Error('BOOKMARKS_CHANGED after-install');
  }
  return installed;
}
async function uninstall() {
  const exe = path.join(installDir, 'uninstall.exe');
  if (!inside(installDir, exe) || !fs.existsSync(exe)) {
    obs.uninstall = 'NOT_RUN';
    note('UNINSTALL absent');
    return;
  }
  const child = spawn(exe, ['/S'], { cwd: installDir, stdio: 'ignore', windowsHide: true });
  const result = await Promise.race([
    new Promise((resolve) => child.on('exit', (code) => resolve({ code }))),
    sleep(120000).then(() => null),
  ]);
  if (!result) {
    await run('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    exitCodes.uninstall = null;
    obs.uninstall = 'FAIL';
    note('UNINSTALL timeout');
    return;
  }
  exitCodes.uninstall = result.code;
  obs.uninstall = result.code === 0 ? 'PASS' : 'FAIL';
  note(`UNINSTALL code=${result.code}`);
  const reg = await helper('reg');
  note(`REGISTRY ${reg}`);
  if (reg.startsWith('value=')) {
    const deleted = await helper('regdel', ['-Stamp', installDir]);
    note(`REGISTRY_CLEAN ${deleted}`);
  }
}
async function observe(run) {
  const page = await poll(async () => withPage(async () => ({ ok: true })), 45000, 500);
  if (!page) {
    obs.clickStart = 'NOT_RUN';
    note('desktop debug page missing');
    return { before: null, after: null, windows: '' };
  }
  const before = await readSurface();
  note(`BEFORE_CLICK status=${before?.status || ''} listener=${(before?.listener || '').replace(/\s+/g, ' ')}`);
  const clicked = await clickStart();
  obs.clickStart = clicked ? 'CLICKED' : 'NOT_CLICKED';
  note(`click 启动连接 ${clicked}`);
  const after = clicked ? await readAfterChange(before) : before;
  const windows = await helper('windows', ['-RootPid', String(run.pid)]).catch((error) => `ERROR ${redact(error.message)}`);
  const port = typeof after?.port === 'string' ? after.port : '';
  const listenerShown = /^127\.0\.0\.1:\d+$/.test(port);
  obs.listenerPort = listenerShown ? 'SHOWN' : 'ABSENT';
  obs.pairClick = 'NOT_CLICKED';
  stderrAfterClick = stderrText;
  note(`AFTER_CLICK status=${after?.status || ''} listener=${(after?.listener || '').replace(/\s+/g, ' ')} port=${port || 'none'} alerts=${(after?.alerts || []).length}`);
  note(listenerShown ? 'listener visible; 生成配对串 not clicked' : 'listener not visible; 生成配对串 not clicked');
  return { before, after, windows };
}
async function main() {
  fs.writeFileSync(logPath, '');
  writeHelper();
  note(`runStart=${runStart.toISOString()}`);
  note(`installer=${fs.existsSync(installer)} bytes=${fs.existsSync(installer) ? fs.statSync(installer).size : 0} chromeLaunched=false`);
  if (!fs.existsSync(installer) || !tempRoot) {
    note('preflight missing; no process started');
    return null;
  }
  const beforeBookmarks = bookmarks();
  const beforeCmd = await cmdkey();
  const beforeEb = ebSnapshot();
  note(`BEFORE bookmarks ${beforeBookmarks}`);
  note(`BEFORE cmdkey ${beforeCmd.text}`);
  note(`BEFORE eb files=${beforeEb.files} newer=${beforeEb.newer} newest=${beforeEb.newest}`);
  if (beforeBookmarks !== expectedBookmarks || beforeCmd.pairing !== 0 || beforeCmd.model !== 0) {
    bookmarksBad = beforeBookmarks !== expectedBookmarks;
    obs.cmdkey = beforeCmd.pairing === 0 && beforeCmd.model === 0 ? 'NOT_RUN' : 'FAIL';
    note('hard stop before any app process');
    return null;
  }
  for (const dir of [installDir, appData]) {
    if (fs.existsSync(dir)) await removeDir(dir);
  }
  if (!(await install())) return null;
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(webviewDir, { recursive: true });
  assertLaunchEnv({
    WEBVIEW2_USER_DATA_FOLDER: webviewDir,
    MARKBRIDGE_APP_DATA: appData,
    MARKBRIDGE_CREDENTIAL_NAMESPACE: namespace,
  });
  const run = await startApp();
  return observe(run);
}
async function finish(surface) {
  for (const socket of sockets) { try { socket.close(); } catch { /* closed */ } }
  if (appRun && appRun.child.exitCode === null && !appRun.child.killed) {
    try {
      const closed = await closeApp(appRun);
      exitCodes.start = closed.code;
      obs.startExit = closed.code === 0 ? 'PASS' : 'FAIL';
      note(`START_EXIT code=${closed.code}`);
    } catch (error) {
      note(`CLOSE ${redact(error.message || error)}`);
      obs.startExit = 'FAIL';
    }
  }
  if (installed) await uninstall().catch((error) => note(`UNINSTALL ${redact(error.message || error)}`));
  const afterBookmarks = (() => { try { return bookmarks(); } catch (error) { return `ERROR ${redact(error.message || error)}`; } })();
  const afterCmd = await cmdkey().catch(() => ({ pairing: NaN, model: NaN, task: NaN, text: 'ERROR' }));
  const afterEb = (() => { try { return ebSnapshot(); } catch (error) { return { error: redact(error.message || error), files: NaN, newer: NaN, newest: '', names: [] }; } })();
  note(`AFTER bookmarks ${afterBookmarks}`);
  note(`AFTER cmdkey ${afterCmd.text}`);
  note(`AFTER eb files=${afterEb.files} newer=${afterEb.newer} newest=${afterEb.newest} names=${(afterEb.names || []).join('|')}`);
  if (afterBookmarks !== expectedBookmarks) bookmarksBad = true;
  const cmdBefore = notes.some((line) => line.includes('BEFORE cmdkey pairing=0 model=0'));
  obs.cmdkey = cmdBefore && afterCmd.pairing === 0 && afterCmd.model === 0 ? 'PASS' : 'FAIL';
  obs.ebwebview = afterEb.newer === 0 ? 'PASS' : 'FAIL';
  const db = path.join(appData, 'markbridge.sqlite');
  note(`SQLITE exists=${fs.existsSync(db)} name=${path.basename(db)}`);
  note(`WEBVIEW temp exists=${fs.existsSync(webviewDir)}`);
  const processes = await run('pwsh', ['-NoProfile', '-Command', "@(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue).Count"]);
  note(`desktop processes=${processes.out}`);
  const after = surface?.after || null;
  const output = {
    runStart: runStart.toISOString(),
    bookmarksBad,
    expectedBookmarks,
    afterBookmarks,
    namespace,
    installDir,
    appData,
    webviewDir,
    chromeLaunched: false,
    pairClicked: false,
    listenerShown: obs.listenerPort === 'SHOWN',
    listenerText: after?.port || '',
    status: after?.status || '',
    alerts: after?.alerts || [],
    listenerLine: after?.listener || '',
    buttons: after?.buttons || [],
    visibleText: redact(after?.text || ''),
    windows: redact(surface?.windows || ''),
    stderrAfterClick: redact(stderrAfterClick).slice(0, 8000),
    stderr: redact(stderrText).slice(0, 8000),
    stdout: redact(stdoutText).slice(0, 4000),
    exitCodes,
    obs,
    eb: afterEb,
    cmdkey: { pairing: afterCmd.pairing, model: afterCmd.model, task: afterCmd.task },
    notes,
  };
  fs.writeFileSync(resultPath, JSON.stringify(output, null, 2));
  log(`RESULT listener=${obs.listenerPort} v15=${obs.v15} ac13_2=${obs.ac13_2}`);
}
let surface = null;
main().then((value) => { surface = value; }).catch((error) => note(`MAIN ${redact(error && error.message ? error.message : error)}`)).finally(async () => {
  try { await finish(surface); } catch (error) { log(`FINISH ${redact(error && error.message ? error.message : error)}`); }
  process.exit(bookmarksBad ? 4 : 0);
});
