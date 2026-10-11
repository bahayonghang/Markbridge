// V07 managed-bookmark probe. Policy JSON file, then one isolated user-data directory.
// This script does not write HKCU, HKLM, or browser binaries.
import { spawn, execFile } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = import.meta.dirname;
const repo = resolve(evidence, '..', '..', '..', '..', '..', '..');
const harness = resolve(repo, 'target/debug/examples/edit_harness.exe');
const extension = resolve(repo, 'apps/extension/dist');
const chromiumExe = process.env.MARKBRIDGE_STOCK_CHROMIUM
  || join(process.env.TEMP || tmpdir(), 'markbridge-06-filepolicy', 'chrome-win', 'chrome.exe');
const expectedDailyHash = 'DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82';
const expectedDailyLength = 849515;
const markerUrl = 'https://example.invalid/mb06/managed';
const runId = randomUUID();
const namespace = `Markbridge.Task06.${randomBytes(3).toString('hex')}`;
const reportPath = join(evidence, 'v07-policy-file-report.json');
const managedList = [
  { toplevel_name: 'MB06' },
  { name: 'MB06', url: markerUrl },
];
const policyDocument = { ManagedBookmarks: managedList };
const processes = [];
const report = {
  runId,
  startedAt: new Date().toISOString(),
  command: 'node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/v07-policy-file.mjs',
  scope: 'stock Chromium policy JSON file, then one isolated user-data directory',
  credentialNamespace: namespace,
  registryWriteApiCalled: false,
  policyFile: null,
  userData: null,
  cause: null,
  controls: [],
};
let backend;

