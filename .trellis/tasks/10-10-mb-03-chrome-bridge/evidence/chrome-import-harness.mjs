// One disposable Chrome. First-run bookmark dict is JSON, not Netscape HTML.
// The bookmark file stays locked until get_tree is in flight, then the import can end.
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/10-10-mb-03-chrome-bridge/evidence');
const suffix = randomBytes(3).toString('hex');
const namespace = `Markbridge.Task03.${suffix}`;
const probeUrl = 'https://example.invalid/mb03-import-probe';
const installedExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const installedVersion = 'C:\\Program Files\\Google\\Chrome\\Application\\155.0.8059.39';
const dailyProfile = 'C:\\Users\\lyh\\AppData\\Local\\Google\\Chrome\\User Data';
const report = {
  suffix,
  namespace,
  startedAt: new Date().toISOString(),
  command: 'node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-harness.mjs',
  wire: [],
  states: [],
  importEnded: false,
  resyncAfterImport: false,
  treeAfterResync: false,
  reconcilingAfterImport: false,
  treesMatch: false,
  probePresent: false,
  oplock: null,
  launchedFromTempCopy: false,
  dailyProfileTouched: false,
};
const profiles = [];
let backend;
let proxyServer;
let chromeChild;
let oplockChild;
const root = await mkdtemp(join(tmpdir(), 'markbridge-03-import-'));
const userData = join(root, 'user-data');
const appData = join(root, 'app-data');
const launchDir = join(root, 'chrome-app');
const bookmarksPath = join(userData, 'Default', 'Bookmarks');
const oplockStatus = join(root, 'oplock-status.txt');
const oplockRelease = join(root, 'oplock-release');
report.root = root;

