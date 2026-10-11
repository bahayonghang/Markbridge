import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../../../..');
const evidence = import.meta.dirname;
const commands = [
  'get_startup_state', 'get_bridge_state', 'start_bridge', 'begin_pairing', 'confirm_pairing',
  'cancel_pairing', 'revoke_pairing', 'reconnect_profile', 'enumerate_chrome_user_data',
  'attach_file_mirror', 'rescan_file_mirrors', 'detach_file_mirror', 'associate_file_mirror',
  'get_mirror_tree', 'cache_tree', 'cache_list', 'cache_search', 'cache_get', 'cache_count',
  'preview_edit', 'apply_edit', 'list_operations', 'review_operation', 'refresh_operations',
  'export_html', 'export_sidecar', 'tag_state', 'tag_command', 'preview_title_encoding',
  'apply_title_encoding', 'content_preview', 'cancel_content_preview', 'open_http_url',
  'open_web_preview', 'web_preview_action', 'clear_web_preview_session', 'web_preview_state',
];
const reports = [];
let job = { op: 'wait' };
const facts = {
  checks: {},
  details: {},
  screenshots: [],
  commandsTried: commands,
};

function pageHtml() {
  return `<!doctype html><meta charset="utf-8"><title>mb09</title><p id="mb09">mb09</p><script>
const COMMANDS = ${JSON.stringify(commands)};
function storage() {
  return { href: location.pathname, prior: localStorage.getItem('mb09'), cookie: document.cookie, mainKey: localStorage.getItem('mb09main'), history: history.length };
}
async function post(body) {
  await fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
post(Object.assign({ kind: 'hello' }, storage())).catch(() => {});
setInterval(async () => {
  try {
    const response = await fetch('/next', { cache: 'no-store' });
    const next = await response.json();
    if (!next || next.op === 'wait') return;
    if (next.op === 'invoke') {
      const results = [];
      for (const name of COMMANDS) {
        const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
        if (typeof invoke !== 'function') { results.push({ name, outcome: 'NO_IPC' }); continue; }
        try {
          await Promise.race([
            invoke(name, {}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2000)),
          ]);
          results.push({ name, outcome: 'ACCEPTED' });
        } catch (error) {
          results.push({ name, outcome: 'DENIED', message: String(error && (error.message || error)).slice(0, 160) });
        }
      }
      await post({ kind: 'job', op: 'invoke', results });
      return;
    }
    if (next.op === 'store') {
      const before = localStorage.getItem('mb09');
      localStorage.setItem('mb09', location.pathname);
      document.cookie = 'mb09=' + encodeURIComponent(location.pathname) + '; path=/; max-age=86400';
      await post({ kind: 'job', op: 'store', before, now: location.pathname, href: location.pathname, cookie: document.cookie, mainKey: localStorage.getItem('mb09main'), history: history.length });
      return;
    }
    if (next.op === 'read') {
      await post(Object.assign({ kind: 'job', op: 'read' }, storage()));
      return;
    }
    if (next.op === 'go') { location.href = '/a2'; return; }
    if (next.op === 'scheme') {
      await post({ kind: 'job', op: 'scheme', href: location.pathname, history: history.length });
      location.href = 'javascript:void(0)';
      const link = document.createElement('a');
      link.href = 'javascript:void(0)';
      link.textContent = 'js';
      document.body.appendChild(link);
      link.click();
      return;
    }
    if (next.op === 'file') {
      await post({ kind: 'job', op: 'file', href: location.pathname, history: history.length });
      location.href = 'file:///C:/Windows/win.ini';
      const link = document.createElement('a');
      link.href = 'file:///C:/Windows/win.ini';
      link.textContent = 'file';
      document.body.appendChild(link);
      link.click();
      return;
    }
    if (next.op === 'userinfo') { await post({ kind: 'job', op: 'userinfo', href: location.pathname }); location.href = 'http://mb09:mb09@127.0.0.1:' + location.port + '/userinfo'; return; }
    if (next.op === 'popup') { window.open('/popup', '_blank', 'noopener'); await post({ kind: 'job', op: 'popup', href: location.pathname }); return; }
    if (next.op === 'download') {
      const link = document.createElement('a');
      link.href = '/download.bin';
      link.download = 'mb09.bin';
      document.body.appendChild(link);
      link.click();
      await post({ kind: 'job', op: 'download', href: location.pathname });
    }
  } catch {}
}, 250);
</script>`;
}

function startProbe() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/next') {
      const body = JSON.stringify(job);
      job = { op: 'wait' };
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (url.pathname === '/report' && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => {
        chunks.push(chunk);
        if (chunks.reduce((sum, item) => sum + item.length, 0) > 20000) request.destroy();
      });
      request.on('end', () => {
        try { reports.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reports.push({ kind: 'bad' }); }
        response.writeHead(204);
        response.end();
      });
      return;
    }
    if (url.pathname === '/download.bin') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="mb09.bin"',
      });
      response.end('mb09');
      return;
    }
    if (['/a', '/a2', '/b', '/popup', '/userinfo'].includes(url.pathname)) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(pageHtml());
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server));
  });
}

function execText(file, args, timeout = 20000) {
  return new Promise((resolveExec) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolveExec({ error: error ? String(error.message).slice(0, 200) : null, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function portOpen(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) });
    return true;
  } catch {
    return false;
  }
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, options);
  let text = '';
  const take = (chunk) => {
    text += chunk.toString();
    if (text.length > 4000) text = text.slice(-4000);
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  child.logText = () => text;
  return child;
}