function record(control, status, details = {}) {
  report.controls.push({ control, status, ...details });
  process.stdout.write(`${JSON.stringify({ control, status, ...details })}\n`);
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
  throw new Error(code);
}
function fnv(text) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
function run(command, args, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: stdout ?? '', stderr: stderr ?? '' }));
      else resolveRun(stdout ?? '');
    });
  });
}
function exitCodeOf(error) {
  return Number(error?.code ?? error?.status);
}
function assertPath(directory) {
  const normalized = directory.replaceAll('\\', '/').toLowerCase();
  ensure(!normalized.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  ensure(!normalized.includes('com.markbridge.desktop'), 'APP_DATA_PATH');
  ensure(!normalized.split('/').includes('markbridge-06-chromium'), 'PATCHED_CHROMIUM_REFUSED');
  ensure(!normalized.startsWith('c:/program files/google/chrome'), 'OFFICIAL_CHROME_PATH');
}
async function sha256(file) {
  if (!existsSync(file)) return null;
  const hash = createHash('sha256');
  await new Promise((resolveHash, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolveHash);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}
async function hostSnapshot() {
  const script = await mkdtemp(join(tmpdir(), 'markbridge-06-snap-'));
  const file = join(script, 'snap.ps1');
  await writeFile(file, `$ErrorActionPreference = 'Stop'
$paths = @(
  @('HKCU','Software'),
  @('HKCU','Software\\MBPolicy'),
  @('HKCU','Software\\MBPolicy\\Chromium'),
  @('HKCU','Software\\Policies'),
  @('HKCU','Software\\Policies\\Chromium'),
  @('HKCU','Software\\Policies\\Google'),
  @('HKCU','Software\\Policies\\Google\\Chrome'),
  @('HKCU','Software\\Google'),
  @('HKCU','Software\\Google\\Chrome'),
  @('HKCU','Software\\Chromium'),
  @('HKLM','SOFTWARE\\MBPolicy'),
  @('HKLM','SOFTWARE\\Policies'),
  @('HKLM','SOFTWARE\\Policies\\Chromium'),
  @('HKLM','SOFTWARE\\Policies\\Google'),
  @('HKLM','SOFTWARE\\Policies\\Google\\Chrome'),
  @('HKLM','SOFTWARE\\Google'),
  @('HKLM','SOFTWARE\\Google\\Chrome'),
  @('HKLM','SOFTWARE\\Chromium')
)
function Encode-Value($value) {
  if ($null -eq $value) { return '' }
  if ($value -is [byte[]]) { return [Convert]::ToBase64String($value) }
  if ($value -is [Array]) { return (($value | ForEach-Object { [string]$_ }) -join [char]31) }
  return [string]$value
}
$rows = foreach ($item in $paths) {
  $hiveName = $item[0]
  $path = $item[1]
  $denied = $false
  $hive = if ($hiveName -eq 'HKCU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
  try { $key = $hive.OpenSubKey($path, $false) } catch { $key = $null; $denied = $true }
  if ($null -eq $key) {
    [ordered]@{ hive = $hiveName; path = $path; present = $false; hash = ''; names = 0; subs = 0; managedBookmarks = $false; denied = [bool]$denied }
    continue
  }
  $names = @($key.GetValueNames())
  $subs = @($key.GetSubKeyNames())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $ms = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($ms)
  foreach ($name in ($names | Sort-Object)) {
    $kind = [int]$key.GetValueKind($name)
    $raw = Encode-Value ($key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames))
    $writer.Write([string]$name)
    $writer.Write($kind)
    $writer.Write([string]$raw)
  }
  foreach ($sub in ($subs | Sort-Object)) { $writer.Write([string]$sub) }
  $writer.Flush()
  $hash = [Convert]::ToHexString($sha.ComputeHash($ms.ToArray()))
  $key.Close()
  [ordered]@{ hive = $hiveName; path = $path; present = $true; hash = $hash; names = $names.Count; subs = $subs.Count; managedBookmarks = [bool]($names -contains 'ManagedBookmarks'); denied = $false }
}
$daily = Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Bookmarks'
$dailyItem = Get-Item -LiteralPath $daily
$dailyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $daily).Hash
$official = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
$officialHash = ''
if (Test-Path -LiteralPath $official) { $officialHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $official).Hash }
[pscustomobject]@{ keys = @($rows); dailyLength = [int64]$dailyItem.Length; dailyHash = $dailyHash; officialChromeHash = $officialHash } | ConvertTo-Json -Compress -Depth 5
`, 'utf8');
  const stdout = await run('pwsh', ['-NoProfile', '-File', file]);
  return JSON.parse(stdout);
}
function keyView(snapshot) {
  return (snapshot?.keys ?? []).map((item) => (item.id ? item : {
    id: `${item.hive}\\${item.path}`,
    present: item.present === true,
    hash: item.hash ?? '',
    names: item.names ?? 0,
    subs: item.subs ?? 0,
    managedBookmarks: item.managedBookmarks === true,
    denied: item.denied === true,
  })).sort((left, right) => left.id.localeCompare(right.id));
}
function changedKeys(left, right) {
  const before = new Map(keyView(left).map((item) => [item.id, JSON.stringify(item)]));
  return keyView(right).filter((item) => before.get(item.id) !== JSON.stringify(item)).map((item) => item.id);
}
async function assertNoBrowser() {
  try {
    const stdout = await run('pwsh', ['-NoProfile', '-Command', "$found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('chrome','msedge','chromium') }); if ($found.Count -gt 0) { exit 3 }; 'CLEAR'"]);
    ensure(stdout.includes('CLEAR'), 'BROWSER_ALREADY_RUNNING');
  } catch (error) {
    if (error?.message === 'BROWSER_ALREADY_RUNNING') throw error;
    if (exitCodeOf(error) === 3) throw new Error('BROWSER_ALREADY_RUNNING');
    throw new Error('BROWSER_CHECK_FAILED');
  }
}
async function assertChromium(exePath) {
  assertPath(exePath);
  const stdout = await run('pwsh', ['-NoProfile', '-Command', "$item = Get-Item -LiteralPath $env:MB06_CHROMIUM_EXE; $info = $item.VersionInfo; Write-Output ('product=' + $info.ProductName); Write-Output ('version=' + $info.ProductVersion); Write-Output ('length=' + $item.Length)"], { MB06_CHROMIUM_EXE: exePath });
  const product = /product=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  const version = /version=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  ensure(/chromium/i.test(product) && !/google chrome/i.test(product), 'NOT_CHROMIUM');
  ensure(version.length > 0, 'CHROMIUM_MISSING');
  return { product, version };
}
async function credentialCounts() {
  const stdout = await new Promise((resolveHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (_error, text) => resolveHits(text ?? ''));
  });
  const lines = stdout.split(/\r?\n/);
  return {
    pairing: lines.filter((line) => line.includes('Markbridge.Pairing')).length,
    task06: lines.filter((line) => line.includes(namespace)).length,
  };
}
async function deleteNamespaceTargets() {
  const stdout = await new Promise((resolveHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (_error, text) => resolveHits(text ?? ''));
  });
  const targets = stdout.split(/\r?\n/).map((line) => line.match(/Target:\s*(.+)/)?.[1]?.trim()).filter((target) => target && target.includes(namespace) && !target.includes('Markbridge.Pairing'));
  for (const target of targets) {
    await new Promise((resolveDelete) => {
      execFile('cmdkey', [`/delete:${target}`], { windowsHide: true }, () => resolveDelete());
    });
  }
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}
function startBackend(dataDirectory) {
  assertPath(dataDirectory);
  const child = spawn(harness, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: dataDirectory, MARKBRIDGE_CREDENTIAL_NAMESPACE: namespace },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processes.push(child);
  let next = 0;
  const pending = new Map();
  const failPending = (code) => {
    for (const request of pending.values()) request.reject(new Error(code));
    pending.clear();
  };
  child.on('error', () => failPending('BACKEND_SPAWN'));
  child.stderr?.on('data', () => {});
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { failPending('BACKEND_BAD_LINE'); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.errorCode) request.reject(new Error(`BACKEND_${message.errorCode}`));
    else request.resolve(message.result);
  });
  child.on('exit', () => failPending('BACKEND_EXIT'));
  return { child, call(command, args = {}) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    });
  } };
}
function launchChrome(directory) {
  assertPath(directory);
  assertPath(chromiumExe);
  const args = [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ];
  const child = spawn(chromiumExe, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  processes.push(child);
  let next = 0;
  let buffer = '';
  const pending = new Map();
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
      if (!message.id) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error('CHROME_CDP_FAILED'));
      else request.resolve(message.result);
    }
  });
  child.on('exit', () => failPending('CHROME_EXIT'));
  return { child, args, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  } };
}
async function closeChrome(chrome) {
  try { await chrome.call('Browser.close'); } catch { /* process exit is the record */ }
  const code = await new Promise((resolveExit) => {
    if (chrome.child.exitCode != null) { resolveExit(chrome.child.exitCode); return; }
    const timer = setTimeout(() => {
      const killer = spawn('taskkill', ['/PID', String(chrome.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('exit', () => resolveExit(chrome.child.exitCode ?? 1));
    }, 5000);
    chrome.child.once('exit', (exitCode) => { clearTimeout(timer); resolveExit(exitCode ?? 0); });
  });
  return code ?? 0;
}
async function kill(child) {
  if (!child?.pid || child.exitCode != null) return;
  await new Promise((resolveKill) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('exit', () => resolveKill());
    child.on('exit', () => resolveKill());
  });
}
async function openOptions(client) {
  const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
  const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
  await client.call('Runtime.enable', {}, sessionId);
  const page = { sessionId, async evaluate(expression) {
    const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    ensure(!response.exceptionDetails, 'CHROME_EVALUATION_FAILED');
    return response.result.value;
  } };
  await until(() => page.evaluate('!!document.querySelector("#pairing-code")'), 'OPTIONS_NOT_READY');
  return page;
}
const projectExpression = `(async () => {
  const tree = await chrome.bookmarks.getTree();
  const rows = [];
  const walk = (nodes, parentId) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      rows.push([node.id, node.parentId ?? parentId ?? '', node.index ?? index, node.title ?? '', node.url ?? '', node.folderType ?? '', node.unmodifiable ?? '']);
      if (node.children) walk(node.children, node.id);
    }
  };
  walk(tree, '');
  rows.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
  return JSON.stringify(rows);
})()`;
async function chromeDigest(page) {
  const text = await page.evaluate(projectExpression);
  const rows = JSON.parse(text);
  return { count: rows.length, hash: fnv(text) };
}
async function managedSnapshot(page) {
  return page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const managed = (root.children ?? []).find((node) => node.folderType === 'managed' || node.unmodifiable === 'managed');
    if (!managed) return { present: false, marker: false, id: null, childId: null };
    const target = ${JSON.stringify(markerUrl)};
    const stack = [...(managed.children ?? [])];
    let childId = null;
    while (stack.length) {
      const node = stack.shift();
      if (node.url === target) return { present: true, marker: true, id: managed.id, childId: node.id };
      if (childId == null && node.id) childId = node.id;
      for (const child of node.children ?? []) stack.push(child);
    }
    return { present: true, marker: false, id: managed.id, childId };
  })()`);
}
async function waitForManaged(page) {
  const end = Date.now() + 15000;
  let last = { present: false, marker: false, id: null, childId: null };
  while (Date.now() < end) {
    last = await managedSnapshot(page);
    if (last?.marker) return last;
    await delay(200);
  }
  return last;
}
async function roots(page) {
  const value = await page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const bar = root.children.find((node) => node.folderType === 'bookmarks-bar');
    const other = root.children.find((node) => node.folderType === 'other');
    const managed = root.children.find((node) => node.folderType === 'managed' || node.unmodifiable === 'managed');
    return { root: root.id, bar: bar?.id ?? null, other: other?.id ?? null, managed: managed?.id ?? null };
  })()`);
  ensure(value?.root && value.bar && value.other, 'CHROME_ROOTS_MISSING');
  return value;
}
async function policyPageSeesMarker(client) {
  try {
    const { targetId } = await client.call('Target.createTarget', { url: 'chrome://policy' });
    const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
    await client.call('Runtime.enable', {}, sessionId);
    await delay(500);
    const value = await client.call('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText.includes("ManagedBookmarks") : false',
      returnByValue: true,
    }, sessionId);
    return value.exceptionDetails ? false : value.result?.value === true;
  } catch {
    return false;
  }
}
async function expectMatch(page, profileId) {
  const actual = await chromeDigest(page);
  const cached = await until(async () => {
    const digest = await backend.call('digest', { profileId });
    return digest.hash === actual.hash && digest.count === actual.count ? digest : null;
  }, 'TREE_MISMATCH', 15000);
  return { count: cached.count, hash: cached.hash };
}
async function revisionOf(profileId) {
  const state = await backend.call('state');
  const profile = state.profiles.find((item) => item.profileId === profileId);
  ensure(profile, 'PROFILE_MISSING');
  return profile.revision;
}
async function apply(profileId, action) {
  const expectedRevision = await revisionOf(profileId);
  return backend.call('apply_edit', { profileId, expectedRevision, action, secondConfirm: false });
}
async function observe(userDataDir) {
  const chrome = launchChrome(userDataDir);
  let exitCode = null;
  try {
    chrome.version = (await chrome.call('Browser.getVersion')).product;
    const loaded = await chrome.call('Extensions.loadUnpacked', { path: extension });
    chrome.extensionId = loaded.id;
    const page = await openOptions(chrome);
    const managed = await waitForManaged(page);
    const policyListed = await policyPageSeesMarker(chrome);
    return { chrome, page, managed, policyListed, version: chrome.version, args: chrome.args };
  } catch (error) {
    exitCode = await closeChrome(chrome);
    error.chromiumExitCode = exitCode;
    throw error;
  }
}
async function rejectPairingNamespace(dataDirectory) {
  const before = await credentialCounts();
  const child = spawn(harness, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: dataDirectory, MARKBRIDGE_CREDENTIAL_NAMESPACE: 'Markbridge.Pairing' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const code = await new Promise((resolveExit) => {
    child.once('error', () => resolveExit('SPAWN'));
    child.once('exit', (exitCode) => resolveExit(exitCode ?? 1));
  });
  const after = await credentialCounts();
  ensure(code !== 'SPAWN', 'HARNESS_MISSING');
  ensure(code !== 0, 'PAIRING_NAMESPACE_ACCEPTED');
  ensure(after.pairing === before.pairing, 'PAIRING_NAMESPACE_WROTE');
  record('pairing_namespace_rejected', 'PASS', { exitCode: code, pairingTargetsUnchanged: true });
}
async function proveProtected(chrome, page, managed) {
  const port = await freePort();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-06-app-'));
  assertPath(dataDirectory);
  report.dataDirectory = 'temp';
  backend = startBackend(dataDirectory);
  await backend.call('start_bridge', { port });
  const offer = await backend.call('begin_pairing', { displayName: 'D06' });
  await until(() => page.evaluate('document.querySelector("#pair")?.disabled === false'), 'PAIR_BUTTON');
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(offer.pairingCode)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find((item) => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${chrome.extensionId}`, 'PAIR_ORIGIN');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  const profileId = offer.profileId;
  await until(async () => (await backend.call('state')).profiles.find((item) => item.profileId === profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE', 30000);
  const ids = await roots(page);
  ensure(ids.managed === managed.id, 'MANAGED_ID_CHANGED');
  const before = await expectMatch(page, profileId);
  const actions = [
    ['protected_managed_delete', { kind: 'delete', chromeId: managed.id }],
    ['protected_managed_move', { kind: 'move', chromeId: managed.id, parentId: ids.bar, position: 0 }],
    ['protected_descendant_delete', { kind: 'delete', chromeId: managed.childId }],
    ['protected_descendant_move', { kind: 'move', chromeId: managed.childId, parentId: ids.bar, position: 0 }],
  ];
  let rejected = true;
  for (const [control, action] of actions) {
    let code = 'NONE';
    try { await apply(profileId, action); } catch (error) { code = safeMessage(error); }
    const pass = code === 'BACKEND_PROTECTED_NODE';
    record(control, pass ? 'PASS' : 'FAIL', { code });
    rejected &&= pass;
  }
  const chromeAfter = await chromeDigest(page);
  let backendAfter = null;
  try { backendAfter = await backend.call('digest', { profileId }); } catch { backendAfter = null; }
  const digestUnchanged = chromeAfter.hash === before.hash && chromeAfter.count === before.count && backendAfter?.hash === before.hash && backendAfter?.count === before.count;
  record('tree_digest', digestUnchanged ? 'PASS' : 'FAIL', { count: before.count, hash: before.hash, unchanged: digestUnchanged });
  const still = await managedSnapshot(page);
  const descendantPresent = still?.marker === true && still.childId === managed.childId && still.id === managed.id;
  record('descendant_present', descendantPresent ? 'PASS' : 'FAIL', { present: descendantPresent });
  return rejected && digestUnchanged && descendantPresent;
}

async function main() {
  await assertNoBrowser();
  const browser = await assertChromium(chromiumExe);
  report.browserProduct = browser.product;
  report.chromeVersion = browser.version;
  report.chromiumExe = chromiumExe;
  ensure(existsSync(harness), 'HARNESS_MISSING');
  ensure(existsSync(join(extension, 'manifest.json')), 'EXTENSION_DIST_MISSING');
  const exeHash = await sha256(chromiumExe);
  const dllHash = await sha256(join(dirname(chromiumExe), 'chrome.dll'));
  report.binaryHashBefore = { exe: exeHash, dll: dllHash };
  const beforeHost = await hostSnapshot();
  report.hostBefore = { keys: keyView(beforeHost), dailyHash: beforeHost.dailyHash, dailyLength: beforeHost.dailyLength, officialChromeHash: beforeHost.officialChromeHash };
  ensure(beforeHost.dailyHash === expectedDailyHash && beforeHost.dailyLength === expectedDailyLength, 'DAILY_HASH_MISMATCH');
  ensure(!beforeHost.keys.some((item) => item.managedBookmarks), 'MANAGED_BOOKMARKS_VALUE_PRESENT');
  const pairingBefore = await credentialCounts();
  report.pairingTargetsBefore = pairingBefore.pairing;
  await rejectPairingNamespace(await mkdtemp(join(tmpdir(), 'markbridge-06-reject-')));
  const policyDir = await mkdtemp(join(tmpdir(), 'markbridge-06-policy-file-'));
  const policyFile = join(policyDir, 'mb06.json');
  await writeFile(policyFile, `${JSON.stringify(policyDocument)}\n`, 'utf8');
  const policyHash = await sha256(policyFile);
  const installedPolicy = join(dirname(chromiumExe), 'policies', 'managed', 'mb06.json');
  await mkdir(dirname(installedPolicy), { recursive: true });
  await writeFile(installedPolicy, await readFile(policyFile));
  const phaseOneDir = await mkdtemp(join(tmpdir(), 'markbridge-06-chrome-'));
  assertPath(phaseOneDir);
  const phaseOne = { path: installedPolicy, sha256: policyHash, bytes: (await readFile(policyFile)).length, userDataDir: phaseOneDir };
  let seen = null;
  try {
    seen = await observe(phaseOneDir);
    phaseOne.managedPresent = Boolean(seen.managed?.present);
    phaseOne.markerPresent = Boolean(seen.managed?.marker);
    phaseOne.policyPageListsManagedBookmarks = seen.policyListed;
    phaseOne.chrome = seen.version;
    phaseOne.chromiumArgs = seen.args;
    if (!seen.managed?.marker) {
      phaseOne.observation = 'Stock Windows Chromium did not show the managed bookmark from the policy JSON file.';
      phaseOne.chromiumExitCode = await closeChrome(seen.chrome);
      seen = null;
    }
  } catch (error) {
    phaseOne.observation = 'Policy file probe could not read the bookmark tree.';
    phaseOne.error = safeMessage(error);
    phaseOne.chromiumExitCode = error.chromiumExitCode ?? null;
    report.policyFile = phaseOne;
    throw error;
  }
  report.policyFile = phaseOne;
  if (seen?.managed?.marker) {
    report.cause = 'policy-file';
    const passed = await proveProtected(seen.chrome, seen.page, seen.managed);
    phaseOne.chromiumExitCode = await closeChrome(seen.chrome);
    report.status = passed ? 'PASS' : 'FAIL';
    return;
  }
  await rename(installedPolicy, join(policyDir, 'mb06-not-loaded.json'));
  record('policy_file_not_loaded', 'OBSERVED', { chromiumExitCode: phaseOne.chromiumExitCode, managedPresent: false });
  const userDataDir = await mkdtemp(join(tmpdir(), 'markbridge-06-userdata-'));
  assertPath(userDataDir);
  const localPolicy = JSON.stringify([{ level: 1, scope: 0, source: 2, name: 'ManagedBookmarks', value: managedList }]);
  await writeFile(join(userDataDir, 'Local State'), `${JSON.stringify({ local_test_policies_for_next_startup: localPolicy })}\n`, 'utf8');
  const phaseTwo = { directory: userDataDir, attempted: true, mechanism: 'local_test_policies_for_next_startup' };
  let second = null;
  try {
    second = await observe(userDataDir);
    phaseTwo.managedPresent = Boolean(second.managed?.present);
    phaseTwo.markerPresent = Boolean(second.managed?.marker);
    phaseTwo.policyPageListsManagedBookmarks = second.policyListed;
    phaseTwo.chrome = second.version;
    phaseTwo.chromiumArgs = second.args;
  } catch (error) {
    phaseTwo.observation = 'Isolated user-data directory did not yield a readable bookmark tree.';
    phaseTwo.error = safeMessage(error);
    phaseTwo.chromiumExitCode = error.chromiumExitCode ?? null;
    phaseTwo.managedPresent = false;
    report.userData = phaseTwo;
    report.status = 'FAIL';
    return;
  }
  report.userData = phaseTwo;
  if (!second.managed?.marker) {
    phaseTwo.observation = 'Isolated user-data directory did not show a managed bookmark node.';
    phaseTwo.chromiumExitCode = await closeChrome(second.chrome);
    report.status = 'FAIL';
    return;
  }
  report.cause = 'user-data';
  const passed = await proveProtected(second.chrome, second.page, second.managed);
  phaseTwo.chromiumExitCode = await closeChrome(second.chrome);
  report.status = passed ? 'PASS' : 'FAIL';
}

try {
  await main();
} catch (error) {
  if (!(error instanceof Halt)) report.error = safeMessage(error);
  if (!report.status) report.status = 'FAIL';
} finally {
  if (backend) { try { await backend.call('shutdown'); } catch { /* process kill follows */ } }
  for (const child of processes) await kill(child);
  try { await deleteNamespaceTargets(); } catch { /* credential cleanup is recorded by the counts */ }
  try {
    const counts = await credentialCounts();
    report.credentialTargets = counts;
  } catch { report.credentialTargets = null; }
  try {
    report.binaryHashAfter = {
      exe: await sha256(chromiumExe),
      dll: await sha256(join(dirname(chromiumExe), 'chrome.dll')),
    };
    const afterHost = await hostSnapshot();
    report.hostAfter = { keys: keyView(afterHost), dailyHash: afterHost.dailyHash, dailyLength: afterHost.dailyLength, officialChromeHash: afterHost.officialChromeHash };
    report.dailyBookmarksUnchanged = afterHost.dailyHash === expectedDailyHash && afterHost.dailyLength === expectedDailyLength;
    report.officialChromeUnchanged = afterHost.officialChromeHash === report.hostBefore?.officialChromeHash;
    report.registryChangedKeys = report.hostBefore ? changedKeys(report.hostBefore, afterHost) : ['SNAPSHOT_MISSING'];
  } catch (error) {
    report.cleanupError = safeMessage(error);
    report.dailyBookmarksUnchanged = false;
    report.registryChangedKeys = ['SNAPSHOT_FAILED'];
  }
  report.binariesUnchanged = report.binaryHashBefore?.exe === report.binaryHashAfter?.exe && report.binaryHashBefore?.dll === report.binaryHashAfter?.dll;
  report.noRegistryKeyWritten = report.registryWriteApiCalled === false && Array.isArray(report.registryChangedKeys) && report.registryChangedKeys.length === 0;
  const protectedPass = ['protected_managed_delete', 'protected_managed_move', 'protected_descendant_delete', 'protected_descendant_move', 'tree_digest', 'descendant_present']
    .every((name) => report.controls.find((item) => item.control === name)?.status === 'PASS');
  const pairingUnchanged = report.credentialTargets?.pairing === report.pairingTargetsBefore;
  if (report.status === 'PASS' && (!protectedPass || !report.noRegistryKeyWritten || !report.dailyBookmarksUnchanged || !report.binariesUnchanged || !report.officialChromeUnchanged || !pairingUnchanged || report.credentialTargets?.task06 !== 0)) {
    report.status = 'FAIL';
  }
  if (!report.status) report.status = 'FAIL';
  report.exitCode = report.status === 'PASS' ? 0 : 1;
  report.endedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.exit(report.exitCode);
}
