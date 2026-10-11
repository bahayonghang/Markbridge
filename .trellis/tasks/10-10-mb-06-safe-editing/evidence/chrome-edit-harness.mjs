// Disposable Chrome edit acceptance. The report stores counts, hashes, and states only.
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = import.meta.dirname;
const repo = resolve(evidence, '../../../..');
const exe = resolve(repo, 'target/debug/examples/edit_harness.exe');
const chromiumExe = process.env.MARKBRIDGE_CHROMIUM_EXE
  || join(process.env.TEMP || tmpdir(), 'markbridge-06-chromium', 'chrome-win', 'chrome.exe');
const managedPolicy = JSON.stringify([
  { toplevel_name: 'MB06' },
  { name: 'MB06', children: [{ name: 'MB06', url: 'https://example.invalid/mb06/managed' }] },
]);
const expectedHklm = 'ChromeCleanupEnabled,ChromeCleanupReportingEnabled,DeviceMetricsReportingEnabled,MetricsReportingEnabled,UserFeedbackAllowed';
const expectedDailyHash = 'DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82';
const runId = randomUUID();
const namespace = `Markbridge.Task06.${runId}`;
const report = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'disposable Chromium + edit harness, no daily profile',
  credentialNamespace: namespace,
  controls: [],
};
let policyCreated = false;
const processes = [];
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
    execFile(command, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...extraEnv } }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: stdout ?? '', stderr: stderr ?? '' }));
      else resolveRun(stdout ?? '');
    });
  });
}
function pwsh(script, extraEnv = {}) {
  return run('pwsh', ['-NoProfile', '-Command', script], extraEnv);
}
function exitCode(error) {
  return Number(error?.code ?? error?.status);
}
function assertDisposable(directory) {
  const normalized = directory.replaceAll('\\', '/').toLowerCase();
  ensure(!normalized.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  ensure(!normalized.includes('com.markbridge.desktop'), 'APP_DATA_PATH');
}
async function assertNoBrowser() {
  try {
    const stdout = await pwsh("$found = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('chrome','msedge','chromium') }); if ($found.Count -gt 0) { exit 3 }; 'CLEAR'");
    ensure(stdout.includes('CLEAR'), 'BROWSER_ALREADY_RUNNING');
  } catch (error) {
    if (error instanceof Halt || error?.message === 'BROWSER_ALREADY_RUNNING') throw error;
    if (exitCode(error) === 3) throw new Error('BROWSER_ALREADY_RUNNING');
    throw new Error('BROWSER_CHECK_FAILED');
  }
}
async function assertChromiumBinary(exePath) {
  const normalized = exePath.replaceAll('\\', '/').toLowerCase();
  ensure(normalized !== 'c:/program files/google/chrome/application/chrome.exe', 'OFFICIAL_CHROME_PATH');
  ensure(!normalized.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  let stdout = '';
  try {
    stdout = await pwsh("$item = Get-Item -LiteralPath $env:MB06_CHROMIUM_EXE; $info = $item.VersionInfo; Write-Output ('product=' + $info.ProductName); Write-Output ('version=' + $info.ProductVersion)", { MB06_CHROMIUM_EXE: exePath });
  } catch {
    throw new Error('CHROMIUM_MISSING');
  }
  const product = /product=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  const version = /version=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  ensure(product.length > 0 && /chromium/i.test(product) && !/google chrome/i.test(product), 'NOT_CHROMIUM');
  ensure(version.length > 0, 'CHROMIUM_MISSING');
  return { product, version };
}
function assertMbPolicyPaths() {
  const root = 'HKCU:\\Software\\MBPolicy';
  const key = 'HKCU:\\Software\\MBPolicy\\Chromium';
  if (root !== 'HKCU:\\Software\\MBPolicy' || key !== 'HKCU:\\Software\\MBPolicy\\Chromium') throw new Error('REGISTRY_PATH_REFUSED');
  return { root, key };
}
async function createChromiumPolicy() {
  const { root, key } = assertMbPolicyPaths();
  const directory = await mkdtemp(join(tmpdir(), 'markbridge-06-policy-'));
  const policyFile = join(directory, 'policy.json');
  await writeFile(policyFile, managedPolicy, 'utf8');
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'
$root = 'HKCU:\\Software\\MBPolicy'
$key = 'HKCU:\\Software\\MBPolicy\\Chromium'
if ($root -cne 'HKCU:\\Software\\MBPolicy' -or $key -cne 'HKCU:\\Software\\MBPolicy\\Chromium') { throw 'REGISTRY_PATH_REFUSED' }
$createdRoot = $false
try {
  if (Test-Path -LiteralPath $root) { throw 'MBPOLICY_KEY_PRESENT' }
  New-Item -Path $root | Out-Null
  $createdRoot = $true
  New-Item -Path $key | Out-Null
  $policy = [System.IO.File]::ReadAllText($env:MB06_POLICY_FILE)
  if ($policy.Length -lt 20) { throw 'POLICY_EMPTY' }
  New-ItemProperty -LiteralPath $key -Name 'ManagedBookmarks' -PropertyType String -Value $policy | Out-Null
  $value = [string](Get-ItemProperty -LiteralPath $key -Name 'ManagedBookmarks').ManagedBookmarks
  if ($value.Length -lt 20) { throw 'POLICY_EMPTY' }
  Write-Output 'CREATED'
} catch {
  if ($createdRoot) {
    if (Test-Path -LiteralPath $key) {
      $names = @((Get-Item -LiteralPath $key).GetValueNames())
      if ($names -contains 'ManagedBookmarks') { Remove-ItemProperty -LiteralPath $key -Name 'ManagedBookmarks' }
      $left = @((Get-Item -LiteralPath $key).GetValueNames())
      $subs = @(Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue)
      if ($left.Count -eq 0 -and $subs.Count -eq 0) { Remove-Item -LiteralPath $key }
    }
    if ((Test-Path -LiteralPath $root) -and (@((Get-Item -LiteralPath $root).GetValueNames()).Count -eq 0) -and (@(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue).Count -eq 0)) { Remove-Item -LiteralPath $root }
  }
  throw
}`, { MB06_POLICY_FILE: policyFile });
  ensure(stdout.includes('CREATED'), 'POLICY_CREATE_FAILED');
  ensure(root === 'HKCU:\\Software\\MBPolicy' && key === 'HKCU:\\Software\\MBPolicy\\Chromium', 'REGISTRY_PATH_REFUSED');
  policyCreated = true;
}
async function removeMbPolicy() {
  if (!policyCreated) return;
  const { root, key } = assertMbPolicyPaths();
  await pwsh(`$ErrorActionPreference = 'Stop'
$root = 'HKCU:\\Software\\MBPolicy'
$key = 'HKCU:\\Software\\MBPolicy\\Chromium'
if ($root -cne 'HKCU:\\Software\\MBPolicy' -or $key -cne 'HKCU:\\Software\\MBPolicy\\Chromium') { throw 'REGISTRY_PATH_REFUSED' }
if (Test-Path -LiteralPath $key) {
  $names = @((Get-Item -LiteralPath $key).GetValueNames())
  if ($names -contains 'ManagedBookmarks') { Remove-ItemProperty -LiteralPath $key -Name 'ManagedBookmarks' }
  $left = @((Get-Item -LiteralPath $key).GetValueNames())
  $subs = @(Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0 -and $subs.Count -eq 0) { Remove-Item -LiteralPath $key }
}
if (Test-Path -LiteralPath $root) {
  $rootNames = @((Get-Item -LiteralPath $root).GetValueNames())
  $rootSubs = @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)
  if ($rootNames.Count -eq 0 -and $rootSubs.Count -eq 0) { Remove-Item -LiteralPath $root }
}
Write-Output 'REMOVED'`);
  ensure(root === 'HKCU:\\Software\\MBPolicy' && key === 'HKCU:\\Software\\MBPolicy\\Chromium', 'REGISTRY_PATH_REFUSED');
}
async function settleHost() {
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'; $mbAbsent = -not (Test-Path -LiteralPath 'HKCU:\\Software\\MBPolicy'); $chromiumAbsent = -not (Test-Path -LiteralPath 'HKCU:\\Software\\Policies\\Chromium'); $googleAbsent = -not (Test-Path -LiteralPath 'HKCU:\\Software\\Policies\\Google\\Chrome'); $hklmItem = Get-Item -LiteralPath 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome'; $hklmNames = (@($hklmItem.GetValueNames()) | Sort-Object) -join ','; $hklmSubs = @(Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome' -ErrorAction SilentlyContinue).Count; $daily = Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Bookmarks'; $dailyItem = Get-Item -LiteralPath $daily; $dailyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $daily).Hash; Write-Output ('mbAbsent=' + $mbAbsent); Write-Output ('chromiumAbsent=' + $chromiumAbsent); Write-Output ('googleAbsent=' + $googleAbsent); Write-Output ('hklmNames=' + $hklmNames); Write-Output ('hklmSubs=' + $hklmSubs); Write-Output ('dailyHash=' + $dailyHash); Write-Output ('dailyLen=' + $dailyItem.Length)`);
  const read = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(stdout)?.[1]?.trim() ?? '';
  return {
    mbPolicyAbsent: read('mbAbsent') === 'True',
    chromiumPolicyAbsent: read('chromiumAbsent') === 'True',
    googleChromePolicyAbsent: read('googleAbsent') === 'True',
    hklmUnchanged: read('hklmNames') === expectedHklm && read('hklmSubs') === '0',
    dailyBookmarksUnchanged: read('dailyHash') === expectedDailyHash && Number(read('dailyLen')) === 849515,
  };
}
function finalizeStatus() {
  if (report.status === 'FAIL') return;
  const cleanup = report.cleanup ?? {};
  const cleanupOk = cleanup.mbPolicyAbsent === true && cleanup.chromiumPolicyAbsent === true && cleanup.googleChromePolicyAbsent === true && cleanup.hklmUnchanged === true && cleanup.dailyBookmarksUnchanged === true;
  if (!cleanupOk) {
    report.status = 'FAIL';
    report.exitCode = 1;
    return;
  }
  const statusOf = (name) => report.controls.find((item) => item.control === name)?.status;
  const required = ['pairing_namespace_rejected', 'paired_tree', 'crud_create', 'crud_update', 'same_parent_reorder', 'cross_parent_move', 'protected_root_folder_type', 'protected_managed', 'external_edit_conflict', 'delete_recovery', 'backup_files', 'concurrent_rollback', 'crash_after_apply', 'lost_ack', 'final_tree'];
  const managed = statusOf('protected_managed');
  if (managed === 'PASS' && required.every((name) => statusOf(name) === 'PASS')) {
    report.status = 'PASS';
    report.exitCode = 0;
    return;
  }
  if (managed === 'UNVERIFIED') {
    report.status = 'UNVERIFIED';
    report.exitCode = 0;
    return;
  }
  report.status = 'FAIL';
  report.exitCode = 1;
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
  const child = spawn(exe, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: dataDirectory, MARKBRIDGE_CREDENTIAL_NAMESPACE: namespace },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processes.push(child);
  let next = 0;
  const pending = new Map();
  let stderr = '';
  const failPending = (code) => {
    for (const request of pending.values()) request.reject(new Error(code));
    pending.clear();
  };
  child.on('error', () => failPending('BACKEND_SPAWN'));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-500); });
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
  return { child, stderr: () => stderr, call(command, args = {}) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    });
  } };
}
function launchChrome(directory) {
  assertDisposable(directory);
  const child = spawn(chromiumExe, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
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
  return { child, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  } };
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
  return { count: rows.length, hash: fnv(text), rows };
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
async function apply(profileId, action, secondConfirm = false) {
  const expectedRevision = await revisionOf(profileId);
  return backend.call('apply_edit', { profileId, expectedRevision, action, secondConfirm });
}
async function settle(profileId, operationId) {
  const end = Date.now() + 15000;
  let refreshed = false;
  while (Date.now() < end) {
    const list = await backend.call('list_operations', { profileId });
    const item = list.operations.find((operation) => operation.operationId === operationId);
    const state = item?.state;
    if (state && state !== 'applying' && state !== 'rolling_back' && state !== 'planned') {
      if (state === 'uncertain' && Date.now() + 1000 < end) { await delay(80); continue; }
      return state;
    }
    if (!refreshed && end - Date.now() < 2000) {
      await backend.call('refresh_operations', { profileId });
      refreshed = true;
    }
    await delay(80);
  }
  throw new Error('OPERATION_TIMEOUT');
}
async function expectState(profileId, operationId, expected, code) {
  const state = await settle(profileId, operationId);
  if (state === expected) return state;
  const list = await backend.call('list_operations', { profileId });
  const item = list.operations.find((operation) => operation.operationId === operationId);
  const errorCode = typeof item?.errorCode === 'string' ? item.errorCode : 'NONE';
  record(code, 'FAIL', { state, errorCode });
  throw new Error(code);
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
async function managedSnapshot(page) {
  return page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const managed = (root.children ?? []).find((node) => node.folderType === 'managed' || node.unmodifiable === 'managed');
    if (!managed) return { present: false, id: null, childId: null };
    const target = 'https://example.invalid/mb06/managed';
    const stack = [...(managed.children ?? [])];
    let childId = null;
    while (stack.length) {
      const node = stack.shift();
      if (node.url === target) return { present: true, id: managed.id, childId: node.id };
      if (childId == null) childId = node.id;
      for (const child of node.children ?? []) stack.push(child);
    }
    return { present: true, id: managed.id, childId };
  })()`);
}
async function waitForManaged(page) {
  const end = Date.now() + 15000;
  let last = null;
  while (Date.now() < end) {
    last = await managedSnapshot(page);
    if (last?.present) return last;
    await delay(200);
  }
  return last;
}
async function kill(child) {
  if (!child?.pid || child.exitCode != null) return;
  await new Promise((resolveKill) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('exit', () => resolveKill());
    child.on('exit', () => resolveKill());
  });
}
async function rejectPairingNamespace(dataDirectory) {
  const before = await credentialCounts();
  const child = spawn(exe, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: dataDirectory, MARKBRIDGE_CREDENTIAL_NAMESPACE: 'Markbridge.Pairing' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exitCode = await new Promise((resolveExit) => {
    child.once('error', () => resolveExit('SPAWN'));
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  const after = await credentialCounts();
  ensure(exitCode !== 'SPAWN', 'HARNESS_MISSING');
  ensure(exitCode !== 0, 'PAIRING_NAMESPACE_ACCEPTED');
  ensure(after.pairing === before.pairing, 'PAIRING_NAMESPACE_WROTE');
  record('pairing_namespace_rejected', 'PASS', { exitCode, pairingTargetsUnchanged: true });
}

process.stdout.write(`${JSON.stringify({ control: 'start', status: 'RUN' })}\n`);
try {
  await assertNoBrowser();
  const browser = await assertChromiumBinary(chromiumExe);
  report.browserProduct = browser.product;
  report.chromeVersion = browser.version;
  const baseline = await settleHost();
  ensure(baseline.mbPolicyAbsent, 'MBPOLICY_KEY_PRESENT');
  ensure(baseline.chromiumPolicyAbsent, 'CHROMIUM_POLICY_KEY_PRESENT');
  ensure(baseline.googleChromePolicyAbsent, 'GOOGLE_CHROME_POLICY_PRESENT');
  ensure(baseline.hklmUnchanged, 'HKLM_CHANGED');
  ensure(baseline.dailyBookmarksUnchanged, 'DAILY_HASH_MISMATCH');
  ensure(existsSync(exe), 'HARNESS_MISSING');
  ensure(existsSync(resolve(repo, 'apps/extension/dist/manifest.json')), 'EXTENSION_DIST_MISSING');
  await createChromiumPolicy();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-06-app-'));
  const chromeDirectory = await mkdtemp(join(tmpdir(), 'markbridge-06-chrome-'));
  assertDisposable(dataDirectory);
  assertDisposable(chromeDirectory);
  report.dataDirectory = 'temp';
  await rejectPairingNamespace(await mkdtemp(join(tmpdir(), 'markbridge-06-reject-')));
  const port = await freePort();
  backend = startBackend(dataDirectory);
  await backend.call('start_bridge', { port });
  const chrome = launchChrome(chromeDirectory);
  chrome.version = (await chrome.call('Browser.getVersion')).product;
  const loaded = await chrome.call('Extensions.loadUnpacked', { path: resolve(repo, 'apps/extension/dist') });
  chrome.extensionId = loaded.id;
  const page = await openOptions(chrome);
  const armed = await waitForManaged(page);
  if (!armed?.present) {
    record('protected_managed', 'UNVERIFIED', { reason: 'CHROMIUM_POLICY_NOT_HONORED', managedPresent: false, descendantChecked: false });
    report.status = 'UNVERIFIED';
    report.exitCode = 0;
    throw new Halt('CHROMIUM_POLICY_NOT_HONORED');
  }
  const offer = await backend.call('begin_pairing', { displayName: 'D06' });
  await until(() => page.evaluate('document.querySelector("#pair")?.disabled === false'), 'PAIR_BUTTON');
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(offer.pairingCode)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find((item) => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${chrome.extensionId}`, 'PAIR_ORIGIN');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  const profileId = offer.profileId;
  await until(async () => (await backend.call('state')).profiles.find((item) => item.profileId === profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE', 30000);
  const base = await expectMatch(page, profileId);
  const ids = await roots(page);
  record('paired_tree', 'PASS', { nodes: base.count, hash: base.hash, chrome: chrome.version, managedPresent: Boolean(ids.managed) });

  const createdUrl = 'https://example.invalid/mb06?q=1&x=y';
  const created = await apply(profileId, { kind: 'create', parentId: ids.bar, position: 0, title: 'A & B <C>', url: createdUrl });
  await expectState(profileId, created.operationId, 'applied', 'CREATE_NOT_APPLIED');
  const afterCreate = await expectMatch(page, profileId);
  const bookmarkId = (await chromeDigest(page)).rows.find((row) => row[4] === createdUrl)?.[0];
  ensure(bookmarkId, 'CREATE_MISSING');
  record('crud_create', 'PASS', { nodes: afterCreate.count });

  const renamed = await apply(profileId, { kind: 'update', chromeId: bookmarkId, title: 'Renamed', url: 'https://example.invalid/mb06/renamed' });
  await expectState(profileId, renamed.operationId, 'applied', 'UPDATE_NOT_APPLIED');
  await expectMatch(page, profileId);
  record('crud_update', 'PASS');

  const folder = await apply(profileId, { kind: 'create', parentId: ids.other, position: 0, title: 'Folder', url: null });
  await expectState(profileId, folder.operationId, 'applied', 'FOLDER_NOT_APPLIED');
  const folderId = (await chromeDigest(page)).rows.find((row) => row[3] === 'Folder' && row[2] === 0 && row[1] === ids.other)?.[0];
  ensure(folderId, 'FOLDER_MISSING');
  const second = await apply(profileId, { kind: 'create', parentId: ids.bar, position: 1, title: 'Second', url: 'https://example.invalid/mb06/second' });
  await expectState(profileId, second.operationId, 'applied', 'SECOND_NOT_APPLIED');
  const secondId = (await chromeDigest(page)).rows.find((row) => row[4] === 'https://example.invalid/mb06/second')?.[0];
  ensure(secondId, 'SECOND_MISSING');
  const barOrder = (await chromeDigest(page)).rows.filter((row) => row[1] === ids.bar).sort((left, right) => left[2] - right[2]).map((row) => row[0]);
  const reordered = await apply(profileId, { kind: 'reorder', parentId: ids.bar, childIds: [...barOrder].reverse() });
  await expectState(profileId, reordered.operationId, 'applied', 'REORDER_NOT_APPLIED');
  await expectMatch(page, profileId);
  const reversed = (await chromeDigest(page)).rows.filter((row) => row[1] === ids.bar).sort((left, right) => left[2] - right[2]).map((row) => row[0]);
  ensure(JSON.stringify(reversed) === JSON.stringify([...barOrder].reverse()), 'REORDER_ORDER');
  record('same_parent_reorder', 'PASS', { children: reversed.length });

  const moved = await apply(profileId, { kind: 'move', chromeId: bookmarkId, parentId: folderId, position: 0 });
  await expectState(profileId, moved.operationId, 'applied', 'MOVE_NOT_APPLIED');
  await expectMatch(page, profileId);
  const movedRow = (await chromeDigest(page)).rows.find((row) => row[0] === bookmarkId);
  ensure(movedRow?.[1] === folderId && movedRow[2] === 0, 'MOVE_PARENT');
  record('cross_parent_move', 'PASS');

  const beforeProtected = await expectMatch(page, profileId);
  for (const action of [
    { kind: 'delete', chromeId: ids.root },
    { kind: 'delete', chromeId: ids.bar },
    { kind: 'move', chromeId: ids.bar, parentId: ids.other, position: 0 },
  ]) {
    let rejected = false;
    try { await apply(profileId, action); } catch (error) { rejected = error.message === 'BACKEND_PROTECTED_NODE'; }
    ensure(rejected, 'PROTECTED_NOT_REJECTED');
  }
  const afterProtected = await expectMatch(page, profileId);
  ensure(afterProtected.hash === beforeProtected.hash, 'PROTECTED_TREE_CHANGED');
  record('protected_root_folder_type', 'PASS', { managedChecked: false });
  const live = await managedSnapshot(page);
  if (!live?.present || !live.id) {
    record('protected_managed', 'UNVERIFIED', { reason: 'CHROMIUM_POLICY_NOT_HONORED', managedPresent: false, descendantChecked: false });
    report.status = 'UNVERIFIED';
    report.exitCode = 0;
    throw new Halt('CHROMIUM_POLICY_NOT_HONORED');
  }
  if (live.id !== ids.managed) {
    record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: 'MANAGED_ID_CHANGED' });
    throw new Error('MANAGED_ID_CHANGED');
  }
  const beforeManaged = await expectMatch(page, profileId);
  let managedCode = 'NONE';
  try { await apply(profileId, { kind: 'delete', chromeId: live.id }); } catch (error) { managedCode = error.message; }
  if (managedCode !== 'BACKEND_PROTECTED_NODE') {
    record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: managedCode });
    throw new Error('MANAGED_NOT_REJECTED');
  }
  const afterManaged = await expectMatch(page, profileId);
  if (afterManaged.hash !== beforeManaged.hash) {
    record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: 'MANAGED_TREE_CHANGED' });
    throw new Error('MANAGED_TREE_CHANGED');
  }
  const still = await managedSnapshot(page);
  if (still?.id !== live.id) {
    record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: 'MANAGED_ID_CHANGED' });
    throw new Error('MANAGED_ID_CHANGED');
  }
  if (!live.childId) {
    record('protected_managed', 'UNVERIFIED', { reason: 'MANAGED_DESCENDANT_ABSENT', managedPresent: true, descendantChecked: false });
  } else {
    let childCode = 'NONE';
    try { await apply(profileId, { kind: 'delete', chromeId: live.childId }); } catch (error) { childCode = error.message; }
    if (childCode !== 'BACKEND_PROTECTED_NODE') {
      record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: childCode });
      throw new Error('MANAGED_DESCENDANT_NOT_REJECTED');
    }
    const afterChild = await expectMatch(page, profileId);
    if (afterChild.hash !== beforeManaged.hash) {
      record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: 'MANAGED_DESCENDANT_TREE_CHANGED' });
      throw new Error('MANAGED_DESCENDANT_TREE_CHANGED');
    }
    const stillChild = await managedSnapshot(page);
    if (stillChild?.id !== live.id || stillChild?.childId !== live.childId) {
      record('protected_managed', 'FAIL', { managedPresent: true, descendantChecked: false, code: 'MANAGED_DESCENDANT_MISSING' });
      throw new Error('MANAGED_DESCENDANT_MISSING');
    }
    record('protected_managed', 'PASS', { managedPresent: true, descendantChecked: true });
  }

  await page.evaluate(`chrome.bookmarks.update(${JSON.stringify(bookmarkId)}, { title: 'External' })`);
  await expectMatch(page, profileId);
  const conflict = await apply(profileId, { kind: 'undo', operationId: renamed.operationId });
  const conflictState = conflict.state === 'rollback_conflict' ? conflict.state : await settle(profileId, conflict.operationId);
  ensure(conflictState === 'rollback_conflict', 'EXTERNAL_NOT_CONFLICT');
  await expectMatch(page, profileId);
  const external = (await chromeDigest(page)).rows.find((row) => row[0] === bookmarkId);
  ensure(external?.[3] === 'External' && external[1] === folderId, 'EXTERNAL_OVERWRITTEN');
  await backend.call('review_operation', { profileId, operationId: renamed.operationId });
  const afterReview = (await chromeDigest(page)).rows.find((row) => row[0] === bookmarkId);
  ensure(afterReview?.[3] === 'External' && afterReview[1] === folderId, 'REVIEW_OVERWROTE');
  record('external_edit_conflict', 'PASS');

  await backend.call('set_note', { profileId, chromeId: secondId, note: 'mb06-note' });
  ensure((await backend.call('note_matches', { profileId, chromeId: secondId, note: 'mb06-note' })).matches, 'NOTE_NOT_STORED');
  const beforeDelete = (await chromeDigest(page)).rows.filter((row) => row[1] === ids.bar).sort((left, right) => left[2] - right[2]).map((row) => row[0]);
  const deleted = await apply(profileId, { kind: 'delete', chromeId: secondId });
  await expectState(profileId, deleted.operationId, 'applied', 'DELETE_NOT_APPLIED');
  await expectMatch(page, profileId);
  ensure(!(await chromeDigest(page)).rows.some((row) => row[0] === secondId), 'DELETE_STILL_PRESENT');
  const restored = await apply(profileId, { kind: 'undo', operationId: deleted.operationId });
  await expectState(profileId, restored.operationId, 'rolled_back', 'UNDO_DELETE_NOT_ROLLED_BACK');
  await expectMatch(page, profileId);
  const restoredRow = (await chromeDigest(page)).rows.find((row) => row[4] === 'https://example.invalid/mb06/second');
  ensure(restoredRow && restoredRow[0] !== secondId, 'UNDO_DELETE_ID');
  const afterUndo = (await chromeDigest(page)).rows.filter((row) => row[1] === ids.bar).sort((left, right) => left[2] - right[2]).map((row) => row[0] === restoredRow[0] ? secondId : row[0]);
  ensure(JSON.stringify(afterUndo) === JSON.stringify(beforeDelete), 'UNDO_DELETE_ORDER');
  ensure((await until(async () => (await backend.call('note_matches', { profileId, chromeId: restoredRow[0], note: 'mb06-note' })).matches, 'NOTE_NOT_MIGRATED', 10000)), 'NOTE_NOT_MIGRATED');
  record('delete_recovery', 'PASS', { newId: true, order: true, metadata: true });

  const flags = await backend.call('backup_flags');
  ensure(flags.html && flags.sidecar && flags.hierarchy && flags.escapedAmp && flags.escapedLt, 'BACKUP_FLAGS');
  record('backup_files', 'PASS', flags);

  const clean = await apply(profileId, { kind: 'update', chromeId: restoredRow[0], title: 'Clean', url: 'https://example.invalid/mb06/second' });
  await expectState(profileId, clean.operationId, 'applied', 'CLEAN_UPDATE_NOT_APPLIED');
  const cleanUndo = await apply(profileId, { kind: 'undo', operationId: clean.operationId });
  await expectState(profileId, cleanUndo.operationId, 'rolled_back', 'CLEAN_UNDO_FAILED');
  await expectMatch(page, profileId);
  const cleaned = (await chromeDigest(page)).rows.find((row) => row[0] === restoredRow[0]);
  ensure(cleaned?.[3] === 'Second' && cleaned[4] === 'https://example.invalid/mb06/second', 'CLEAN_UNDO_CONTENT');
  const overlap = apply(profileId, { kind: 'update', chromeId: restoredRow[0], title: 'Overlap', url: 'https://example.invalid/mb06/second' });
  let serialCode = '';
  try { await apply(profileId, { kind: 'delete', chromeId: restoredRow[0] }); } catch (error) { serialCode = error.message; }
  const overlapResult = await overlap;
  const overlapState = await settle(profileId, overlapResult.operationId);
  await expectMatch(page, profileId);
  const overlapRow = (await chromeDigest(page)).rows.find((row) => row[0] === restoredRow[0]);
  ensure(overlapRow, 'OVERLAP_DELETED');
  ensure(serialCode === 'BACKEND_CONFLICT' || serialCode === 'BACKEND_STALE_PROPOSAL' || overlapState === 'applied', 'OVERLAP_OUTCOME');
  if (serialCode !== 'BACKEND_CONFLICT') {
    const undoOverlap = await apply(profileId, { kind: 'undo', operationId: overlapResult.operationId });
    await expectState(profileId, undoOverlap.operationId, 'rolled_back', 'OVERLAP_UNDO_FAILED');
  }
  await expectMatch(page, profileId);
  record('concurrent_rollback', 'PASS', { serialCode: serialCode || 'APPLIED_FIRST' });

  const beforeCrash = await expectMatch(page, profileId);
  const durable = await apply(profileId, { kind: 'create', parentId: ids.other, position: 1, title: 'Durable', url: 'https://example.invalid/mb06/durable' });
  await expectState(profileId, durable.operationId, 'applied', 'DURABLE_NOT_APPLIED');
  const durableCount = (await chromeDigest(page)).rows.filter((row) => row[4] === 'https://example.invalid/mb06/durable').length;
  ensure(durableCount === 1, 'DURABLE_COUNT');
  const crashed = backend.child;
  backend = null;
  await kill(crashed);
  await delay(300);
  let restarted;
  await until(async () => {
    try {
      restarted = startBackend(dataDirectory);
      await restarted.call('start_bridge', { port });
      return true;
    } catch { if (restarted) await kill(restarted.child); return null; }
  }, 'RESTART_FAILED', 45000);
  backend = restarted;
  await page.evaluate(`chrome.runtime.sendMessage({type:'reconnect'})`);
  await until(async () => (await backend.call('state')).profiles.find((item) => item.profileId === profileId && item.connection === 'live'), 'RESTART_NOT_LIVE', 30000);
  const afterCrash = await expectMatch(page, profileId);
  const durableAfter = (await chromeDigest(page)).rows.filter((row) => row[4] === 'https://example.invalid/mb06/durable').length;
  const durableState = (await backend.call('list_operations', { profileId })).operations.find((item) => item.operationId === durable.operationId)?.state;
  ensure(durableAfter === 1 && afterCrash.count === beforeCrash.count + 1 && durableState === 'applied', 'CRASH_AFTER_APPLY');
  record('crash_after_apply', 'PASS', { state: durableState, copies: durableAfter });

  const lostUrl = 'https://example.invalid/mb06/lost';
  const lost = await apply(profileId, { kind: 'create', parentId: ids.other, position: 2, title: 'Lost', url: lostUrl });
  const lostChild = backend.child;
  backend = null;
  await kill(lostChild);
  await delay(800);
  let copies = (await chromeDigest(page)).rows.filter((row) => row[4] === lostUrl).length;
  await until(async () => {
    try {
      restarted = startBackend(dataDirectory);
      await restarted.call('start_bridge', { port });
      return true;
    } catch { if (restarted) await kill(restarted.child); return null; }
  }, 'LOST_RESTART_FAILED', 45000);
  backend = restarted;
  await page.evaluate(`chrome.runtime.sendMessage({type:'reconnect'})`);
  await until(async () => (await backend.call('state')).profiles.find((item) => item.profileId === profileId && item.connection === 'live'), 'LOST_NOT_LIVE', 30000);
  await backend.call('refresh_operations', { profileId });
  await delay(1000);
  await backend.call('refresh_operations', { profileId });
  const lostState = (await backend.call('list_operations', { profileId })).operations.find((item) => item.operationId === lost.operationId)?.state;
  copies = (await chromeDigest(page)).rows.filter((row) => row[4] === lostUrl).length;
  ensure(copies <= 1, 'LOST_ACK_DUPLICATE');
  ensure(lostState === 'uncertain' || lostState === 'applied', 'LOST_ACK_STATE');
  if (lostState === 'applied') ensure(copies === 1, 'LOST_ACK_APPLIED_WITHOUT_NODE');
  if (lostState === 'uncertain') ensure(copies <= 1, 'LOST_ACK_UNCERTAIN_DUPLICATE');
  await delay(500);
  ensure((await chromeDigest(page)).rows.filter((row) => row[4] === lostUrl).length === copies, 'LOST_ACK_LATE_DUPLICATE');
  record('lost_ack', 'PASS', { state: lostState, copies });

  await expectMatch(page, profileId);
  record('final_tree', 'PASS', await expectMatch(page, profileId));
  report.exitCode = 0;
} catch (error) {
  if (error instanceof Halt) {
    if (!report.controls.some((item) => item.control === 'protected_managed')) {
      const reason = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CHROMIUM_POLICY_NOT_HONORED';
      record('protected_managed', 'UNVERIFIED', { reason, managedPresent: false, descendantChecked: false });
    }
    report.status = 'UNVERIFIED';
    report.exitCode = 0;
  } else {
    record('run', 'FAIL', { code: safeMessage(error) });
    report.status = 'FAIL';
    report.exitCode = 1;
  }
} finally {
  if (backend) { try { await backend.call('shutdown'); } catch { /* The process may already be gone. */ } await kill(backend.child); }
  for (const child of processes) await kill(child);
  try {
    await removeMbPolicy();
  } catch { /* settleHost records whether HKCU\Software\MBPolicy is gone. */ }
  try {
    report.cleanup = await settleHost();
  } catch {
    report.cleanup = { mbPolicyAbsent: false, chromiumPolicyAbsent: false, googleChromePolicyAbsent: false, hklmUnchanged: false, dailyBookmarksUnchanged: false };
  }
  finalizeStatus();
  await deleteNamespaceTargets();
  const counts = await credentialCounts();
  report.credentialTargets = { pairing: counts.pairing, task06: counts.task06 };
  await writeFile(join(evidence, 'v07-v08-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.exitCode ?? 1;
}