function killTree(child) {
  if (!child?.pid || child.exitCode != null) return Promise.resolve();
  return new Promise((resolveKill) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('exit', () => resolveKill());
  });
}

async function waitFor(predicate, timeout, interval = 200) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await delay(interval);
  }
  return last;
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const opened = new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', () => resolveOpen());
    ws.addEventListener('error', () => reject(new Error('CDP_SOCKET')));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data.toString());
    const resolveMessage = pending.get(message.id);
    if (resolveMessage) {
      pending.delete(message.id);
      resolveMessage(message);
    }
  });
  return {
    async eval(expression, timeout = 8000) {
      await opened;
      const id = ++seq;
      const message = await new Promise((resolveMessage, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP_EVAL')), timeout);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolveMessage(value);
        });
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }));
      });
      if (message.result?.exceptionDetails) return { error: message.result.exceptionDetails.text || 'CDP_EXCEPTION' };
      return { value: message.result?.result?.value };
    },
    close() { ws.close(); },
  };
}

async function findMain(debugPort) {
  return waitFor(async () => {
    try {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      return list.find((item) => item.type === 'page' && String(item.url || '').includes('127.0.0.1:1420') && item.webSocketDebuggerUrl) || null;
    } catch {
      return null;
    }
  }, 30000, 300);
}

async function panelText(session) {
  const result = await session.eval(`document.querySelector('.web-preview')?.innerText ?? ''`);
  return String(result.value || '');
}

async function waitPanel(session, needle, timeout = 15000) {
  const found = await waitFor(async () => {
    const text = await panelText(session);
    return text.includes(needle) ? text : null;
  }, timeout, 200);
  return found || await panelText(session);
}

async function buttonStates(session) {
  const result = await session.eval(`JSON.stringify([...document.querySelectorAll('.web-preview button')].map((button) => ({ name: button.textContent, disabled: button.disabled })))`);
  return JSON.parse(result.value || '[]');
}

async function clickButton(session, name) {
  const result = await session.eval(`(() => {
    const button = [...document.querySelectorAll('.web-preview button')].find((item) => item.textContent === ${JSON.stringify(name)});
    if (!button) return 'MISSING';
    if (button.disabled) return 'DISABLED';
    button.click();
    return 'CLICKED';
  })()`);
  return result.value;
}

async function waitButton(session, name, enabled, timeout = 10000) {
  return waitFor(async () => {
    const states = await buttonStates(session);
    const found = states.find((item) => item.name === name);
    if (!found) return null;
    if (enabled && found.disabled) return null;
    if (!enabled && !found.disabled) return null;
    return found;
  }, timeout, 200);
}

async function clickRow(session, id) {
  return waitFor(async () => {
    const result = await session.eval(`(() => {
      const row = document.getElementById(${JSON.stringify(id)});
      if (!row) return '';
      row.click();
      return 'CLICKED';
    })()`);
    return result.value === 'CLICKED' ? 'CLICKED' : null;
  }, 12000, 200);
}

