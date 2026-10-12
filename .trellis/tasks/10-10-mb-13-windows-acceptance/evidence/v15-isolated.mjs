// One isolated V15 run. Does not rebuild, publish, or touch the daily Chrome profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidenceDir, '../../../..');
const installer = path.join(repo, 'target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe');
const extensionDir = path.join(repo, 'apps/extension/dist');
const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempRoot = path.resolve(process.env.TEMP || '');
const installDir = path.join(tempRoot, 'mb13-v15-install');
const appData = path.join(tempRoot, 'mb13-v15-data');
const chromeDir = path.join(tempRoot, 'mb13-v15-chrome');
const queryDir = path.join(tempRoot, 'mb13-v15-query');
const webviewDir = path.join(installDir, 'webview2');
const helperPath = path.join(tempRoot, 'mb13-v15-win.ps1');
const pyPath = path.join(tempRoot, 'mb13-v15-ops.py');
const logPath = path.join(evidenceDir, 'v15-run.log');
const resultPath = path.join(evidenceDir, 'v15-result.json');
const namespace = 'Markbridge.Task05.mb13-v15-20261012';
const bridgePort = 49153;
const expectedBookmarks = 'len=849515 sha256=DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82';
const dailyBookmarks = path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data/Default/Bookmarks');
const dailyEb = path.join(process.env.LOCALAPPDATA || '', 'com.markbridge.desktop/EBWebView');
const exampleTitle = 'mb13-v15-example';
const editedTitle = 'mb13-v15-edited';
const unackedTitle = 'mb13-v15-unacked';
const exampleUrl = 'https://example.com/';
const unackedUrl = 'https://example.com/mb13-v15-unacked';
const runStart = new Date();
const deadline = Date.now() + 12 * 60 * 1000;

const obs = {
  install: 'NOT_RUN', startExit: 'NOT_RUN', restartExit: 'NOT_RUN', uninstall: 'NOT_RUN',
  pairingLive: 'NOT_RUN', sync: 'NOT_RUN', textPreview: 'NOT_RUN', previewWindow: 'NOT_RUN',
  editReceipt: 'NOT_RUN', recovery: 'NOT_RUN', cmdkey: 'NOT_RUN', ebwebview: 'NOT_RUN',
  ai: 'NOT_RUN', ac13_2: 'FAIL', ac13_3: 'NOT_RUN', ac13_4: 'NOT_RUN', v15: 'FAIL', v16: 'UNVERIFIED',
};
const notes = [];
const exitCodes = {};
let bookmarksBad = false;
let installed = false;
let chromeChild = null;
let extensionReady = false;
let webPort = 0;
let chromePort = 0;
const appRuns = [];
const sockets = [];

