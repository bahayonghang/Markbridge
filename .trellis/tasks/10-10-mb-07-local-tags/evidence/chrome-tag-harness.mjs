// Disposable Chrome tag acceptance. The report stores counts, hashes, and states only.
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = import.meta.dirname;
const repo = resolve(evidence, '../../../..');
const exe = resolve(repo, 'target/debug/examples/tag_harness.exe');
const extensionDir = resolve(repo, 'apps/extension/dist');
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const runId = randomUUID();
const namespace = `Markbridge.Task07.${runId}`;
const pipeRaw = 'A | B \\ C';
const pipeTag = 'x | y \\ z';
const plainRaw = 'Plain';
const keepRaw = 'Keep';
const linkRaw = 'Link';
const noteText = 'local note';
const externalTitle = 'MB07 External';
const report = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'disposable Chrome user-data-dir + tag harness, no daily profile',
  credentialNamespace: namespace,
  controls: [],
};
process.on('unhandledRejection', () => {});
const processes = [];
let backend;
let chrome;
let dataDirectory;
let chromeDirectory;

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
function escapeTitle(value) {
  let out = '';
  for (const ch of value) out += ch === '\\' || ch === '|' ? `\\${ch}` : ch;
  return out;
}
function encodeTitle(raw, tags) {
  let out = escapeTitle(raw);
  for (const tag of tags) out += ` | ${escapeTitle(tag)}`;
  return out;
}
function titleParts(encoded) {
  const chars = [...encoded];
  const parts = [];
  let current = '';
  let index = 0;
  while (index < chars.length) {
    if (chars[index] === '\\') {
      index += 1;
      if (index >= chars.length) return null;
      current += chars[index];
      index += 1;
      continue;
    }
    if (chars[index] === ' ' && chars[index + 1] === '|' && chars[index + 2] === ' ') {
      parts.push(current);
      current = '';
      index += 3;
      continue;
    }
    current += chars[index];
    index += 1;
  }
  parts.push(current);
  return parts;
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
function exitCodeOf(error) { return Number(error?.code ?? error?.status); }
function assertDisposable(directory) {
  const normalized = directory.replaceAll('\\', '/').toLowerCase();
  ensure(normalized.includes('/temp/') || normalized.includes('/tmp/'), 'NOT_TEMP');
  ensure(!normalized.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  ensure(!normalized.includes('com.markbridge.desktop'), 'APP_DATA_PATH');
  ensure(!normalized.includes('markbridge-06-chromium'), 'PATCHED_CHROMIUM');
}
async function chromeIdentity() {
  const normalized = chromeExe.replaceAll('\\', '/').toLowerCase();
  ensure(normalized === 'c:/program files/google/chrome/application/chrome.exe', 'CHROME_PATH');
  ensure(!normalized.includes('markbridge-06-chromium'), 'PATCHED_CHROMIUM');
  let stdout = '';
  try {
    stdout = await pwsh("$item = Get-Item -LiteralPath $env:MB07_CHROME; $info = $item.VersionInfo; Write-Output ('product=' + $info.ProductName); Write-Output ('version=' + $info.ProductVersion)", { MB07_CHROME: chromeExe });
  } catch {
    throw new Error('CHROME_MISSING');
  }
  const product = /product=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  const version = /version=(.*)/.exec(stdout)?.[1]?.trim() ?? '';
  ensure(product === 'Google Chrome', 'NOT_GOOGLE_CHROME');
  ensure(version.length > 0, 'CHROME_MISSING');
  return { product, version };
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
$chromeItem = Get-Item -LiteralPath $env:MB07_CHROME
Write-Output ('chromeLen=' + $chromeItem.Length)
Write-Output ('chromeTicks=' + $chromeItem.LastWriteTimeUtc.Ticks)`, { MB07_CHROME: chromeExe });
  const read = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(stdout)?.[1]?.trim() ?? '';
  return {
    dpi: read('dpi'),
    hklmNames: read('hklmNames'),
    hklmSubs: read('hklmSubs'),
    policyRoot: read('policyRoot'),
    googlePolicy: read('googlePolicy'),
    chromiumPolicy: read('chromiumPolicy'),
    dailyHash: read('dailyHash'),
    dailyLen: Number(read('dailyLen')),
    chromeLen: read('chromeLen'),
    chromeTicks: read('chromeTicks'),
  };
}
function hostValid(snapshot) {
  return /^[0-9A-F]{64}$/.test(snapshot.dailyHash)
    && Number.isInteger(snapshot.dailyLen) && snapshot.dailyLen > 0
    && snapshot.dpi.length > 0
    && snapshot.hklmNames.length > 0
    && /^-?\d+$/.test(snapshot.hklmSubs)
    && (snapshot.policyRoot === 'True' || snapshot.policyRoot === 'False')
    && (snapshot.googlePolicy === 'True' || snapshot.googlePolicy === 'False')
    && (snapshot.chromiumPolicy === 'True' || snapshot.chromiumPolicy === 'False')
    && /^\d+$/.test(snapshot.chromeLen) && Number(snapshot.chromeLen) > 0
    && /^\d+$/.test(snapshot.chromeTicks);
}
function sameHost(before, after) {
  return hostValid(before) && hostValid(after)
    && before.dpi === after.dpi
    && before.hklmNames === after.hklmNames
    && before.hklmSubs === after.hklmSubs
    && before.policyRoot === after.policyRoot
    && before.googlePolicy === after.googlePolicy
    && before.chromiumPolicy === after.chromiumPolicy
    && before.dailyHash === after.dailyHash
    && before.dailyLen === after.dailyLen
    && before.chromeLen === after.chromeLen
    && before.chromeTicks === after.chromeTicks;
}
async function credentialCounts() {
  const stdout = await new Promise((resolveHits, rejectHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (error, text) => {
      const body = text ?? '';
      if (!body.trim()) rejectHits(Object.assign(new Error('CREDENTIAL_LIST_FAILED'), { status: error?.code }));
      else resolveHits(body);
    });
  });
  const lines = stdout.split(/\r?\n/);
  return {
    pairing: lines.filter((line) => line.includes('Markbridge.Pairing')).length,
    task07: lines.filter((line) => line.includes(namespace)).length,
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
function startBackend(directory, credentialNamespace) {
  const child = spawn(exe, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: directory, MARKBRIDGE_CREDENTIAL_NAMESPACE: credentialNamespace },
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
  child.stderr?.setEncoding('utf8');
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
  assertDisposable(directory);
  const child = spawn(chromeExe, [
    '--headless=new', '--remote-debugging-pipe',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--load-extension=${extensionDir}`,
    `--user-data-dir=${directory}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    'about:blank',
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
async function confirmChromeCommand(pid, directory) {
  const stdout = await pwsh(`$ErrorActionPreference = 'Stop'
$root = [int]$env:MB07_PID
$want = $env:MB07_DIR
$ext = $env:MB07_EXT
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and ($_.ProcessId -eq $root -or $_.ParentProcessId -eq $root -or $_.CommandLine -like ('*' + $want + '*')) })
$lines = @($procs | ForEach-Object { $_.CommandLine })
Write-Output ('count=' + $lines.Count)
$lines | ForEach-Object { Write-Output ('cmd=' + $_) }`, { MB07_PID: String(pid), MB07_DIR: directory, MB07_EXT: extensionDir });
  const commands = [...stdout.matchAll(/^cmd=(.*)$/gm)].map((match) => match[1] ?? '');
  ensure(commands.length > 0, 'CHROME_PROFILE_UNCONFIRMED');
  const joined = commands.join('\n').replaceAll('\\', '/').toLowerCase();
  const dir = directory.replaceAll('\\', '/').toLowerCase();
  const ext = extensionDir.replaceAll('\\', '/').toLowerCase();
  ensure(joined.includes(dir), 'CHROME_PROFILE_UNCONFIRMED');
  ensure(joined.includes('--load-extension='), 'EXTENSION_FLAG_MISSING');
  ensure(joined.includes(ext), 'EXTENSION_PATH');
  ensure(!joined.includes('google/chrome/user data'), 'DAILY_PROFILE_PATH');
  ensure(!joined.includes('markbridge-06-chromium'), 'PATCHED_CHROMIUM');
}
async function openOptions(client) {
  ensure(/^[a-p]{32}$/.test(client.extensionId), 'EXTENSION_ID');
  await until(async () => {
    const targets = await client.call('Target.getTargets');
    return (targets.targetInfos ?? []).some((target) => target.url === `chrome-extension://${client.extensionId}/worker.js`);
  }, 'EXTENSION_TARGET');
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
let chromeGets = 0;
async function readNode(page, id) {
  const node = await page.evaluate(`(async () => {
    const nodes = await chrome.bookmarks.get(${JSON.stringify(id)});
    const item = nodes && nodes[0];
    if (!item || item.id !== ${JSON.stringify(id)}) return null;
    return { id: item.id, title: item.title ?? '', url: item.url ?? '' };
  })()`);
  ensure(node?.id === id, 'BOOKMARK_GET_MISSING');
  chromeGets += 1;
  return node;
}
async function revisionOf(profileId) {
  const state = await backend.call('state');
  const profile = state.profiles.find((item) => item.profileId === profileId);
  ensure(profile, 'PROFILE_MISSING');
  return profile.revision;
}
async function operationCount(profileId) {
  const list = await backend.call('list_operations', { profileId });
  return list.operations.length;
}
async function applyEdit(profileId, action) {
  const expectedRevision = await revisionOf(profileId);
  return backend.call('apply_edit', { profileId, expectedRevision, action, secondConfirm: false });
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
async function expectState(profileId, operationId, expected) {
  const state = await settle(profileId, operationId);
  ensure(state === expected, 'OPERATION_STATE');
  return state;
}
async function roots(page) {
  const value = await page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const bar = root.children.find((node) => node.folderType === 'bookmarks-bar');
    return bar?.id ?? null;
  })()`);
  ensure(typeof value === 'string' && value.length > 0, 'CHROME_ROOTS_MISSING');
  return value;
}
async function idByUrl(page, url) {
  const id = await page.evaluate(`(async () => {
    const nodes = await chrome.bookmarks.search({});
    return nodes.find((node) => node.url === ${JSON.stringify(url)})?.id ?? null;
  })()`);
  ensure(typeof id === 'string' && id.length > 0, 'CREATE_MISSING');
  return id;
}
async function createBookmark(page, profileId, parentId, title, url) {
  const created = await applyEdit(profileId, { kind: 'create', parentId, position: 0, title, url });
  await expectState(profileId, created.operationId, 'applied');
  await expectMatch(page, profileId);
  return idByUrl(page, url);
}
async function tagCommand(profileId, command) {
  return backend.call('tag_command', { profileId, command });
}
async function catalog(profileId, chromeIds) {
  return backend.call('tag_catalog', { profileId, chromeIds, filterTagId: null });
}
async function previewEncoding(profileId, chromeIds, restore) {
  const expectedRevision = await revisionOf(profileId);
  const preview = await backend.call('preview_title_encoding', { profileId, expectedRevision, chromeIds, restore });
  return { expectedRevision, preview };
}
async function applyEncoding(profileId, expectedRevision, chromeIds, restore) {
  return backend.call('apply_title_encoding', { profileId, expectedRevision, chromeIds, restore });
}
async function expectError(action) {
  try {
    await action();
    return 'NONE';
  } catch (error) {
    return safeMessage(error);
  }
}
function namesOf(entry, tags) {
  return entry.tagIds.map((tagId) => tags.find((tag) => tag.tagId === tagId)?.name ?? '');
}
function namesFor(catalog, chromeId) {
  const entry = catalog.entries.find((item) => item.chromeId === chromeId);
  return entry ? namesOf(entry, catalog.tags) : null;
}
function fail(control, details) {
  record(control, 'FAIL', details);
  report.status = 'FAIL';
  throw new Halt(control);
}
function seal(cleanupOk) {
  const one = (name) => {
    const rows = report.controls.filter((item) => item.control === name);
    return rows.length === 1 ? rows[0] : null;
  };
  const checks = [
    ['obs1_local_unchanged', (item) => item.titlesUnchanged === true && item.urlsUnchanged === true && item.emptyRejected === true && item.noteStored === true && item.operationsUnchanged === true && item.cacheMatched === true],
    ['obs2_selected_scope', (item) => item.encodingEnabled === true && item.titlesUnchangedAfterEnable === true && item.previewBeforeApply === true && item.changeCount === 2 && item.titleChangesOnly === true && item.pipeDiff === true && item.plainDiff === true && item.keepAbsent === true && item.conflictCount === 0 && item.pipeTitle === true && item.plainTitle === true && item.keepTitle === true && item.linkTitle === true && item.urlsUnchanged === true],
    ['obs3_no_second_copy', (item) => item.secondChangeCount === 0 && item.secondCode === 'BACKEND_INVALID_MESSAGE' && item.pipeUnchanged === true && item.plainUnchanged === true && item.pipeNotDoubled === true && item.plainNotDoubled === true],
    ['obs4_round_trip', (item) => item.pipeTagSet === true && item.pipeParts === true && item.plainParts === true && item.noEmptyFragment === true && item.emptyRejected === true && item.restoreDiff === true && item.restoredTitle === true && item.restoredUrl === true && item.plainStillEncoded === true],
    ['obs5_disable_and_restore', (item) => item.encodingOff === true && item.disableDidNotRename === true && item.operationsUnchangedByDisable === true && item.restoreDiff === true && item.restoredTitle === true && item.restoredUrl === true && item.keepUnchanged === true],
    ['obs6_external_conflict', (item) => item.reenabled === true && item.conflictFlag === true && Array.isArray(item.previewConflicts) && item.previewConflicts.length > 0 && item.previewChangeCount === 0 && item.applyCode === 'BACKEND_CONFLICT' && item.externalPreserved === true && item.keepUnchanged === true],
    ['obs7_tag_restore', (item) => item.mergedAway === true && item.mergeRestored === true && item.deletedAway === true && item.deleteRestored === true && item.titlesUnchanged === true && item.urlsUnchanged === true],
  ];
  const rows = checks.map(([name]) => one(name));
  const proved = rows.every((item, index) => item?.status === 'PASS' && checks[index][1](item));
  const gets = rows.map((item) => item?.chromeGets);
  const orderedGets = gets.every((value, index) => Number.isInteger(value) && value >= 8 && (index === 0 || value > gets[index - 1]));
  const anyFail = report.status === 'FAIL' || rows.some((item) => item?.status === 'FAIL');
  if (proved && orderedGets && cleanupOk && !anyFail) {
    report.status = 'PASS';
    report.exitCode = 0;
    return;
  }
  if (anyFail || (report.hostBefore && !cleanupOk)) {
    report.status = 'FAIL';
    report.exitCode = 1;
    return;
  }
  report.status = 'UNVERIFIED';
  report.exitCode = 2;
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
    try {
      await rm(directory, { recursive: true, force: true });
      return true;
    } catch {
      await delay(250);
    }
  }
  return false;
}
async function rejectPairingNamespace(directory) {
  const before = await credentialCounts();
  const child = spawn(exe, [], {
    env: { ...process.env, MARKBRIDGE_APP_DATA: directory, MARKBRIDGE_CREDENTIAL_NAMESPACE: 'Markbridge.Pairing' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const code = await new Promise((resolveExit) => {
    child.once('error', () => resolveExit('SPAWN'));
    child.once('exit', (status) => resolveExit(status ?? 1));
  });
  const after = await credentialCounts();
  ensure(code !== 'SPAWN', 'HARNESS_MISSING');
  ensure(code !== 0, 'PAIRING_NAMESPACE_ACCEPTED');
  ensure(after.pairing === before.pairing, 'PAIRING_NAMESPACE_WROTE');
  record('pairing_namespace_rejected', 'PASS', { exitCode: code, pairingTargetsUnchanged: true });
}

process.stdout.write(`${JSON.stringify({ control: 'start', status: 'RUN', runId })}\n`);
try {
  ensure(encodeTitle(pipeRaw, ['Work', pipeTag]) === 'A \\| B \\\\ C | Work | x \\| y \\\\ z', 'CODEC_SELF_CHECK');
  ensure(!titleParts(encodeTitle(plainRaw, ['Work'])).includes(''), 'CODEC_SELF_CHECK');
  const browser = await chromeIdentity();
  report.browserProduct = browser.product;
  report.chromeVersion = browser.version;
  const baseline = await hostSnapshot();
  report.hostBefore = baseline;
  const beforeCredentials = await credentialCounts();
  report.credentialCountsBefore = beforeCredentials;
  dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-07-app-'));
  chromeDirectory = await mkdtemp(join(tmpdir(), 'markbridge-07-chrome-'));
  const rejectDirectory = await mkdtemp(join(tmpdir(), 'markbridge-07-reject-'));
  assertDisposable(dataDirectory);
  assertDisposable(chromeDirectory);
  assertDisposable(rejectDirectory);
  report.dataDirectory = 'temp';
  report.chromeDirectory = 'temp';
  await rejectPairingNamespace(rejectDirectory);
  await removeDir(rejectDirectory);
  const port = await freePort();
  backend = startBackend(dataDirectory, namespace);
  await backend.call('start_bridge', { port });
  chrome = launchChrome(chromeDirectory);
  await confirmChromeCommand(chrome.child.pid, chromeDirectory);
  chrome.version = (await chrome.call('Browser.getVersion')).product;
  ensure(String(chrome.version).startsWith('Chrome/'), 'NOT_GOOGLE_CHROME');
  const loaded = await chrome.call('Extensions.loadUnpacked', { path: extensionDir });
  chrome.extensionId = loaded.id;
  const page = await openOptions(chrome);
  record('extension_loaded', 'PASS', { chrome: chrome.version, loadExtensionFlag: true, loadUnpacked: true });
  const offer = await backend.call('begin_pairing', { displayName: 'D07' });
  await until(() => page.evaluate('document.querySelector("#pair")?.disabled === false'), 'PAIR_BUTTON');
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(offer.pairingCode)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find((item) => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${chrome.extensionId}`, 'PAIR_ORIGIN');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  const profileId = offer.profileId;
  await until(async () => (await backend.call('state')).profiles.find((item) => item.profileId === profileId && item.connection === 'live'), 'PROFILE_NOT_LIVE', 30000);
  const base = await expectMatch(page, profileId);
  const barId = await roots(page);
  record('paired_tree', 'PASS', { nodes: base.count, hash: base.hash, chrome: chrome.version });

  const pipeUrl = 'https://example.invalid/mb07/pipe';
  const plainUrl = 'https://example.invalid/mb07/plain';
  const keepUrl = 'https://example.invalid/mb07/keep';
  const linkUrl = 'https://example.invalid/mb07/link';
  const pipeId = await createBookmark(page, profileId, barId, pipeRaw, pipeUrl);
  const plainId = await createBookmark(page, profileId, barId, plainRaw, plainUrl);
  const keepId = await createBookmark(page, profileId, barId, keepRaw, keepUrl);
  const linkId = await createBookmark(page, profileId, barId, linkRaw, linkUrl);
  const beforeLocal = {
    pipe: await readNode(page, pipeId),
    plain: await readNode(page, plainId),
    keep: await readNode(page, keepId),
    link: await readNode(page, linkId),
  };
  const operationsBeforeTags = await operationCount(profileId);
  await tagCommand(profileId, { kind: 'add', chromeIds: [pipeId, plainId, keepId], name: 'Work' });
  await tagCommand(profileId, { kind: 'set_note', chromeIds: [plainId], note: noteText });
  await tagCommand(profileId, { kind: 'add', chromeIds: [pipeId], name: pipeTag });
  const emptyCode = await expectError(() => tagCommand(profileId, { kind: 'add', chromeIds: [plainId], name: '' }));
  const blankCode = await expectError(() => tagCommand(profileId, { kind: 'add', chromeIds: [plainId], name: '   ' }));
  const afterLocal = {
    pipe: await readNode(page, pipeId),
    plain: await readNode(page, plainId),
    keep: await readNode(page, keepId),
    link: await readNode(page, linkId),
  };
  const localMatch = await expectMatch(page, profileId);
  const localCatalog = await catalog(profileId, [plainId, pipeId]);
  const plainEntry = localCatalog.entries.find((entry) => entry.chromeId === plainId);
  const pipeEntry = localCatalog.entries.find((entry) => entry.chromeId === pipeId);
  const pipeTags = (pipeEntry?.tagIds ?? []).map((tagId) => localCatalog.tags.find((tag) => tag.tagId === tagId)?.name).filter((name) => name);
  const operationsAfterTags = await operationCount(profileId);
  const obs1 = {
    titlesUnchanged: beforeLocal.pipe.title === afterLocal.pipe.title && beforeLocal.plain.title === afterLocal.plain.title && beforeLocal.keep.title === afterLocal.keep.title && beforeLocal.link.title === afterLocal.link.title,
    urlsUnchanged: beforeLocal.pipe.url === afterLocal.pipe.url && beforeLocal.plain.url === afterLocal.plain.url && beforeLocal.keep.url === afterLocal.keep.url && beforeLocal.link.url === afterLocal.link.url,
    emptyRejected: emptyCode === 'BACKEND_INVALID_MESSAGE' && blankCode === 'BACKEND_INVALID_MESSAGE',
    noteStored: plainEntry?.note === noteText,
    operationsUnchanged: operationsBeforeTags === operationsAfterTags,
    cacheMatched: typeof localMatch.hash === 'string' && localMatch.hash.length === 16 && localMatch.count > 0,
    chromeGets,
  };
  if (!obs1.titlesUnchanged || !obs1.urlsUnchanged || !obs1.emptyRejected || !obs1.noteStored || !obs1.operationsUnchanged || !obs1.cacheMatched || obs1.chromeGets < 8) fail('obs1_local_unchanged', obs1);
  record('obs1_local_unchanged', 'PASS', obs1);

  const enabled = await tagCommand(profileId, { kind: 'set_encoding', enabled: true });
  const afterEnable = {
    pipe: await readNode(page, pipeId),
    plain: await readNode(page, plainId),
    keep: await readNode(page, keepId),
  };
  const pipeEncoded = encodeTitle(pipeRaw, pipeTags);
  const plainEncoded = encodeTitle(plainRaw, ['Work']);
  const preview = await previewEncoding(profileId, [pipeId, plainId], false);
  const changes = preview.preview.changes ?? [];
  const previewBeforeApply = changes.length === 2 && changes.every((change) => change.field === 'title' && typeof change.before === 'string' && change.before.length > 0 && typeof change.after === 'string' && change.after.length > 0 && change.before !== change.after);
  const obs2Preview = {
    encodingEnabled: enabled.encodingEnabled === true,
    titlesUnchangedAfterEnable: afterEnable.pipe.title === pipeRaw && afterEnable.plain.title === plainRaw && afterEnable.keep.title === keepRaw,
    previewBeforeApply,
    changeCount: changes.length,
    titleChangesOnly: changes.every((change) => change.field === 'title'),
    pipeDiff: changes.some((change) => change.before === pipeRaw && change.after === pipeEncoded),
    plainDiff: changes.some((change) => change.before === plainRaw && change.after === plainEncoded),
    keepAbsent: changes.every((change) => change.before !== keepRaw && change.after !== encodeTitle(keepRaw, ['Work'])),
    conflictCount: (preview.preview.conflicts ?? []).length,
  };
  if (!obs2Preview.encodingEnabled || !obs2Preview.titlesUnchangedAfterEnable || !obs2Preview.previewBeforeApply || !obs2Preview.titleChangesOnly || !obs2Preview.pipeDiff || !obs2Preview.plainDiff || !obs2Preview.keepAbsent || obs2Preview.changeCount !== 2 || obs2Preview.conflictCount !== 0) {
    fail('obs2_selected_scope', obs2Preview);
  }
  const encoded = await applyEncoding(profileId, preview.expectedRevision, [pipeId, plainId], false);
  await expectState(profileId, encoded.operationId, 'applied');
  await expectMatch(page, profileId);
  const afterEncode = {
    pipe: await readNode(page, pipeId),
    plain: await readNode(page, plainId),
    keep: await readNode(page, keepId),
    link: await readNode(page, linkId),
  };
  const obs2 = {
    ...obs2Preview,
    pipeTitle: afterEncode.pipe.title === pipeEncoded,
    plainTitle: afterEncode.plain.title === plainEncoded,
    keepTitle: afterEncode.keep.title === keepRaw,
    linkTitle: afterEncode.link.title === linkRaw,
    urlsUnchanged: afterEncode.pipe.url === pipeUrl && afterEncode.plain.url === plainUrl && afterEncode.keep.url === keepUrl && afterEncode.link.url === linkUrl,
    chromeGets,
  };
  if (!obs2.pipeTitle || !obs2.plainTitle || !obs2.keepTitle || !obs2.linkTitle || !obs2.urlsUnchanged) fail('obs2_selected_scope', obs2);
  record('obs2_selected_scope', 'PASS', obs2);

  const secondPreview = await previewEncoding(profileId, [pipeId, plainId], false);
  const secondCode = await expectError(() => applyEncoding(profileId, secondPreview.expectedRevision, [pipeId, plainId], false));
  await expectMatch(page, profileId);
  const afterSecond = { pipe: await readNode(page, pipeId), plain: await readNode(page, plainId) };
  const obs3 = {
    secondChangeCount: (secondPreview.preview.changes ?? []).length,
    secondCode,
    pipeUnchanged: afterSecond.pipe.title === pipeEncoded,
    plainUnchanged: afterSecond.plain.title === plainEncoded,
    pipeNotDoubled: afterSecond.pipe.title !== `${pipeEncoded} | ${escapeTitle('Work')}` && !afterSecond.pipe.title.includes(`${pipeEncoded} |`),
    plainNotDoubled: afterSecond.plain.title !== `${plainEncoded} | Work`,
    chromeGets,
  };
  if (obs3.secondChangeCount !== 0 || obs3.secondCode !== 'BACKEND_INVALID_MESSAGE' || !obs3.pipeUnchanged || !obs3.plainUnchanged || !obs3.pipeNotDoubled || !obs3.plainNotDoubled) fail('obs3_no_second_copy', obs3);
  record('obs3_no_second_copy', 'PASS', obs3);

  const pipeParts = titleParts(afterSecond.pipe.title);
  const plainParts = titleParts(afterSecond.plain.title);
  const restorePreview = await previewEncoding(profileId, [pipeId], true);
  const restoreChanges = restorePreview.preview.changes ?? [];
  const restored = await applyEncoding(profileId, restorePreview.expectedRevision, [pipeId], true);
  await expectState(profileId, restored.operationId, 'applied');
  await expectMatch(page, profileId);
  const afterRestore = await readNode(page, pipeId);
  const obs4 = {
    pipeTagSet: JSON.stringify([...pipeTags].sort()) === JSON.stringify([pipeTag, 'Work'].sort()),
    pipeParts: JSON.stringify(pipeParts) === JSON.stringify([pipeRaw, ...pipeTags]),
    plainParts: JSON.stringify(plainParts) === JSON.stringify([plainRaw, 'Work']),
    noEmptyFragment: pipeParts?.every((part) => part.length > 0) === true && plainParts?.every((part) => part.length > 0) === true,
    emptyRejected: obs1.emptyRejected,
    restoreDiff: restoreChanges.length === 1 && restoreChanges[0]?.field === 'title' && restoreChanges[0]?.before === pipeEncoded && restoreChanges[0]?.after === pipeRaw && (restorePreview.preview.conflicts ?? []).length === 0,
    restoredTitle: afterRestore.title === pipeRaw,
    restoredUrl: afterRestore.url === pipeUrl,
    plainStillEncoded: (await readNode(page, plainId)).title === plainEncoded,
    chromeGets,
  };
  if (!obs4.pipeTagSet || !obs4.pipeParts || !obs4.plainParts || !obs4.noEmptyFragment || !obs4.emptyRejected || !obs4.restoreDiff || !obs4.restoredTitle || !obs4.restoredUrl || !obs4.plainStillEncoded) fail('obs4_round_trip', obs4);
  record('obs4_round_trip', 'PASS', obs4);

  const beforeDisable = { plain: await readNode(page, plainId), keep: await readNode(page, keepId), pipe: await readNode(page, pipeId) };
  const hashBeforeDisable = (await expectMatch(page, profileId)).hash;
  const operationsBeforeDisable = await operationCount(profileId);
  const disabled = await tagCommand(profileId, { kind: 'set_encoding', enabled: false });
  await expectMatch(page, profileId);
  const afterDisable = { plain: await readNode(page, plainId), keep: await readNode(page, keepId), pipe: await readNode(page, pipeId) };
  const hashAfterDisable = (await expectMatch(page, profileId)).hash;
  const operationsAfterDisable = await operationCount(profileId);
  const disableSame = afterDisable.plain.title === beforeDisable.plain.title && afterDisable.keep.title === beforeDisable.keep.title && afterDisable.pipe.title === beforeDisable.pipe.title && afterDisable.plain.url === beforeDisable.plain.url;
  const closePreview = await previewEncoding(profileId, [plainId], true);
  const closeChanges = closePreview.preview.changes ?? [];
  const closeApplied = await applyEncoding(profileId, closePreview.expectedRevision, [plainId], true);
  await expectState(profileId, closeApplied.operationId, 'applied');
  await expectMatch(page, profileId);
  const afterClose = await readNode(page, plainId);
  const obs5 = {
    encodingOff: disabled.encodingEnabled === false,
    disableDidNotRename: disableSame && hashBeforeDisable === hashAfterDisable,
    operationsUnchangedByDisable: operationsAfterDisable === operationsBeforeDisable,
    restoreDiff: closeChanges.length === 1 && closeChanges[0]?.before === plainEncoded && closeChanges[0]?.after === plainRaw && (closePreview.preview.conflicts ?? []).length === 0,
    restoredTitle: afterClose.title === plainRaw,
    restoredUrl: afterClose.url === plainUrl,
    keepUnchanged: (await readNode(page, keepId)).title === keepRaw,
    chromeGets,
  };
  if (!obs5.encodingOff || !obs5.disableDidNotRename || !obs5.operationsUnchangedByDisable || !obs5.restoreDiff || !obs5.restoredTitle || !obs5.restoredUrl || !obs5.keepUnchanged) fail('obs5_disable_and_restore', obs5);
  record('obs5_disable_and_restore', 'PASS', obs5);

  const reenabled = await tagCommand(profileId, { kind: 'set_encoding', enabled: true });
  ensure((await readNode(page, plainId)).title === plainRaw, 'ENABLE_RENAMED');
  const again = await previewEncoding(profileId, [plainId], false);
  ensure(again.preview.changes?.length === 1 && again.preview.changes[0]?.after === plainEncoded, 'RECODE_DIFF');
  const reapplied = await applyEncoding(profileId, again.expectedRevision, [plainId], false);
  await expectState(profileId, reapplied.operationId, 'applied');
  await expectMatch(page, profileId);
  ensure((await readNode(page, plainId)).title === plainEncoded, 'RECODE_TITLE');
  ensure((await readNode(page, keepId)).title === keepRaw, 'KEEP_RENAMED');
  await page.evaluate(`chrome.bookmarks.update(${JSON.stringify(plainId)}, { title: ${JSON.stringify(externalTitle)} })`);
  await expectMatch(page, profileId);
  const conflictCatalog = await catalog(profileId, [plainId, keepId]);
  const conflictEntry = conflictCatalog.entries.find((entry) => entry.chromeId === plainId);
  const conflictPreview = await previewEncoding(profileId, [plainId], false);
  const conflictCode = await expectError(() => applyEncoding(profileId, conflictPreview.expectedRevision, [plainId], false));
  await expectMatch(page, profileId);
  const afterConflict = { plain: await readNode(page, plainId), keep: await readNode(page, keepId) };
  const obs6 = {
    reenabled: reenabled.encodingEnabled === true,
    conflictFlag: conflictEntry?.conflict === true,
    previewConflicts: (conflictPreview.preview.conflicts ?? []).map((conflict) => conflict.chromeId),
    previewChangeCount: (conflictPreview.preview.changes ?? []).length,
    applyCode: conflictCode,
    externalPreserved: afterConflict.plain.title === externalTitle && afterConflict.plain.url === plainUrl,
    keepUnchanged: afterConflict.keep.title === keepRaw && afterConflict.keep.url === keepUrl,
    chromeGets,
  };
  if (!obs6.reenabled || !obs6.conflictFlag || !obs6.previewConflicts.includes(plainId) || obs6.previewChangeCount !== 0 || obs6.applyCode !== 'BACKEND_CONFLICT' || !obs6.externalPreserved || !obs6.keepUnchanged) fail('obs6_external_conflict', obs6);
  record('obs6_external_conflict', 'PASS', obs6);

  const titlesBeforeMigration = { link: await readNode(page, linkId), keep: await readNode(page, keepId), pipe: await readNode(page, pipeId) };
  const addedAlpha = await tagCommand(profileId, { kind: 'add', chromeIds: [linkId], name: 'Alpha' });
  const alpha = addedAlpha.tags.find((tag) => tag.name === 'Alpha');
  const work = addedAlpha.tags.find((tag) => tag.name === 'Work');
  ensure(alpha && work, 'TAG_IDS_MISSING');
  const merged = await tagCommand(profileId, { kind: 'merge', sourceId: alpha.tagId, targetId: work.tagId });
  const mergedCatalog = await catalog(profileId, [linkId]);
  const mergedNames = namesFor(mergedCatalog, linkId);
  const undoneMerge = await tagCommand(profileId, { kind: 'undo', journalId: merged.journalId });
  const mergeUndoCatalog = await catalog(profileId, [linkId]);
  const mergeUndoNames = namesFor(mergeUndoCatalog, linkId);
  const alphaAgain = mergeUndoCatalog.tags.find((tag) => tag.name === 'Alpha');
  ensure(alphaAgain, 'TAG_UNDO_MISSING');
  const deleted = await tagCommand(profileId, { kind: 'delete', tagId: alphaAgain.tagId });
  const deletedCatalog = await catalog(profileId, [linkId]);
  const deletedNames = namesFor(deletedCatalog, linkId);
  const undoneDelete = await tagCommand(profileId, { kind: 'undo', journalId: deleted.journalId });
  const deleteUndoCatalog = await catalog(profileId, [linkId]);
  const deleteUndoNames = namesFor(deleteUndoCatalog, linkId);
  await expectMatch(page, profileId);
  const titlesAfterMigration = { link: await readNode(page, linkId), keep: await readNode(page, keepId), pipe: await readNode(page, pipeId) };
  const obs7 = {
    mergedAway: mergedNames?.includes('Work') === true && mergedNames?.includes('Alpha') === false,
    mergeRestored: mergeUndoNames?.includes('Alpha') === true && mergeUndoNames?.includes('Work') === false && undoneMerge.encodingEnabled === true,
    deletedAway: deletedNames?.includes('Alpha') === false,
    deleteRestored: deleteUndoNames?.includes('Alpha') === true,
    titlesUnchanged: titlesAfterMigration.link.title === titlesBeforeMigration.link.title && titlesAfterMigration.keep.title === titlesBeforeMigration.keep.title && titlesAfterMigration.pipe.title === titlesBeforeMigration.pipe.title,
    urlsUnchanged: titlesAfterMigration.link.url === linkUrl && titlesAfterMigration.keep.url === keepUrl && titlesAfterMigration.pipe.url === pipeUrl,
    chromeGets,
  };
  if (!obs7.mergedAway || !obs7.mergeRestored || !obs7.deletedAway || !obs7.deleteRestored || !obs7.titlesUnchanged || !obs7.urlsUnchanged) fail('obs7_tag_restore', obs7);
  record('obs7_tag_restore', 'PASS', obs7);
} catch (error) {
  if (!(error instanceof Halt)) record('run', report.status === 'FAIL' ? 'FAIL' : 'UNVERIFIED', { code: safeMessage(error) });
  if (report.status !== 'FAIL') {
    report.status = 'UNVERIFIED';
    report.exitCode = 2;
  } else {
    report.exitCode = 1;
  }
} finally {
  if (backend) { try { await backend.call('shutdown'); } catch { /* The process may already be gone. */ } await kill(backend.child); }
  if (chrome) await kill(chrome.child);
  for (const child of processes) await kill(child);
  await delay(400);
  const dataRemoved = await removeDir(dataDirectory);
  const chromeRemoved = await removeDir(chromeDirectory);
  try { report.hostAfter = await hostSnapshot(); } catch { report.hostAfter = null; }
  await deleteNamespaceTargets();
  let counts = null;
  try { counts = await credentialCounts(); } catch { counts = null; }
  const hostSame = report.hostBefore && report.hostAfter ? sameHost(report.hostBefore, report.hostAfter) : false;
  report.cleanup = {
    dataRemoved,
    chromeRemoved,
    pairingTargets: counts?.pairing ?? -1,
    task07Targets: counts?.task07 ?? -1,
    pairingUnchanged: counts?.pairing === 0 && report.credentialCountsBefore?.pairing === 0,
    dailyBookmarksUnchanged: hostSame,
    dpiUnchanged: hostSame,
    hklmUnchanged: hostSame,
    policiesUnchanged: hostSame,
    hostUnchanged: hostSame,
    chromeUnchanged: hostSame,
  };
  const cleanupOk = report.cleanup.dataRemoved === true && report.cleanup.chromeRemoved === true && report.cleanup.task07Targets === 0 && report.cleanup.pairingUnchanged === true && report.cleanup.dailyBookmarksUnchanged === true && report.cleanup.dpiUnchanged === true && report.cleanup.hklmUnchanged === true && report.cleanup.policiesUnchanged === true && report.cleanup.chromeUnchanged === true;
  report.cleanup.ok = cleanupOk;
  seal(cleanupOk);
  await writeFile(join(evidence, 'v09-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.exitCode ?? 2);
}