async function selectProfile(session, id) {
  const result = await session.eval(`(() => {
    const select = document.getElementById('library-source');
    if (!select) return 'NO_SELECT';
    const value = ${JSON.stringify('profile:')}+${JSON.stringify(id)};
    if (![...select.options].some((option) => option.value === value)) return 'NO_OPTION:' + [...select.options].map((option) => option.value).join(',');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  return result.value;
}

function waitHello(path, fromIndex, timeout = 15000) {
  return waitFor(async () => reports.slice(fromIndex).find((item) => item.kind === 'hello' && item.href === path) || null, timeout, 150);
}

function waitJob(op, fromIndex, timeout = 20000) {
  return waitFor(async () => reports.slice(fromIndex).find((item) => item.kind === 'job' && item.op === op) || null, timeout, 150);
}

async function printWindow(pid, titleLike, fileName) {
  const outPath = join(evidence, fileName);
  const result = await execText('pwsh', ['-NoProfile', '-Sta', '-File', join(evidence, 'print-window.ps1'), '-ProcessId', String(pid), '-TitleLike', titleLike, '-OutPath', outPath]);
  facts.screenshots.push({ file: fileName, exitError: result.error, line: result.stdout.trim().slice(0, 400) });
  return result.stdout.includes('PRINT_OK=True');
}

async function sessionNames(appData) {
  const root = join(appData, 'preview-sessions');
  const names = await readdir(root).catch(() => []);
  return names.filter((name) => name !== '.' && name !== '..');
}

const seedPy = String.raw`
import json, sqlite3, sys
db, port = sys.argv[1], sys.argv[2]
base = "http://127.0.0.1:" + port

def node(chrome, parent, position, kind, title, url, folder):
    payload = {
        "chromeId": chrome, "parentId": parent, "position": position, "kind": kind,
        "title": title, "url": url, "folderType": folder, "unmodifiable": None,
        "dateAdded": None, "dateLastUsed": None,
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

profiles = [
    ("pa09", "ia09", "资料 A", "chrome-extension://" + ("a" * 32), "sa09", [
        ("1", None, 0, "folder", "书签栏", None, "bookmarks-bar"),
        ("10", "1", 0, "bookmark", "探针 A", base + "/a", None),
        ("11", "1", 1, "bookmark", "打不开的网页", "http://127.0.0.1:1/mb09-fail", None),
        ("12", "1", 2, "bookmark", "脚本链接", "javascript:void(0)", None),
    ]),
    ("pb09", "ib09", "资料 B", "chrome-extension://" + ("b" * 32), "sb09", [
        ("1", None, 0, "folder", "书签栏", None, "bookmarks-bar"),
        ("10", "1", 0, "bookmark", "探针 B", base + "/b", None),
    ]),
]
con = sqlite3.connect(db, timeout=5)
row = con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").fetchone()
if row is None:
    raise SystemExit("NO_SCHEMA")
con.execute("DELETE FROM bookmark_tags")
con.execute("DELETE FROM bookmark_metadata")
con.execute("DELETE FROM source_cursors")
con.execute("DELETE FROM bookmarks_cache")
con.execute("DELETE FROM profiles")
for pid, iid, name, origin, sid, nodes in profiles:
    con.execute("INSERT INTO profiles(id,instance_id,source_epoch,display_name,pairing_state,last_synced_at,paired_origin,credential_reference) VALUES(?,?,1,?,'paired',NULL,?,NULL)", (pid, iid, name, origin))
    con.execute("INSERT INTO source_cursors(profile_id,source_epoch,session_id,last_seq,revision) VALUES(?,1,?,1,1)", (pid, sid))
    for chrome, parent, pos, kind, title, url, folder in nodes:
        con.execute("INSERT INTO bookmarks_cache(profile_id,source_epoch,chrome_id,parent_id,position,node_kind,title,url,folder_type,unmodifiable,node_json,revision,deleted_at) VALUES(?,1,?,?,?,?,?,?,?,NULL,?,1,NULL)", (pid, chrome, parent, pos, kind, title, url, folder, node(chrome, parent, pos, kind, title, url, folder)))
con.commit()
con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
print("SEED_OK")
`;

async function seedDatabase(database, port) {
  const script = join(evidence, 'seed-preview.py');
  await writeFile(script, seedPy, 'utf8');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await execText('python', [script, database, String(port)]);
    if (result.stdout.includes('SEED_OK')) return result.stdout.trim();
    facts.details.seedAttempt = (result.stderr || result.stdout || result.error || '').slice(0, 300);
    await delay(400);
  }
  throw new Error('SEED_FAILED');
}

async function markbridgeCredentialSummary() {
  const result = await execText('cmdkey', ['/list']);
  const lines = result.stdout.split(/\r?\n/).filter((line) => /Markbridge/i.test(line));
  return { markbridgeLines: lines.length, hasPairing: lines.some((line) => line.includes('Markbridge.Pairing')) };
}

const failUrl = 'http://127.0.0.1:1/mb09-fail';

async function readPid(path) {
  const text = await readFile(path, 'utf8').catch(() => '');
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function killPid(pid) {
  if (!pid) return;
  await execText('taskkill', ['/PID', String(pid), '/F']);
}

const openerScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Mb09ThreadQuery {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")]
  public static extern int NtQueryInformationThread(IntPtr thread, int cls, out uint info, int len, IntPtr ret);
}
'@
$pidValue = __PID__
$p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue"
if (-not $p) { '{"missing":true}'; exit 0 }
$cmd = [string]$p.CommandLine
$needle = '__URL__'
$handler = $cmd.Contains('url.dll,FileProtocolHandler')
$urlMatched = $cmd.Contains($needle)
$kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $pidValue").Count
$threads = @(Get-CimInstance Win32_Thread -Filter "ProcessHandle = $pidValue")
$suspended = @($threads | Where-Object { $_.ThreadState -eq 5 -and $_.ThreadWaitReason -eq 5 }).Count
$state = 'NONE'
if ($threads.Count -gt 0) { $state = '{0}:{1}' -f $threads[0].ThreadState, $threads[0].ThreadWaitReason }
$nt = -2
$suspend = 0
if ($threads.Count -gt 0) {
  $opened = [Mb09ThreadQuery]::OpenThread([uint32]0x0840, $false, [uint32]$threads[0].Handle)
  if ($opened -ne [IntPtr]::Zero) {
    $value = [uint32]0
    $nt = [Mb09ThreadQuery]::NtQueryInformationThread($opened, 35, [ref]$value, 4, [IntPtr]::Zero)
    $suspend = [int]$value
    [void][Mb09ThreadQuery]::CloseHandle($opened)
  }
}
$out = [ordered]@{
  missing = $false
  parent = [int]$p.ParentProcessId
  imageName = [string]$p.Name
  commandLine = $cmd
  handler = [bool]$handler
  urlMatched = [bool]$urlMatched
  childCount = [int]$kids
  threadCount = [int]$threads.Count
  suspendedThreadCount = [int]$suspended
  threadState = [string]$state
  ntStatus = [int]$nt
  suspendCount = [int]$suspend
}
$out | ConvertTo-Json -Compress
`;

async function openerObservation(pid) {
  const command = openerScript.replace('__PID__', String(Number(pid))).replace('__URL__', failUrl);
  const result = await execText('pwsh', ['-NoProfile', '-Command', command], 45000);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  try {
    return JSON.parse(line);
  } catch {
    return { missing: true, parseFailed: true };
  }
}

async function processAlive(pid) {
  const result = await execText('pwsh', ['-NoProfile', '-Command', `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { 'ALIVE' } else { 'GONE' }`]);
  return result.stdout.trim() === 'ALIVE';
}

async function handlerPidSet() {
  const result = await execText('pwsh', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name = 'rundll32.exe'\" | Where-Object { $_.CommandLine -like '*FileProtocolHandler*' -and $_.CommandLine -like '*http://127.0.0.1:1/mb09-fail*' } | ForEach-Object { $_.ProcessId }) -join ','"]);
  return new Set(result.stdout.trim().split(',').filter(Boolean));
}

async function imagePidSet() {
  const result = await execText('pwsh', ['-NoProfile', '-Command', "$names = @('chrome','Tabbit Browser','msedge'); $ids = foreach ($name in $names) { Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object Id }; ($ids | Sort-Object -Unique) -join ','"]);
  return result.stdout.trim();
}

async function bookmarkSnapshot() {
  const root = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  const profiles = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (!profiles) return { present: false, files: [] };
  const files = [];
  for (const entry of profiles) {
    if (!entry.isDirectory()) continue;
    const bookmarks = join(root, entry.name, 'Bookmarks');
    let data;
    try {
      data = await readFile(bookmarks);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) continue;
      const code = error && error.code ? error.code : 'READ';
      throw new Error(`BOOKMARK_READ_FAILED ${entry.name} ${code}`);
    }
    files.push({
      profile: entry.name,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  files.sort((left, right) => left.profile.localeCompare(right.profile));
  return { present: true, files };
}

function bookmarksMatch(before, after) {
  if (!before || !after || before.present !== after.present || before.files.length !== after.files.length) {
    return { bytesUnchanged: false, sha256Unchanged: false };
  }
  let bytesUnchanged = true;
  let sha256Unchanged = true;
  for (let index = 0; index < before.files.length; index += 1) {
    const left = before.files[index];
    const right = after.files[index];
    if (left.profile !== right.profile) return { bytesUnchanged: false, sha256Unchanged: false };
    if (left.bytes !== right.bytes) bytesUnchanged = false;
    if (left.sha256 !== right.sha256) sha256Unchanged = false;
  }
  return { bytesUnchanged, sha256Unchanged };
}

async function extensionStamp() {
  const root = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  const profiles = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (!profiles) return 'ABSENT';
  const lines = [];
  for (const entry of profiles) {
    if (!entry.isDirectory()) continue;
    const extensions = join(root, entry.name, 'Extensions');
    const ids = await readdir(extensions, { withFileTypes: true }).catch(() => []);
    for (const id of ids) {
      if (!id.isDirectory()) continue;
      const idStat = await stat(join(extensions, id.name)).catch(() => null);
      const versions = await readdir(join(extensions, id.name)).catch(() => []);
      lines.push(`e ${entry.name} ${id.name} ${versions.length} ${idStat ? idStat.mtimeMs : 0}`);
    }
  }
  lines.sort();
  return lines.join('\n');
}

async function killStrayOpener() {
  const result = await execText('pwsh', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name = 'rundll32.exe'\" | Where-Object { $_.CommandLine -like '*FileProtocolHandler*' -and $_.CommandLine -like '*mb09-fail*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"]);
  return result.error;
}

let vite = null;
let desktop = null;
let server = null;
let session = null;
let tempRoot = null;
let openerPid = null;

try {
  const beforeKeys = await markbridgeCredentialSummary();
  facts.details.cmdkeyBefore = beforeKeys;
  if (await portOpen(1420) || await portOpen(9347)) throw new Error('PORT_BUSY');
  const listed = await execText('tasklist', ['/FI', 'IMAGENAME eq markbridge-desktop.exe']);
  if (/markbridge-desktop.exe/i.test(listed.stdout)) throw new Error('EXISTING_PROCESS');
  tempRoot = await mkdtemp(join(tmpdir(), 'mb09-preview-'));
  const appData = join(tempRoot, 'app-data');
  if (!resolve(appData).includes(':\\') && !resolve(appData).includes(':/')) throw new Error('APP_DATA_NOT_ABSOLUTE');
  if (appData.toLowerCase().includes('com.markbridge.desktop')) throw new Error('APP_DATA_FORBIDDEN');
  facts.details.appData = appData;
  server = await startProbe();
  const probePort = server.address().port;
  facts.details.probePort = probePort;
  vite = spawnLogged('pnpm --filter @markbridge/desktop dev', [], { cwd: repo, shell: true, windowsHide: true });
  if (!await waitFor(async () => await portOpen(1420), 30000, 300)) throw new Error('VITE_FAILED');
  const exe = resolve(repo, 'target/debug/markbridge-desktop.exe');
  const pidFile = join(tempRoot, 'open-http.pid');
  const env = {
    ...process.env,
    MARKBRIDGE_APP_DATA: appData,
    MARKBRIDGE_CREDENTIAL_NAMESPACE: 'Markbridge.Task05.mb09',
    MARKBRIDGE_OPEN_HTTP_SUSPEND: '1',
    MARKBRIDGE_OPEN_HTTP_PIDFILE: pidFile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9347 --remote-allow-origins=*',
  };
  delete env.WEBVIEW2_USER_DATA_FOLDER;
  const boot = () => spawnLogged(exe, [], { cwd: repo, env, windowsHide: false });
  desktop = boot();
  const database = join(appData, 'markbridge.sqlite');
  const created = await waitFor(async () => {
    const names = await readdir(appData).catch(() => []);
    return names.includes('markbridge.sqlite') ? database : null;
  }, 30000, 300);
  if (!created) throw new Error(`NO_DATABASE ${desktop.logText().slice(-300)}`);
  await delay(800);
  await killTree(desktop);
  desktop = null;
  await waitFor(async () => await portOpen(9347) ? null : 'CLOSED', 10000, 200);
  facts.details.seed = await seedDatabase(database, probePort);
  desktop = boot();
  const attach = async () => {
    const target = await findMain(9347);
    if (!target) return null;
    return connectCdp(target.webSocketDebuggerUrl);
  };
  const libraryReady = async (timeout) => waitFor(async () => {
    const result = await session.eval(`document.getElementById('library-source') ? 'READY' : ''`);
    return result.value === 'READY' ? 'READY' : null;
  }, timeout, 250);
  session = await attach();
  if (!session) throw new Error(`NO_CDP ${desktop.logText().slice(-400)}`);
  await waitFor(async () => {
    const result = await session.eval(`Boolean(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) ? 'YES' : ''`);
    return result.value === 'YES' ? 'YES' : null;
  }, 15000, 200);
  let sourceReady = await libraryReady(4000);
  if (!sourceReady) {
    await session.eval(`location.reload()`);
    session.close();
    session = null;
    await delay(800);
    session = await attach();
    if (!session) throw new Error('NO_CDP_RELOAD');
    sourceReady = await libraryReady(15000);
  }
  if (!sourceReady) {
    const body = await session.eval(`document.body?.innerText?.slice(0, 900) ?? ''`).catch((error) => ({ value: String(error) }));
    const href = await session.eval(`location.href`).catch(() => ({ value: '' }));
    const ipc = await session.eval(`(async () => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== 'function') return 'NO_IPC';
      try {
        const bridge = await internals.invoke('get_bridge_state');
        let parsed = 'SKIP';
        try {
          const backend = await import('/src/backend.ts');
          await backend.getStartupState();
          const state = await backend.getBridgeState();
          parsed = 'OK ' + state.profiles.length;
        } catch (error) {
          parsed = 'PARSE ' + String(error && (error.message || error)).slice(0, 240);
        }
        return JSON.stringify({ parsed, bridge }).slice(0, 1800);
      } catch (error) {
        return 'ERR ' + String(error && (error.message || error)).slice(0, 500);
      }
    })()`).catch((error) => ({ value: String(error) }));
    facts.details.libraryMiss = { href: href.value, body: body.value, ipc: ipc.value, log: desktop.logText().slice(-500) };
    throw new Error('NO_LIBRARY');
  }
  facts.checks.profileSelected = (await selectProfile(session, 'pa09')) === 'profile:pa09';
  facts.checks.bookmarkA = (await clickRow(session, 'library-row-profile:pa09:10')) === 'CLICKED';
  const opened = await waitButton(session, '打开应用内网页', true, 8000);
  const beforeOpen = reports.length;
  facts.checks.openClicked = opened ? (await clickButton(session, '打开应用内网页')) === 'CLICKED' : false;
  const helloA = await waitHello('/a', beforeOpen, 25000);
  const readyText = await waitPanel(session, '应用内网页已打开', 20000);
  facts.details.readyText = readyText.slice(0, 700);
  facts.checks.relationship = readyText.includes('当前资料：资料 A') && readyText.includes('选中网址：') && readyText.includes('/a') && readyText.includes('应用内网页已打开');
  facts.checks.sessionCopy = readyText.includes('关闭预览窗口后，当前资料的预览会话会保留') && readyText.includes('不读取 Chrome 的登录状态');
  await delay(600);
  facts.checks.previewShot = await printWindow(desktop.pid, '网页预览', 'native-preview-ready.png');
  facts.checks.mainShot = await printWindow(desktop.pid, '签桥', 'native-main-ready.png');
  facts.checks.previewFocused = facts.screenshots.some((shot) => shot.file === 'native-preview-ready.png' && /PRINT_OK=True/.test(shot.line) && /FG_SAME=True/.test(shot.line));
  const hwnd = (file) => {
    const shot = facts.screenshots.find((item) => item.file === file);
    const match = /HWND=(\d+)/.exec(shot?.line || '');
    return match ? match[1] : '';
  };
  facts.checks.distinctPreviewWindow = Boolean(hwnd('native-preview-ready.png')) && hwnd('native-preview-ready.png') !== hwnd('native-main-ready.png');
  try {
    const list = await fetch('http://127.0.0.1:9347/json/list').then((response) => response.json());
    const preview = list.find((item) => item.type === 'page' && String(item.url || '').includes(`127.0.0.1:${probePort}`) && item.webSocketDebuggerUrl);
    facts.details.previewTarget = Boolean(preview);
    if (preview) {
      const previewSession = await connectCdp(preview.webSocketDebuggerUrl);
      const where = await previewSession.eval(`location.pathname + '|' + (document.getElementById('mb09') ? 'PAGE' : 'NO')`);
      const denied = await previewSession.eval(`(async () => {
        const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
        if (typeof invoke !== 'function') return 'NO_IPC';
        try {
          await invoke('get_startup_state', {});
          return 'ACCEPTED';
        } catch (error) {
          return 'DENIED ' + String(error && (error.message || error)).slice(0, 160);
        }
      })()`);
      previewSession.close();
      facts.details.previewCdp = { where: where.value || null, denied: String(denied.value || '').slice(0, 180) };
      facts.checks.previewCdpDenied = String(where.value || '').startsWith('/a|PAGE') && String(denied.value || '').startsWith('DENIED') && String(denied.value || '').includes('not allowed');
    }
  } catch (error) {
    facts.details.previewCdp = { error: String(error && error.message || error).slice(0, 160) };
  }
  const storeFrom = reports.length;
  job = { op: 'store' };
  const stored = await waitJob('store', storeFrom, 8000);
  facts.details.stored = stored;
  facts.checks.storedA = stored?.now === '/a' && stored?.before == null;
  const invokeFrom = reports.length;
  job = { op: 'invoke' };
  const invoked = await waitJob('invoke', invokeFrom, 30000);
  const results = invoked?.results || [];
  facts.details.invokeCounts = results.reduce((counts, item) => {
    counts[item.outcome] = (counts[item.outcome] || 0) + 1;
    return counts;
  }, {});
  facts.details.invokeSample = results.slice(0, 4).map((item) => ({ name: item.name, outcome: item.outcome, message: item.message || null }));
  const probeInMain = await session.eval(`document.getElementById('mb09') ? 'YES' : 'NO'`);
  facts.checks.probeNotInMain = probeInMain.value === 'NO';
  const mainInvoke = await session.eval(`(async () => {
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (typeof invoke !== 'function') return 'NO_IPC';
    try {
      const state = await invoke('get_bridge_state', {});
      const count = state && Array.isArray(state.profiles) ? state.profiles.length : -1;
      return 'MAIN_OK ' + count;
    } catch (error) {
      return 'MAIN_ERR ' + String(error && (error.message || error)).slice(0, 180);
    }
  })()`);
  facts.details.mainInvoke = String(mainInvoke.value || '').slice(0, 200);
  facts.checks.mainCommandAllowed = facts.details.mainInvoke.startsWith('MAIN_OK');
  facts.checks.commandsDenied = results.length === commands.length
    && results.every((item) => item.outcome === 'DENIED' && String(item.message || '').includes('not allowed'))
    && facts.checks.mainCommandAllowed
    && !facts.details.mainInvoke.includes('not allowed');
  const historyFrom = reports.length;
  job = { op: 'go' };
  const helloA2 = await waitHello('/a2', historyFrom, 10000);
  const backEnabled = await waitButton(session, '后退', true, 8000);
  if (!backEnabled) facts.details.backButtons = await buttonStates(session);
  const backFrom = reports.length;
  facts.checks.backClicked = backEnabled ? (await clickButton(session, '后退')) === 'CLICKED' : false;
  const helloBack = await waitHello('/a', backFrom, 8000);
  const forwardEnabled = await waitButton(session, '前进', true, 8000);
  const forwardFrom = reports.length;
  facts.checks.forwardClicked = forwardEnabled ? (await clickButton(session, '前进')) === 'CLICKED' : false;
  const helloForward = await waitHello('/a2', forwardFrom, 8000);
  const reloadFrom = reports.length;
  facts.checks.reloadClicked = (await clickButton(session, '刷新')) === 'CLICKED';
  const helloReload = await waitHello('/a2', reloadFrom, 8000);
  const historyText = await panelText(session);
  facts.details.history = { helloA2: helloA2?.href || null, helloBack: helloBack?.href || null, helloForward: helloForward?.href || null, helloReload: helloReload?.href || null, text: historyText.slice(0, 400) };
  facts.checks.history = Boolean(helloA2 && helloBack && helloForward && helloReload) && historyText.includes('/a2') && historyText.includes('选中网址：') && historyText.includes('/a');
  async function notice(op, needle) {
    const from = reports.length;
    job = { op };
    await waitJob(op, from, 8000);
    const text = await waitPanel(session, needle, 5000);
    return text.includes(needle);
  }
  facts.checks.schemeDenied = await notice('scheme', '只打开 http 或 https 网页');
  job = { op: 'go' };
  await waitHello('/a2', reports.length, 8000);
  facts.checks.fileDenied = await notice('file', '只打开 http 或 https 网页');
  job = { op: 'go' };
  await waitHello('/a2', reports.length, 8000);
  facts.checks.userinfoDenied = await notice('userinfo', '地址包含登录信息');
  facts.checks.popupBlocked = await notice('popup', '已拦截预览窗口的弹窗');
  facts.checks.downloadBlocked = await notice('download', '已拦截预览窗口的下载');
  facts.checks.noPopupPage = !reports.some((item) => item.href === '/popup');
  facts.checks.noFilePage = !reports.some((item) => String(item.href || '').startsWith('file'));
  const downloads = join(process.env.USERPROFILE || '', 'Downloads', 'mb09.bin');
  const downloadLanded = await execText('pwsh', ['-NoProfile', '-Command', `Test-Path -LiteralPath '${downloads.replaceAll("'", "''")}'`]);
  facts.checks.downloadNotSaved = !/True/.test(downloadLanded.stdout);
  if (/True/.test(downloadLanded.stdout)) await execText('pwsh', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${downloads.replaceAll("'", "''")}' -Force`]);
  const dirsBeforeClose = await sessionNames(appData);
  facts.checks.closeClicked = (await clickButton(session, '关闭预览')) === 'CLICKED';
  const closedText = await waitPanel(session, '尚未打开应用内网页', 8000);
  const dirsAfterClose = await sessionNames(appData);
  facts.checks.sessionKept = closedText.includes('尚未打开应用内网页') && dirsAfterClose.length === dirsBeforeClose.length && dirsAfterClose.length === 1 && dirsAfterClose.every((name) => /^[0-9a-f]+$/.test(name));
  const reopenFrom = reports.length;
  facts.checks.reopenClicked = (await clickButton(session, '打开应用内网页')) === 'CLICKED';
  const reopened = await waitHello('/a', reopenFrom, 20000);
  facts.details.reopened = reopened;
  facts.checks.sessionRestored = reopened?.prior === '/a' && String(reopened?.cookie || '').includes('mb09=%2Fa');
  await clickButton(session, '关闭预览');
  await waitPanel(session, '尚未打开应用内网页', 8000);
  facts.checks.profileBSelected = (await selectProfile(session, 'pb09')) === 'profile:pb09';
  facts.checks.bookmarkB = (await clickRow(session, 'library-row-profile:pb09:10')) === 'CLICKED';
  const beforeB = reports.length;
  const openedB = await waitButton(session, '打开应用内网页', true, 8000);
  facts.checks.openB = openedB ? (await clickButton(session, '打开应用内网页')) === 'CLICKED' : false;
  const helloB = await waitHello('/b', beforeB, 20000);
  facts.details.helloB = helloB;
  const storeBFrom = reports.length;
  job = { op: 'store' };
  const storedB = await waitJob('store', storeBFrom, 8000);
  facts.checks.isolatedFromA = helloB?.prior == null && !String(helloB?.cookie || '').includes('%2Fa') && storedB?.now === '/b' && storedB?.before == null;
  const mainStore = await session.eval(`localStorage.setItem('mb09main','main'); localStorage.getItem('mb09')`);
  const readFrom = reports.length;
  job = { op: 'read' };
  const readB = await waitJob('read', readFrom, 8000);
  facts.checks.mainIsolated = mainStore.value == null && readB?.mainKey == null;
  const dirsBoth = await sessionNames(appData);
  facts.checks.twoSessionDirs = dirsBoth.length === 2 && dirsBoth.every((name) => /^[0-9a-f]+$/.test(name));
  facts.checks.backToA = (await selectProfile(session, 'pa09')) === 'profile:pa09';
  facts.checks.bookmarkA2 = (await clickRow(session, 'library-row-profile:pa09:10')) === 'CLICKED';
  const otherProfile = await waitPanel(session, '预览窗口当前属于另一个资料', 8000);
  facts.checks.otherProfileLabel = otherProfile.includes('预览窗口当前属于另一个资料');
  facts.checks.clearArmed = (await clickButton(session, '清除此资料的预览会话')) === 'CLICKED';
  const clearReady = await waitButton(session, '确认清除预览会话', true, 4000);
  facts.checks.clearClicked = clearReady ? (await clickButton(session, '确认清除预览会话')) === 'CLICKED' : false;
  const clearedText = await waitPanel(session, '已清除此资料的预览会话', 8000);
  const dirsAfterClear = await sessionNames(appData);
  facts.checks.clearedA = clearedText.includes('已清除此资料的预览会话') && dirsAfterClear.length === 1;
  const afterClearFrom = reports.length;
  facts.checks.reopenAfterClear = (await clickButton(session, '打开应用内网页')) === 'CLICKED';
  const clearedHello = await waitHello('/a', afterClearFrom, 20000);
  facts.details.clearedHello = clearedHello;
  facts.checks.clearedStorage = clearedHello?.prior == null && !String(clearedHello?.cookie || '').includes('mb09=');
  facts.checks.failBookmark = (await clickRow(session, 'library-row-profile:pa09:11')) === 'CLICKED';
  const failClicked = await waitButton(session, '打开应用内网页', true, 8000);
  facts.checks.failOpen = failClicked ? (await clickButton(session, '打开应用内网页')) === 'CLICKED' : false;
  const failText = await waitPanel(session, '此网站没有在应用内网页中打开', 15000);
  const failButtons = await buttonStates(session);
  const chromeButton = failButtons.find((item) => item.name === '在 Chrome 中打开');
  facts.details.failText = failText.slice(0, 500);
  facts.checks.failStatus = failText.includes('此网站没有在应用内网页中打开。可以转到 Chrome。') && failText.includes('应用不保证该网站或 Chrome 登录状态可用。');
  facts.checks.chromeButtonEnabled = Boolean(chromeButton && chromeButton.disabled === false);
  await session.eval(`document.querySelector('.web-preview')?.scrollIntoView({ block: 'center' })`);
  await delay(300);
  facts.checks.failShot = await printWindow(desktop.pid, '签桥', 'native-main-failed.png');
  const chromeBefore = await bookmarkSnapshot();
  const extensionsBefore = await extensionStamp();
  const browsersBefore = await imagePidSet();
  const handlersBefore = await handlerPidSet();
  const pidBeforeClick = await readPid(pidFile);
  facts.checks.chromeClicked = (await clickButton(session, '在 Chrome 中打开')) === 'CLICKED';
  openerPid = await waitFor(async () => readPid(pidFile), 8000);
  const openedPid = openerPid;
  const observed = openedPid ? await openerObservation(openedPid) : { missing: true };
  const commandLine = observed.missing ? '' : String(observed.commandLine ?? '');
  const handler = commandLine.includes('url.dll,FileProtocolHandler');
  const urlMatched = commandLine.includes(failUrl);
  const aliveBeforeKill = openedPid ? await processAlive(openedPid) : false;
  let goneAfterKill = false;
  if (openedPid) {
    await killPid(openedPid);
    openerPid = null;
    goneAfterKill = await waitFor(async () => (await processAlive(openedPid)) ? null : true, 3000, 150) === true;
  }
  await delay(400);
  const chromeAfter = await bookmarkSnapshot();
  const bookmarkCompare = bookmarksMatch(chromeBefore, chromeAfter);
  const extensionsAfter = await extensionStamp();
  const browsersAfter = await imagePidSet();
  const previousBrowsers = new Set(browsersBefore.split(',').filter(Boolean));
  const addedBrowsers = browsersAfter.split(',').filter(Boolean).filter((pid) => !previousBrowsers.has(pid));
  const parentIsDesktop = observed.parent != null && String(observed.parent) === String(desktop.pid);
  const createdAfterClick = pidBeforeClick == null
    && openedPid != null
    && observed.missing !== true
    && parentIsDesktop
    && !handlersBefore.has(String(openedPid));
  const suspendHeld = observed.missing !== true
    && observed.childCount === 0
    && observed.threadCount >= 1
    && observed.suspendedThreadCount === observed.threadCount
    && observed.threadState === '5:5'
    && observed.ntStatus === 0
    && observed.suspendCount >= 1
    && aliveBeforeKill
    && goneAfterKill;
  const dailyProfileNotStarted = addedBrowsers.length === 0;
  facts.details.handoff = {
    imageName: observed.missing ? null : observed.imageName,
    commandLine: commandLine || null,
    handler,
    urlMatched,
    createdAfterClick,
    parentIsDesktop,
    childCount: observed.childCount ?? null,
    threadCount: observed.threadCount ?? null,
    suspendedThreadCount: observed.suspendedThreadCount ?? null,
    threadState: observed.threadState || null,
    suspendCount: observed.suspendCount ?? null,
    aliveBeforeKill,
    goneAfterKill,
    terminatedBeforeUrlDll: suspendHeld,
    bookmarks: {
      present: chromeBefore.present,
      bytesUnchanged: bookmarkCompare.bytesUnchanged,
      sha256Unchanged: bookmarkCompare.sha256Unchanged,
      files: chromeBefore.files,
    },
    browserCounts: {
      before: previousBrowsers.size,
      after: browsersAfter.split(',').filter(Boolean).length,
      added: addedBrowsers.length,
    },
    dailyProfileNotStarted,
    extensionStampUnchanged: extensionsBefore === extensionsAfter,
  };
  const openText = await panelText(session);
  facts.checks.chromeOpenAccepted = facts.checks.chromeClicked === true && !openText.includes('没有转到 Chrome。');
  facts.checks.handedToSystem = Boolean(
    facts.checks.chromeClicked === true
    && facts.details.handoff.imageName === 'rundll32.exe'
    && !String(facts.details.handoff.imageName).includes('\\')
    && !String(facts.details.handoff.imageName).includes('/')
    && commandLine.includes('url.dll,FileProtocolHandler')
    && commandLine.includes(failUrl)
    && facts.details.handoff.createdAfterClick
    && facts.details.handoff.terminatedBeforeUrlDll
    && facts.details.handoff.bookmarks.bytesUnchanged
    && facts.details.handoff.bookmarks.sha256Unchanged
    && facts.details.handoff.dailyProfileNotStarted,
  );
  facts.checks.chromeDataUnchanged = bookmarkCompare.bytesUnchanged && bookmarkCompare.sha256Unchanged;
  facts.checks.noNewBrowserPid = addedBrowsers.length === 0;
  facts.checks.dailyProfileNotStarted = dailyProfileNotStarted;
  facts.checks.scriptBookmark = (await clickRow(session, 'library-row-profile:pa09:12')) === 'CLICKED';
  const scriptText = await waitPanel(session, '仅打开 http 或 https 链接。', 8000);
  const scriptButtons = await buttonStates(session);
  facts.checks.scriptRejected = scriptText.includes('仅打开 http 或 https 链接。') && scriptButtons.find((item) => item.name === '打开应用内网页')?.disabled === true;
  const top = await readdir(appData).catch(() => []);
  facts.details.appDataEntries = top;
  facts.details.sessionDirs = { beforeClose: dirsBeforeClose, afterClose: dirsAfterClose, both: dirsBoth, afterClear: dirsAfterClear };
  facts.checks.sessionDirSeparate = top.includes('preview-sessions') && top.includes('markbridge.sqlite');
  const afterKeys = await markbridgeCredentialSummary();
  facts.details.cmdkeyAfter = afterKeys;
  facts.checks.noPairingCredential = !afterKeys.hasPairing && !beforeKeys.hasPairing && afterKeys.markbridgeLines === beforeKeys.markbridgeLines;
} catch (error) {
  facts.error = String(error && error.stack || error).slice(0, 900);
} finally {
  if (openerPid) await killPid(openerPid);
  await killStrayOpener();
  session?.close();
  await killTree(desktop);
  await killTree(vite);
  if (server) await new Promise((resolveClose) => server.close(() => resolveClose()));
  if (tempRoot && !String(tempRoot).toLowerCase().includes('com.markbridge.desktop')) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
  const failed = Object.entries(facts.checks).filter(([, value]) => value !== true).map(([name]) => name);
  facts.failed = failed;
  facts.passed = failed.length === 0 && !facts.error;
  await writeFile(join(evidence, 'native-report.json'), JSON.stringify(facts, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify({ passed: facts.passed, failed, error: facts.error || null })}\n`);
  process.exitCode = facts.passed ? 0 : 1;
}