function redact(value) {
  return String(value)
    .replace(/credential\\?":\s*\\?"[^"\\]*/gi, 'credential:[redacted]')
    .replace(/pairingCode\\?":\s*\\?"[^"\\]*/gi, 'pairingCode:[redacted]')
    .slice(0, 500);
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
  if (!path.isAbsolute(dir) || !inside(tempRoot, dir) || !path.basename(dir).startsWith('mb13-v15')) {
    throw new Error(`refusing path ${dir}`);
  }
}
function assertLaunchEnv(env) {
  const folder = env.WEBVIEW2_USER_DATA_FOLDER;
  const data = env.MARKBRIDGE_APP_DATA;
  const name = env.MARKBRIDGE_CREDENTIAL_NAMESPACE;
  if (!folder || !path.isAbsolute(folder) || !inside(installDir, folder)) throw new Error('WEBVIEW2_USER_DATA_FOLDER refused');
  if (!data || !path.isAbsolute(data) || data.toLowerCase().includes('com.markbridge.desktop')) throw new Error('MARKBRIDGE_APP_DATA refused');
  if (path.basename(path.join(data, 'markbridge.sqlite')) !== 'markbridge.sqlite') throw new Error('database name refused');
  if (!/^Markbridge\.Task05\.[A-Za-z0-9-]{1,80}$/.test(name || '')) throw new Error('credential namespace refused');
  if (name.includes('Markbridge.Pairing')) throw new Error('pairing namespace refused');
}
function appEnv() {
  const env = { ...process.env };
  for (const key of ['MARKBRIDGE_APP_DATA', 'MARKBRIDGE_CREDENTIAL_NAMESPACE', 'WEBVIEW2_USER_DATA_FOLDER', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'MARKBRIDGE_OPEN_HTTP_SUSPEND', 'MARKBRIDGE_OPEN_HTTP_PIDFILE']) {
    delete env[key];
  }
  env.MARKBRIDGE_APP_DATA = appData;
  env.MARKBRIDGE_CREDENTIAL_NAMESPACE = namespace;
  env.WEBVIEW2_USER_DATA_FOLDER = webviewDir;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${webPort} --remote-allow-origins=*`;
  assertLaunchEnv(env);
  return env;
}
function timeLeft(cap) {
  return Math.max(0, Math.min(cap, deadline - Date.now()));
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function poll(fn, cap, gap = 400) {
  const end = Date.now() + timeLeft(cap);
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
async function pwsh(script) {
  const result = await run('pwsh', ['-NoProfile', '-Command', script]);
  return result;
}
function writeHelper() {
  const content = `\ufeffparam([Parameter(Mandatory=$true)][string]$Action, [int]$RootPid = 0, [string]$Stamp = '')
$ErrorActionPreference = 'Stop'
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
if (-not ('Mb15Win' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Mb15Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static HashSet<uint> Ids = new HashSet<uint>();
  public static readonly List<string> Rows = new List<string>();
  public static IntPtr Main;
  public static bool EnumTop(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    uint owner; GetWindowThreadProcessId(hWnd, out owner);
    if (!Ids.Contains(owner)) return true;
    var buffer = new StringBuilder(512);
    GetWindowText(hWnd, buffer, buffer.Capacity);
    var title = buffer.ToString();
    if (title.Length == 0) return true;
    Rows.Add(title);
    if (title.IndexOf("Markbridge", StringComparison.Ordinal) >= 0 && title.IndexOf("网页预览", StringComparison.Ordinal) < 0) Main = hWnd;
    return true;
  }
  public static void SetIds(uint[] values) {
    Ids = new HashSet<uint>(values ?? new uint[0]);
    Rows.Clear();
    Main = IntPtr.Zero;
    EnumWindows(EnumTop, IntPtr.Zero);
  }
}
"@
}
function Use-Tree([uint32]$root) {
  $values = @(Get-Tree $root)
  [Mb15Win]::SetIds([uint32[]]$values)
}
switch ($Action) {
  'windows' { Use-Tree ([uint32]$RootPid); [Mb15Win]::Rows | ForEach-Object { $_ } }
  'preview' { Use-Tree ([uint32]$RootPid); $hit = @([Mb15Win]::Rows | Where-Object { $_ -like '*网页预览*' }); if ($hit.Count -gt 0) { 'yes' } else { 'no' } }
  'close' { Use-Tree ([uint32]$RootPid); $posted = $false; if ([Mb15Win]::Main -ne [IntPtr]::Zero) { $posted = [Mb15Win]::PostMessage([Mb15Win]::Main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }; Write-Output $(if ($posted) { 'posted' } else { 'missing' }) }
  'bookmarks' {
    $path = Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Bookmarks'
    if (-not (Test-Path -LiteralPath $path)) { Write-Output 'ABSENT'; break }
    $item = Get-Item -LiteralPath $path
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    Write-Output "len=$($item.Length) sha256=$hash"
  }
  'cmdkey' {
    $raw = cmdkey /list 2>&1 | Out-String
    $pairing = ([regex]::Matches($raw, 'Markbridge\\.Pairing')).Count
    $model = ([regex]::Matches($raw, 'Markbridge\\.Model')).Count
    Write-Output "pairing=$pairing model=$model"
  }
  'eb' {
    $root = Join-Path $env:LOCALAPPDATA 'com.markbridge.desktop\\EBWebView'
    if (-not (Test-Path -LiteralPath $root)) { Write-Output 'ABSENT newer=0'; break }
    $start = [DateTime]::Parse($Stamp, $null, [Globalization.DateTimeStyles]::RoundtripKind)
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)
    $newer = @($files | Where-Object { $_.LastWriteTimeUtc -gt $start })
    $newest = ''
    if ($files.Count -gt 0) { $newest = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString('o') }
    $names = @($newer | Select-Object -First 20 | ForEach-Object { $_.FullName.Substring($root.Length).TrimStart([char]92) })
    Write-Output "files=$($files.Count) newer=$($newer.Count) newest=$newest names=$($names -join '|')"
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
  'killmarker' {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like '*mb13-v15-chrome*' })
    foreach ($row in $rows) { Stop-Process -Id $row.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Output "killed=$($rows.Count)"
  }
  default { throw "unknown action $Action" }
}
`;
  fs.writeFileSync(helperPath, content, 'utf8');
}
function writePy() {
  fs.writeFileSync(pyPath, `import json, os, sqlite3, sys, time
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
err = "none"
for _ in range(40):
    try:
        src_con = sqlite3.connect(src, timeout=1)
        dst_path = os.path.join(dst, "copy.sqlite")
        if os.path.exists(dst_path):
            os.remove(dst_path)
        dst_con = sqlite3.connect(dst_path)
        src_con.backup(dst_con)
        dst_con.close()
        src_con.close()
        con = sqlite3.connect(dst_path)
        rows = list(con.execute("SELECT o.operation_id, o.state, ifnull(s.kind,''), CASE WHEN s.receipt IS NULL THEN 0 ELSE 1 END FROM operations o LEFT JOIN operation_steps s ON s.operation_id = o.operation_id ORDER BY o.created_at, s.ordinal"))
        print(json.dumps(rows))
        raise SystemExit(0)
    except Exception as error:
        err = str(error)
        time.sleep(0.25)
print(json.dumps({"error": err}))
raise SystemExit(1)
`, 'utf8');
}
async function helper(action, extra = []) {
  const result = await run('pwsh', ['-NoProfile', '-File', helperPath, '-Action', action, ...extra]);
  if (result.code !== 0) throw new Error(`${action} ${redact(result.err || result.out)}`);
  return result.out;
}
async function bookmarks() {
  return helper('bookmarks');
}
async function gate(label) {
  const snap = await bookmarks();
  log(`BOOKMARKS ${label} ${snap}`);
  if (snap !== expectedBookmarks) {
    bookmarksBad = true;
    throw new Error(`BOOKMARKS_CHANGED ${label}`);
  }
  return snap;
}
async function cmdkey() {
  const text = await helper('cmdkey');
  const pairing = Number(text.match(/pairing=(\d+)/)?.[1] ?? 'NaN');
  const model = Number(text.match(/model=(\d+)/)?.[1] ?? 'NaN');
  return { pairing, model, text };
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
        call(method, params = {}, timeout = 15000, sessionId = null) {
          const id = next++;
          return new Promise((resolveCall, rejectCall) => {
            const callTimer = setTimeout(() => { pending.delete(id); rejectCall(new Error(`timeout ${method}`)); }, timeout);
            pending.set(id, { resolve: (value) => { clearTimeout(callTimer); resolveCall(value); }, reject: (error) => { clearTimeout(callTimer); rejectCall(error); } });
            const message = { id, method, params };
            if (sessionId) message.sessionId = sessionId;
            ws.send(JSON.stringify(message));
          });
        },
        async sessionEval(sessionId, expression) {
          await this.call('Runtime.enable', {}, 15000, sessionId);
          const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 15000, sessionId);
          if (result.exceptionDetails) {
            const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'exception';
            throw new Error(redact(text).slice(0, 240));
          }
          return result.result?.value;
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
async function browserSocket(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`json/version ${response.status}`);
  const body = await response.json();
  if (!body.webSocketDebuggerUrl) throw new Error('browser socket missing');
  return body.webSocketDebuggerUrl;
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
async function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
async function operations() {
  const db = path.join(appData, 'markbridge.sqlite');
  if (!fs.existsSync(db)) return [];
  const result = await run('python', [pyPath, db, queryDir]);
  if (result.code !== 0) throw new Error(redact(result.out || result.err || 'sqlite read failed'));
  const parsed = JSON.parse(result.out);
  if (parsed && parsed.error) throw new Error(redact(parsed.error));
  return parsed;
}
async function removeDir(dir) {
  assertTemp(dir);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
async function startApp() {
  if (!(await portFree(webPort))) webPort = await freePort();
  const env = appEnv();
  const child = spawn(path.join(installDir, 'markbridge-desktop.exe'), [], { env, cwd: appData, stdio: 'ignore', windowsHide: false });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const run = { child, exited, pid: child.pid };
  appRuns.push(run);
  log(`APP_START pid=${child.pid}`);
  return run;
}
async function closeApp(run) {
  const posted = await helper('close', ['-RootPid', String(run.pid)]);
  note(`WM_CLOSE ${posted} pid=${run.pid}`);
  const result = await Promise.race([run.exited, sleep(20000).then(() => null)]);
  if (result) return result;
  await run('taskkill', ['/PID', String(run.pid), '/T', '/F']);
  return Promise.race([run.exited, sleep(10000).then(() => ({ code: null, signal: 'kill-timeout' }))]);
}
async function killApp(run) {
  await run('taskkill', ['/PID', String(run.pid), '/T', '/F']);
  return Promise.race([run.exited, sleep(10000).then(() => ({ code: null, signal: 'kill-timeout' }))]);
}
async function withPage(fn) {
  const list = await jsonList(webPort);
  const page = list.find((target) => target.type === 'page' && String(target.title || '').includes('签桥') && !String(target.title || '').includes('网页预览'));
  if (!page?.webSocketDebuggerUrl) return null;
  const client = await connect(page.webSocketDebuggerUrl);
  try { return await fn(client); } finally { client.ws.close(); }
}
async function pageEval(expression) {
  return poll(async () => withPage(async (client) => {
    await client.call('Runtime.enable');
    return { value: await client.eval(expression) };
  }), 20000, 500);
}
async function clickButton(text, cap = 20000) {
  const payload = JSON.stringify(text);
  const found = await poll(async () => withPage(async (client) => {
    await client.call('Runtime.enable');
    const value = await client.eval(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${payload}); if (!button) return null; if (button.disabled) return { ok: false }; button.click(); return { ok: true }; })()`);
    return value && value.ok ? value : null;
  }), cap, 400);
  return !!(found && found.ok);
}
async function setField(id, value) {
  const expression = `(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  const found = await pageEval(expression);
  return !!(found && found.value === true);
}
async function bodyHas(text) {
  const found = await pageEval(`document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`);
  return !!(found && found.value === true);
}
async function extensionClient() {
  const list = await jsonList(chromePort);
  const page = list.find((target) => target.type === 'page' && String(target.url || '').includes('/options.html'));
  if (!page?.webSocketDebuggerUrl) return null;
  return connect(page.webSocketDebuggerUrl);
}
async function extensionEval(expression) {
  const client = await extensionClient();
  if (!client) return null;
  try {
    await client.call('Runtime.enable');
    return await client.eval(expression);
  } finally { client.ws.close(); }
}
async function workerEval(expression) {
  await extensionEval(`chrome.runtime.sendMessage({ type: 'status' }).catch(() => null)`);
  const list = await jsonList(chromePort);
  const worker = list.find((target) => (target.type === 'service_worker' || target.type === 'worker') && String(target.url || '').includes('/worker.js'));
  if (worker?.webSocketDebuggerUrl) {
    const client = await connect(worker.webSocketDebuggerUrl);
    try {
      await client.call('Runtime.enable');
      return await client.eval(expression);
    } finally { client.ws.close(); }
  }
  const socket = await browserSocket(chromePort);
  const browser = await connect(socket);
  try {
    const found = await browser.call('Target.getTargets');
    const target = (found.targetInfos || []).find((item) => (item.type === 'service_worker' || item.type === 'worker') && String(item.url || '').includes('/worker.js'));
    if (!target) return null;
    const attached = await browser.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    return await browser.sessionEval(attached.sessionId, expression);
  } finally { browser.ws.close(); }
}
async function chromeBookmarks(title) {
  const expression = `chrome.bookmarks.search({ title: ${JSON.stringify(title)} }).then((nodes) => nodes.filter((node) => node.title === ${JSON.stringify(title)}).map((node) => ({ id: node.id, url: node.url || '' })))`;
  const value = await poll(async () => {
    const found = await extensionEval(expression);
    return Array.isArray(found) ? found : null;
  }, 10000, 400);
  return Array.isArray(value) ? value : [];
}
async function waitLive() {
  const started = await clickButton('启动连接');
  note(`click 启动连接 ${started}`);
  const live = await poll(async () => (await bodyHas('实时同步')) || null, 30000, 500);
  return !!live;
}
async function selectTitle(title) {
  const typed = await setField('library-search', title);
  if (!typed) return false;
  await sleep(600);
  const clicked = await poll(async () => withPage(async (client) => {
    await client.call('Runtime.enable');
    const value = await client.eval(`(() => { const row = [...document.querySelectorAll('.library-row')].find((item) => item.textContent.includes(${JSON.stringify(title)})); if (!row) return null; row.click(); return true; })()`);
    return value ? { ok: true } : null;
  }), 15000, 400);
  return !!(clicked && clicked.ok);
}
async function install() {
  await gate('before-install');
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
  result.code = exitCodes.install;
  const exe = path.join(installDir, 'markbridge-desktop.exe');
  installed = result.code === 0 && fs.existsSync(exe);
  obs.install = installed ? 'PASS' : 'FAIL';
  note(`INSTALL code=${result.code} exe=${fs.existsSync(exe)}`);
  await gate('after-install');
  return installed;
}
async function launchChrome() {
  await gate('before-chrome');
  assertTemp(chromeDir);
  if (!chromeDir.includes('mb13-v15-chrome') || chromeDir.toLowerCase().includes('google\\chrome\\user data')) {
    throw new Error('chrome profile path refused');
  }
  await removeDir(chromeDir);
  fs.mkdirSync(chromeDir, { recursive: true });
  chromePort = await freePort();
  const args = [`--user-data-dir=${chromeDir}`, `--remote-debugging-port=${chromePort}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--new-window', 'about:blank'];
  if (args.some((arg) => arg.includes('--load-extension') || arg.includes('Google\\Chrome\\User Data'))) throw new Error('chrome args refused');
  chromeChild = spawn(chromeExe, args, { stdio: 'ignore', windowsHide: false });
  log(`CHROME_START pid=${chromeChild.pid} port=${chromePort}`);
  const socket = await poll(async () => browserSocket(chromePort), 30000, 500);
  if (typeof socket !== 'string' || !socket.startsWith('ws://')) throw new Error('chrome debug port did not open');
  const browser = await connect(socket);
  try {
    const loaded = await browser.call('Extensions.loadUnpacked', { path: extensionDir });
    const id = loaded.id || '';
    if (!/^[a-p]{32}$/.test(id)) throw new Error('extension id missing');
    note(`EXTENSION loaded length=${id.length}`);
    await browser.call('Target.createTarget', { url: `chrome-extension://${id}/options.html` });
  } finally { browser.ws.close(); }
  const options = await poll(async () => extensionClient(), 20000, 400);
  if (!options?.ws) throw new Error('options page missing');
  options.ws.close();
  const created = await extensionEval(`chrome.bookmarks.create({ parentId: '1', title: ${JSON.stringify(exampleTitle)}, url: ${JSON.stringify(exampleUrl)} }).then((node) => ({ id: node.id }))`);
  if (!created?.id) throw new Error('fixture bookmark was not created');
  note(`FIXTURE bookmark id=${created.id}`);
  extensionReady = true;
  await gate('after-chrome');
}
async function driveHappy(run) {
  const page = await poll(async () => withPage(async () => ({ ok: true })), 45000, 500);
  if (!page) throw new Error('desktop debug page missing');
  const live = await waitLive();
  if (!live) { obs.pairingLive = 'FAIL'; throw new Error('bridge did not start'); }
  const codeRead = await poll(async () => {
    if (!(await clickButton('生成配对串'))) return null;
    const value = await withPage(async (client) => client.eval(`document.querySelector('#pairing-code')?.value || ''`));
    return value && value.length > 20 ? value : null;
  }, 20000, 500);
  if (typeof codeRead !== 'string') { obs.pairingLive = 'FAIL'; throw new Error('pairing code missing'); }
  note(`pairing code chars=${codeRead.length}`);
  const submitted = await extensionEval(`(() => { const input = document.querySelector('#pairing-code'); const form = document.querySelector('#pair-form'); if (!input || !form) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(codeRead)}); form.requestSubmit(); return true; })()`);
  if (submitted !== true) { obs.pairingLive = 'FAIL'; throw new Error('extension pair submit failed'); }
  const confirmed = await clickButton('确认此扩展');
  note(`click 确认此扩展 ${confirmed}`);
  const paired = await poll(async () => (await bodyHas('实时同步')) || null, 30000, 500);
  obs.pairingLive = paired ? 'PASS' : 'FAIL';
  if (!paired) throw new Error('pairing did not reach live');
  const selected = await selectTitle(exampleTitle);
  const metric = await pageEval(`document.querySelector('.profile-metrics')?.innerText || ''`);
  const metricText = metric?.value || '';
  const synced = selected && metricText.includes('缓存节点') && !metricText.includes('尚未同步');
  obs.sync = synced ? 'PASS' : 'FAIL';
  note(`SYNC selected=${selected} metric=${metricText.replace(/\\s+/g, ' ').slice(0, 180)}`);
  if (!synced) throw new Error('sync observation missing');
  const preview = await poll(async () => withPage(async (client) => {
    await client.call('Runtime.enable');
    const text = await client.eval(`document.querySelector('.content-preview')?.innerText || ''`);
    if (!text || text.includes('正在读取页面内容')) return null;
    return { text: String(text).replace(/data:[^\\s]+/g, '[data]').slice(0, 300) };
  }), 25000, 500);
  const previewText = preview && preview.text ? preview.text : '';
  obs.textPreview = previewText.includes('Example Domain') ? 'PASS' : 'FAIL';
  note(`TEXT_PREVIEW ${previewText.replace(/\\s+/g, ' ')}`);
  const opened = await clickButton('打开应用内网页');
  note(`click 打开应用内网页 ${opened}`);
  const windowSeen = await poll(async () => {
    const ui = await bodyHas('应用内网页已打开');
    const previewWindow = await helper('preview', ['-RootPid', String(run.pid)]);
    return ui && previewWindow.trim() === 'yes' ? true : null;
  }, 25000, 500);
  obs.previewWindow = windowSeen ? 'PASS' : 'FAIL';
  note(`PREVIEW_WINDOW ${windowSeen ? 'yes' : 'no'}`);
  await clickButton('关闭预览', 5000);
  const titled = await setField('edit-title', editedTitle);
  const previewed = titled && await clickButton('预览修改');
  const confirmedEdit = previewed && await clickButton('确认变更');
  note(`EDIT preview=${previewed} confirm=${confirmedEdit}`);
  const receipt = await poll(async () => (await bodyHas('回执已确认')) || null, 20000, 400);
  const rows = await poll(async () => {
    const list = await operations();
    return list.some((row) => row[1] === 'applied' && row[2] === 'update') ? list : null;
  }, 15000, 400);
  const chromeRows = await chromeBookmarks(editedTitle);
  const editOk = !!receipt && Array.isArray(rows) && chromeRows.length === 1 && chromeRows[0].url === exampleUrl;
  obs.editReceipt = editOk ? 'PASS' : 'FAIL';
  note(`EDIT_RECEIPT ui=${!!receipt} chrome=${chromeRows.length} operations=${JSON.stringify(rows)}`);
  if (!editOk) throw new Error('confirmed edit missing');
}
async function driveRecovery() {
  const run = await startApp();
  let restarted = null;
  try {
    const live = await waitLive();
    if (!live) { obs.recovery = 'FAIL'; throw new Error('recovery session was not live'); }
    const selected = await selectTitle(editedTitle);
    if (!selected) throw new Error('edited bookmark was not listed after restart');
    await setField('edit-title', unackedTitle);
    await setField('edit-url', unackedUrl);
    await sleep(200);
    if (!(await clickButton('预览新书签'))) throw new Error('create preview failed');
    const patched = await poll(async () => workerEval(`(() => { if (globalThis.__mb13Installed) return { installed: true, dropped: globalThis.__mb13Dropped || 0 }; const orig = WebSocket.prototype.send; globalThis.__mb13Orig = orig; globalThis.__mb13Dropped = 0; WebSocket.prototype.send = function (data) { const text = typeof data === 'string' ? data : ''; if (text.includes('operation_receipt')) { globalThis.__mb13Dropped += 1; return; } return orig.apply(this, arguments); }; globalThis.__mb13Installed = true; return { installed: true, dropped: 0 }; })()`), 15000, 400);
    if (!patched?.installed) throw new Error('ack drop was not installed');
    if (!(await clickButton('确认变更'))) throw new Error('unacked confirm failed');
    const before = await poll(async () => {
      const dropped = await workerEval(`globalThis.__mb13Dropped || 0`);
      const rows = await operations();
      const chromeRows = await chromeBookmarks(unackedTitle);
      const pending = Array.isArray(rows) && rows.some((row) => row[1] === 'applying' && row[2] === 'create' && row[3] === 0);
      if (dropped >= 1 && pending && chromeRows.length === 1) return { dropped, rows, ids: chromeRows.map((row) => row.id) };
      return null;
    }, 20000, 400);
    if (!before) { obs.recovery = 'FAIL'; throw new Error('applying unacked create was not observed'); }
    await workerEval(`(() => { if (globalThis.__mb13Orig) WebSocket.prototype.send = globalThis.__mb13Orig; globalThis.__mb13Installed = false; return globalThis.__mb13Dropped || 0; })()`);
    note(`UNACKED_BEFORE dropped=${before.dropped} ids=${before.ids.join(',')} operations=${JSON.stringify(before.rows)}`);
    const crashed = await killApp(run);
    exitCodes.crash = crashed.code;
    note(`CRASH code=${crashed.code}`);
    await poll(async () => (await portFree(bridgePort)) || null, 20000, 300);
    restarted = await startApp();
    const again = await waitLive();
    const after = await poll(async () => {
      const rows = await operations();
      const chromeRows = await chromeBookmarks(unackedTitle);
      if (!Array.isArray(rows) || !again) return null;
      const sameCount = chromeRows.length === before.ids.length && chromeRows.every((row) => before.ids.includes(row.id));
      const noExtraCreate = rows.filter((row) => row[2] === 'create').length === before.rows.filter((row) => row[2] === 'create').length;
      if (sameCount && noExtraCreate) return { rows, ids: chromeRows.map((row) => row.id) };
      return { failed: true, rows, ids: chromeRows.map((row) => row.id) };
    }, 20000, 500);
    obs.recovery = after && !after.failed ? 'PASS' : 'FAIL';
    note(`RECOVERY live=${!!again} after=${JSON.stringify(after)}`);
  } finally {
    const target = restarted || (run.child.exitCode === null ? run : null);
    if (obs.restartExit === 'NOT_RUN' && target) {
      try {
        const closed = await closeApp(target);
        exitCodes.restart = closed.code;
        obs.restartExit = closed.code === 0 ? 'PASS' : 'FAIL';
        note(`RESTART_EXIT code=${closed.code}`);
      } catch (error) {
        note(`RESTART_CLOSE ${redact(error.message)}`);
        const closed = await killApp(target).catch(() => ({ code: null }));
        exitCodes.restart = closed.code;
        obs.restartExit = 'FAIL';
      }
    }
  }
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
function judge() {
  const required = ['install', 'startExit', 'restartExit', 'uninstall', 'pairingLive', 'sync', 'textPreview', 'previewWindow', 'editReceipt', 'recovery', 'cmdkey', 'ebwebview'];
  const allPass = required.every((key) => obs[key] === 'PASS');
  obs.ac13_2 = allPass ? 'PASS' : 'FAIL';
  obs.v15 = allPass ? 'PASS' : 'FAIL';
}
async function main() {
  fs.writeFileSync(logPath, '');
  writeHelper();
  writePy();
  note(`runStart=${runStart.toISOString()}`);
  note(`installer=${fs.existsSync(installer)} chrome=${fs.existsSync(chromeExe)} extension=${fs.existsSync(path.join(extensionDir, 'manifest.json'))} websocket=${typeof WebSocket === 'function'}`);
  if (!fs.existsSync(installer) || !fs.existsSync(chromeExe) || !fs.existsSync(path.join(extensionDir, 'manifest.json')) || typeof WebSocket !== 'function' || !tempRoot) {
    note('preflight missing; no process started');
    return;
  }
  const beforeBookmarks = await bookmarks();
  const beforeCmd = await cmdkey();
  const beforeEb = await helper('eb', ['-Stamp', runStart.toISOString()]);
  note(`BEFORE bookmarks ${beforeBookmarks}`);
  note(`BEFORE cmdkey ${beforeCmd.text}`);
  note(`BEFORE eb ${beforeEb}`);
  const ollama = await run('where.exe', ['ollama']);
  obs.ai = 'NOT_RUN';
  note(`ollama code=${ollama.code} present=${ollama.code === 0}`);
  if (beforeBookmarks !== expectedBookmarks || beforeCmd.pairing !== 0 || beforeCmd.model !== 0) {
    bookmarksBad = beforeBookmarks !== expectedBookmarks;
    obs.cmdkey = beforeCmd.pairing === 0 && beforeCmd.model === 0 ? 'NOT_RUN' : 'FAIL';
    note('hard stop before any app or chrome process');
    return;
  }
  for (const dir of [installDir, appData, chromeDir, queryDir]) {
    if (fs.existsSync(dir)) await removeDir(dir);
  }
  webPort = await freePort();
  assertLaunchEnv(appEnv());
  if (!(await install())) return;
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(webviewDir, { recursive: true });
  try { await launchChrome(); } catch (error) { note(`CHROME ${redact(error.message)}`); extensionReady = false; }
  if (!extensionReady) { obs.pairingLive = 'NOT_RUN'; return; }
  const first = await startApp();
  try {
    await driveHappy(first);
  } catch (error) {
    note(`HAPPY ${redact(error.message)}`);
  }
  await clickButton('关闭预览', 5000);
  const firstExit = await closeApp(first);
  exitCodes.start = firstExit.code;
  obs.startExit = firstExit.code === 0 ? 'PASS' : 'FAIL';
  note(`START_EXIT code=${firstExit.code}`);
  await gate('after-start');
  if (obs.editReceipt !== 'PASS' || obs.pairingLive !== 'PASS') return;
  await poll(async () => (await portFree(bridgePort)) || null, 20000, 300);
  try {
    await driveRecovery();
  } catch (error) {
    note(`RECOVERY_ERROR ${redact(error.message)}`);
  }
}
async function finish() {
  for (const socket of sockets) { try { socket.close(); } catch { /* closed */ } }
  for (const run of appRuns) {
    if (run.child.exitCode === null && !run.child.killed) await killApp(run).catch(() => {});
  }
  if (chromeChild && chromeChild.exitCode === null) await run('taskkill', ['/PID', String(chromeChild.pid), '/T', '/F']).catch(() => {});
  await helper('killmarker').catch((error) => note(redact(error.message)));
  if (installed) await uninstall().catch((error) => note(`UNINSTALL ${redact(error.message)}`));
  const afterBookmarks = await bookmarks().catch((error) => `ERROR ${redact(error.message)}`);
  const afterCmd = await cmdkey().catch(() => ({ pairing: NaN, model: NaN, text: 'ERROR' }));
  const afterEb = await helper('eb', ['-Stamp', runStart.toISOString()]).catch((error) => `ERROR ${redact(error.message)}`);
  note(`AFTER bookmarks ${afterBookmarks}`);
  note(`AFTER cmdkey ${afterCmd.text}`);
  note(`AFTER eb ${afterEb}`);
  if (afterBookmarks !== expectedBookmarks) bookmarksBad = true;
  const cmdBefore = notes.some((line) => line.includes('BEFORE cmdkey pairing=0 model=0'));
  obs.cmdkey = cmdBefore && afterCmd.pairing === 0 && afterCmd.model === 0 ? 'PASS' : 'FAIL';
  const newer = Number(String(afterEb).match(/newer=(\d+)/)?.[1] ?? 'NaN');
  obs.ebwebview = newer === 0 ? 'PASS' : 'FAIL';
  const db = path.join(appData, 'markbridge.sqlite');
  note(`SQLITE exists=${fs.existsSync(db)} name=${path.basename(db)}`);
  note(`WEBVIEW temp exists=${fs.existsSync(webviewDir)}`);
  note(`desktop processes=${(await run('pwsh', ['-NoProfile', '-Command', "@(Get-Process -Name 'markbridge-desktop' -ErrorAction SilentlyContinue).Count"])).out}`);
  judge();
  const output = { runStart: runStart.toISOString(), bookmarksBad, expectedBookmarks, afterBookmarks, exitCodes, obs, notes };
  fs.writeFileSync(resultPath, JSON.stringify(output, null, 2));
  log(`RESULT ac13_2=${obs.ac13_2} v15=${obs.v15}`);
}
main().catch((error) => note(`MAIN ${redact(error && error.message ? error.message : error)}`)).finally(async () => {
  try { await finish(); } catch (error) { log(`FINISH ${redact(error && error.message ? error.message : error)}`); }
  process.exit(bookmarksBad ? 4 : 0);
});