function note(code, extra = {}) {
  const item = { code, ...extra };
  process.stdout.write(`${JSON.stringify(item)}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
function exec(file, args) {
  return new Promise((resolveExec, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolveExec(stdout);
    });
  });
}
async function until(probe, code, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await probe();
    if (result) return result;
    await delay(80);
  }
  throw new Error(code);
}
function rpcProcess(exe, args) {
  const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let next = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.errorCode) request.reject(new Error(`BACKEND_${message.errorCode}`));
    else request.resolve(message.result);
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('BACKEND_EXIT')); pending.clear(); });
  return { child, call(command, args = {}) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject });
      child.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    });
  } };
}
function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('PORT_RESERVE')));
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(error => error ? reject(new Error('PORT_RESERVE')) : resolvePort(value));
    });
  });
}
function takeFrame(state, wantMask) {
  const buffer = state.buffer;
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    if (high !== 0 || low > 8 * 1024 * 1024) throw new Error('FRAME_TOO_LARGE');
    length = low;
    offset = 10;
  }
  if ((first & 0x70) !== 0) throw new Error('FRAME_RSV');
  if (wantMask !== masked) throw new Error(wantMask ? 'FRAME_CLIENT_UNMASKED' : 'FRAME_SERVER_MASKED');
  if (opcode >= 8) {
    if (!fin || length > 125) throw new Error('FRAME_CONTROL');
  } else if (!(opcode === 1 && fin)) throw new Error(opcode === 1 ? 'FRAME_FRAGMENT' : 'FRAME_OPCODE');
  const maskLen = masked ? 4 : 0;
  const total = offset + maskLen + length;
  if (buffer.length < total) return null;
  const frame = Buffer.from(buffer.subarray(0, total));
  state.buffer = buffer.subarray(total);
  if (opcode !== 1) return { text: null };
  const data = frame.subarray(offset + maskLen);
  const out = Buffer.alloc(length);
  if (masked) {
    const mask = frame.subarray(offset, offset + 4);
    for (let index = 0; index < length; index += 1) out[index] = data[index] ^ mask[index & 3];
  } else data.copy(out);
  let value;
  try { value = JSON.parse(out.toString('utf8')); }
  catch { return { text: { type: 'NON_JSON', kind: null } }; }
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') return { text: { type: 'NON_JSON', kind: null } };
  const kind = value.type === 'event' && value.payload && value.payload.event && typeof value.payload.event.kind === 'string'
    ? value.payload.event.kind : null;
  return { text: { type: value.type, kind } };
}
function pushWire(direction, text) {
  if (!text || report.wire.length >= 80) return;
  const token = text.kind ? `${direction}:${text.type}:${text.kind}` : `${direction}:${text.type}`;
  report.wire.push(token);
  if (token === 'c:event:import_ended') report.importEnded = true;
  if (report.importEnded && token === 'c:resync_required') report.resyncAfterImport = true;
  if (report.resyncAfterImport && token === 'c:tree_full') report.treeAfterResync = true;
}
function rewritePort(raw, proxyPort, bridgePort) {
  const value = JSON.parse(raw);
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'credential,expiresAt,port,profileId,protocolVersion') throw new Error('PAIR_CODE_SHAPE');
  if (value.protocolVersion !== 1 || value.port !== bridgePort) throw new Error('PAIR_CODE_PORT');
  value.port = proxyPort;
  return JSON.stringify(value);
}
function acceptProxy(client, bridgePort) {
  client.setNoDelay(true);
  const upstream = createConnection({ host: '127.0.0.1', port: bridgePort });
  upstream.setNoDelay(true);
  const clientState = { buffer: Buffer.alloc(0), ready: false, request: Buffer.alloc(0) };
  const serverState = { buffer: Buffer.alloc(0), responded: false, response: Buffer.alloc(0) };
  const fail = (code) => { if (!report.proxyError) report.proxyError = code; client.destroy(); upstream.destroy(); };
  client.on('data', chunk => {
    if (!clientState.ready) {
      clientState.request = Buffer.concat([clientState.request, chunk]);
      const text = clientState.request.toString('latin1');
      const end = text.indexOf('\r\n\r\n');
      if (end < 0) return;
      const lines = text.slice(0, end).split('\r\n');
      if (lines[0] !== 'GET / HTTP/1.1') { fail('HANDSHAKE_TARGET'); return; }
      const next = [];
      let host = 0;
      for (const line of lines) {
        if (/^host:/i.test(line)) { host += 1; next.push(`Host: 127.0.0.1:${bridgePort}`); continue; }
        if (/^sec-websocket-extensions:/i.test(line)) continue;
        next.push(line);
      }
      if (host !== 1) { fail('HANDSHAKE_HOST'); return; }
      upstream.write(Buffer.concat([Buffer.from(`${next.join('\r\n')}\r\n\r\n`, 'latin1'), clientState.request.subarray(end + 4)]));
      clientState.ready = true;
      return;
    }
    clientState.buffer = Buffer.concat([clientState.buffer, chunk]);
    try {
      let frame = takeFrame(clientState, true);
      while (frame) { pushWire('c', frame.text); frame = takeFrame(clientState, true); }
    } catch (error) { fail(error.message); return; }
    upstream.write(chunk);
  });
  upstream.on('data', chunk => {
    if (!serverState.responded) {
      serverState.response = Buffer.concat([serverState.response, chunk]);
      const text = serverState.response.toString('latin1');
      const end = text.indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!text.startsWith('HTTP/1.1 101')) { fail('HANDSHAKE_STATUS'); return; }
      serverState.responded = true;
      client.write(serverState.response.subarray(0, end + 4));
      chunk = serverState.response.subarray(end + 4);
      if (!chunk.length) return;
    }
    serverState.buffer = Buffer.concat([serverState.buffer, chunk]);
    try {
      let frame = takeFrame(serverState, false);
      while (frame) { pushWire('s', frame.text); frame = takeFrame(serverState, false); }
    } catch (error) { fail(error.message); return; }
    client.write(chunk);
  });
  client.on('error', () => fail('PROXY_SOCKET'));
  upstream.on('error', () => fail('PROXY_SOCKET'));
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
}
function startProxy(bridgePort) {
  proxyServer = createServer(client => acceptProxy(client, bridgePort));
  return new Promise((resolvePort, reject) => {
    proxyServer.once('error', () => reject(new Error('PROXY_BIND')));
    proxyServer.listen(0, '127.0.0.1', () => resolvePort(proxyServer.address().port));
  });
}
async function cmdkeyCounts() {
  let stdout = '';
  try { stdout = await exec('cmdkey', ['/list']); } catch (error) { stdout = error.stdout || ''; }
  const lines = stdout.split(/\r?\n/);
  return {
    pairing: lines.filter(line => line.includes('Markbridge.Pairing')).length,
    namespace: lines.filter(line => line.includes(namespace)).length,
  };
}
async function deleteNamespaceTargets() {
  let stdout = '';
  try { stdout = await exec('cmdkey', ['/list']); } catch (error) { stdout = error.stdout || ''; }
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/Target:\s*(.+)/i);
    if (!match) continue;
    const target = match[1].trim();
    if (!target.includes(namespace) || target.includes('Markbridge.Pairing')) continue;
    try { await exec('cmdkey', [`/delete:${target}`]); } catch { /* count remains the evidence */ }
  }
}
async function processFacts(pid) {
  const script = `$ids = @(${pid}); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${pid} -or $_.ParentProcessId -eq ${pid} } | ForEach-Object { $_.ExecutablePath; $_.CommandLine }`;
  try { return await exec('powershell.exe', ['-NoProfile', '-Command', script]); }
  catch { return ''; }
}
function containsDaily(text) { return text.includes(dailyProfile); }
async function prepareLauncher() {
  await mkdir(launchDir, { recursive: true });
  await copyFile(installedExe, join(launchDir, 'chrome.exe'));
  await copyFile('C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe', join(launchDir, 'chrome_proxy.exe'));
  await copyFile(join(installedVersion, '155.0.8059.39.manifest'), join(launchDir, '155.0.8059.39.manifest'));
  await copyFile(join(installedVersion, 'chrome_elf.dll'), join(launchDir, 'chrome_elf.dll'));
  await exec('cmd', ['/c', 'mklink', '/J', join(launchDir, '155.0.8059.39'), installedVersion]);
  await writeFile(join(launchDir, 'config.json'), `${JSON.stringify({
    install_path: launchDir,
    version_branch: 'stable',
    download_channel: 'edgedl.me.gvt1',
    old_plus_ver: '-',
    chrome_plus: 'Bush2021',
    remain_install_file: false,
    remain_history_file: false,
    theme: 'System',
    lang: 'System',
    gh_proxy: '',
    proxy_type: 'GH-PROXY',
    auto_update: false,
  })}\n`);
  await writeFile(join(launchDir, 'initial_preferences'), `${JSON.stringify({
    bookmarks: {
      first_run_bookmarks: {
        children: [{ name: 'mb03-import-probe', type: 'url', url: probeUrl }],
      },
    },
  })}\n`);
}
async function prepareProfile() {
  await mkdir(join(userData, 'Default'), { recursive: true });
  await writeFile(bookmarksPath, `${JSON.stringify({
    version: 1,
    roots: {
      bookmark_bar: { id: '1', name: 'Bookmarks bar', type: 'folder', children: [] },
      other: { id: '2', name: 'Other bookmarks', type: 'folder', children: [] },
      synced: { id: '3', name: 'Mobile bookmarks', type: 'folder', children: [] },
    },
  })}\n`);
}
function startOplock() {
  const ps1 = join(root, 'oplock.ps1');
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public class OplockHold {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(IntPtr h, uint code, IntPtr inBuf, uint inSize, IntPtr outBuf, uint outSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr CreateEventW(IntPtr sec, bool manual, bool initial, string name);
  [DllImport("kernel32.dll")]
  static extern uint GetLastError();
  const uint GENERIC_READ = 0x80000000;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_OVERLAPPED = 0x40000000;
  const uint FSCTL_REQUEST_OPLOCK_LEVEL_1 = 0x00090000;
  [StructLayout(LayoutKind.Sequential)]
  struct OVERLAPPED {
    public IntPtr Internal;
    public IntPtr InternalHigh;
    public uint Offset;
    public uint OffsetHigh;
    public IntPtr hEvent;
  }
  public static int Hold(string path, string statusPath, string releasePath) {
    IntPtr handle = CreateFileW(path, GENERIC_READ, 0, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero);
    if (handle == new IntPtr(-1)) { File.WriteAllText(statusPath, "OPEN_FAIL " + GetLastError()); return 2; }
    IntPtr ev = CreateEventW(IntPtr.Zero, true, false, null);
    OVERLAPPED ov = new OVERLAPPED();
    ov.hEvent = ev;
    IntPtr mem = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(OVERLAPPED)));
    Marshal.StructureToPtr(ov, mem, false);
    uint returned;
    bool ok = DeviceIoControl(handle, FSCTL_REQUEST_OPLOCK_LEVEL_1, IntPtr.Zero, 0, IntPtr.Zero, 0, out returned, mem);
    if (!ok && GetLastError() != 997) {
      CloseHandle(handle);
      File.WriteAllText(statusPath, "OPLOCK_FAIL " + GetLastError());
      return 3;
    }
    File.WriteAllText(statusPath, "HELD");
    while (!File.Exists(releasePath)) Thread.Sleep(50);
    CloseHandle(handle);
    CloseHandle(ev);
    Marshal.FreeHGlobal(mem);
    File.WriteAllText(statusPath, "RELEASED");
    return 0;
  }
}
"@
[OplockHold]::Hold($args[0], $args[1], $args[2]) | Out-Null
`;
  return writeFile(ps1, script).then(() => {
    oplockChild = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, bookmarksPath, oplockStatus, oplockRelease], { windowsHide: true, stdio: 'ignore' });
  });
}
async function readOplock() {
  try { return (await readFile(oplockStatus, 'utf8')).trim(); }
  catch { return ''; }
}
async function releaseOplock() {
  await writeFile(oplockRelease, 'release');
  await until(async () => {
    const status = await readOplock();
    return status === 'RELEASED' || status.startsWith('OPLOCK_FAIL') || status.startsWith('OPEN_FAIL');
  }, 'OPLOCK_RELEASE_TIMEOUT', 5000).catch(() => null);
  report.oplock = await readOplock();
}
function launchChrome() {
  chromeChild = spawn(join(launchDir, 'chrome.exe'), [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userData}`, '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { cwd: launchDir, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  chromeChild.on('error', error => { report.spawnError = error.code || 'SPAWN_ERROR'; });
  if (!chromeChild.stdio[3] || !chromeChild.stdio[4]) throw new Error('CDP_PIPE_MISSING');
  let next = 0;
  let buffer = '';
  const pending = new Map();
  chromeChild.stdio[4].setEncoding('utf8');
  chromeChild.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!message.id) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
      else request.resolve(message.result);
    }
  });
  chromeChild.on('exit', () => { for (const request of pending.values()) request.reject(new Error('CHROME_EXIT')); pending.clear(); });
  const client = { child: chromeChild, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject, method });
      chromeChild.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  } };
  profiles.push(client);
  return client;
}
async function openOptions(client) {
  const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
  const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
  await client.call('Runtime.enable', {}, sessionId);
  const page = { targetId, sessionId, async evaluate(expression) {
    const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    ensure(!response.exceptionDetails, 'CHROME_EVALUATION_FAILED');
    return response.result.value;
  } };
  await until(() => page.evaluate('!!document.querySelector("#pairing-code")'), 'OPTIONS_NOT_READY');
  return page;
}
async function cache(profileId) { return backend.call('cache', { profileId }); }
async function rememberState() {
  const state = await backend.call('state');
  const connection = state.profiles.find(profile => profile.profileId === report.profileId)?.connection ?? null;
  if (report.states.at(-1) !== connection) report.states.push(connection);
  if (report.importEnded && connection === 'reconciling') report.reconcilingAfterImport = true;
  return connection;
}

function mark(step) { report.step = step; note('step', { step }); }
try {
  ensure(!userData.startsWith(dailyProfile) && !launchDir.startsWith('C:\\Program Files'), 'PATH_GUARD');
  mark('credentials');
  report.credentialBefore = await cmdkeyCounts();
  mark('launcher');
  await prepareLauncher();
  mark('profile');
  await prepareProfile();
  mark('oplock');
  await startOplock();
  await until(async () => {
    const status = await readOplock();
    return status === 'HELD' || status.startsWith('OPLOCK_FAIL') || status.startsWith('OPEN_FAIL');
  }, 'OPLOCK_TIMEOUT', 10000);
  report.oplock = await readOplock();
  if (report.oplock !== 'HELD') await releaseOplock();
  mark('bridge');
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [appData, namespace]);
  const bridgePort = await reservePort();
  const proxyPort = await startProxy(bridgePort);
  ensure(proxyPort !== bridgePort, 'PROXY_PORT');
  await backend.call('start_bridge', { port: bridgePort });
  mark('chrome');
  const client = launchChrome();
  const facts = await until(async () => {
    const text = await processFacts(chromeChild.pid);
    return text.includes(userData) || text.includes(dailyProfile) ? text : '';
  }, 'PROCESS_FACT_TIMEOUT', 8000).catch(() => '');
  report.launchedFromTempCopy = facts.includes(launchDir);
  if (containsDaily(facts) || !facts.includes(userData)) {
    report.dailyProfileTouched = containsDaily(facts);
    throw new Error(containsDaily(facts) ? 'DAILY_PROFILE_GUARD' : 'USER_DATA_GUARD');
  }
  const versionProbe = () => client.call('Browser.getVersion').then(value => value.product).catch(() => null);
  let version = await until(versionProbe, 'CDP_TIMEOUT', 12000).catch(() => null);
  if (!version && report.oplock === 'HELD') {
    report.oplockBlockedStartup = true;
    await releaseOplock();
    version = await until(versionProbe, 'CDP_TIMEOUT', 15000);
  }
  client.version = version;
  report.chrome = client.version;
  const loaded = await client.call('Extensions.loadUnpacked', { path: resolve('apps/extension/dist') });
  client.extensionId = loaded.id;
  report.extensionId = loaded.id;
  const page = await openOptions(client);
  const offer = await backend.call('begin_pairing', { displayName: 'Import probe' });
  const code = rewritePort(offer.pairingCode, proxyPort, bridgePort);
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(code)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  report.profileId = offer.profileId;
  await until(async () => {
    await rememberState();
    return report.wire.includes('s:get_tree') || report.states.includes('reconciling');
  }, 'GET_TREE_NOT_SENT', 20000);
  await delay(400);
  const treeBeforeRelease = report.wire.includes('c:tree_full');
  report.treeBeforeRelease = treeBeforeRelease;
  if (report.oplock === 'HELD') await releaseOplock();
  await until(async () => {
    await rememberState();
    return report.importEnded || report.wire.filter(token => token === 'c:tree_full').length >= 1 && report.probePresent;
  }, 'IMPORT_WAIT', 15000).catch(() => null);
  await until(async () => {
    await rememberState();
    if (!report.importEnded) return true;
    return report.treeAfterResync || report.states.includes('live');
  }, 'TREE_AFTER_IMPORT', 15000).catch(() => null);
  report.probePresent = await page.evaluate(`(async()=>{ const tree = await chrome.bookmarks.getTree(); const urls = []; const walk = nodes => { for (const node of nodes) { if (node.url) urls.push(node.url); if (node.children) walk(node.children); } }; walk(tree); return urls.includes(${JSON.stringify(probeUrl)}); })()`);
  const actual = await page.evaluate('chrome.bookmarks.getTree()');
  const flatten = (nodes, parentId = null) => nodes.flatMap((node, position) => [{ chromeId: node.id, parentId: node.parentId ?? parentId, position: node.index ?? position, title: node.title, url: node.url ?? null }, ...flatten(node.children ?? [], node.id)]);
  const normalize = nodes => JSON.stringify(nodes.sort((left, right) => left.chromeId.localeCompare(right.chromeId)));
  const cached = (await cache(offer.profileId)).nodes.filter(node => !node.deletedAt).map(item => {
    const node = item.node ?? item;
    return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
  });
  const expected = flatten(actual);
  report.treesMatch = normalize(cached) === normalize(expected);
  report.nodeCount = expected.length;
  report.treeDigest = createHash('sha256').update(normalize(expected)).digest('hex');
  report.pass = report.importEnded && report.resyncAfterImport && report.treeAfterResync && report.treesMatch && report.probePresent;
  note('import_observation', {
    pass: report.pass,
    importEnded: report.importEnded,
    resyncAfterImport: report.resyncAfterImport,
    treeAfterResync: report.treeAfterResync,
    reconcilingAfterImport: report.reconcilingAfterImport,
    treesMatch: report.treesMatch,
    probePresent: report.probePresent,
    treeBeforeRelease: report.treeBeforeRelease,
    oplock: report.oplock,
    launchedFromTempCopy: report.launchedFromTempCopy,
    states: report.states,
    wire: report.wire,
    nodeCount: report.nodeCount,
  });
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'IMPORT_DRIVER_FAILED';
  report.driverCode = typeof error.code === 'string' ? error.code : null;
  report.driverMessage = String(error.message || '').replace(/[A-Za-z]:\\[^\s"']+/g, '<path>').slice(0, 240);
  note('import_driver', { errorCode: report.failureCode, driverCode: report.driverCode, step: report.step, driverMessage: report.driverMessage });
  process.exitCode = 1;
} finally {
  try { await releaseOplock(); } catch { /* already released */ }
  if (backend && report.profileId) {
    try { await backend.call('revoke_pairing', { profileId: report.profileId }); } catch { /* shutdown still runs */ }
  }
  if (backend) {
    try { await backend.call('shutdown'); } catch { /* process exit follows */ }
    backend.child.kill();
  }
  if (chromeChild && chromeChild.exitCode === null) {
    try { await profiles[0].call('Browser.close'); } catch { /* taskkill follows */ }
    try { await exec('taskkill', ['/PID', String(chromeChild.pid), '/T', '/F']); } catch { /* already exited */ }
  }
  if (oplockChild && oplockChild.exitCode === null) oplockChild.kill();
  if (proxyServer) proxyServer.close();
  await deleteNamespaceTargets();
  report.credentialAfter = await cmdkeyCounts();
  const junction = join(launchDir, '155.0.8059.39');
  try { await exec('cmd', ['/c', 'rmdir', junction]); } catch { /* junction already gone */ }
  const junctionGone = await stat(junction).then(() => false, () => true);
  report.installedChromeIntact = await stat(join(installedVersion, 'chrome.dll')).then(() => true, () => false);
  if (junctionGone) await rm(root, { recursive: true, force: true }).catch(() => null);
  else report.cleanupSkipped = true;
  report.finishedAt = new Date().toISOString();
  report.exitCode = process.exitCode ?? 0;
  await writeFile(join(evidence, `import-${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
  note('import_done', { exitCode: report.exitCode, evidence: `import-${suffix}.json`, credentialAfter: report.credentialAfter });
}
