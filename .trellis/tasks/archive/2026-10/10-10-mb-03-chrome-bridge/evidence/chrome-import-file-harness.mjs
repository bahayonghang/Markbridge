// Second import source: quit a paired temp Chrome, replace only that profile's
// Bookmarks JSON with one extra bookmark, then start the same profile again.
// No initial_preferences, no oplock, no Netscape HTML, no bookmark manager.
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, rename, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence');
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dailyProfile = join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data');
const dailyBookmarks = join(dailyProfile, 'Default', 'Bookmarks');
const expectedDailyLength = 849515;
const expectedDailySha = 'DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82';
const probeUrl = 'https://example.invalid/mb03-file-extra';
const probeName = 'mb03-file-extra';
let suffix = randomBytes(3).toString('hex');
if (suffix === 'd27028') suffix = randomBytes(3).toString('hex');
const namespace = `Markbridge.Task03.${suffix}`;
const report = {
  suffix,
  namespace,
  source: 'replaced-bookmarks-json',
  startedAt: new Date().toISOString(),
  command: 'node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-import-file-harness.mjs',
  phase: 'setup',
  wireFirst: [],
  wire: [],
  states: [],
  extensionStatuses: [],
  importBegan: false,
  importEnded: false,
  resyncAfterImport: false,
  treeAfterResync: false,
  reconcilingAfterImport: false,
  backendReconcilingAfterImport: false,
  treesMatch: false,
  probePresentBefore: false,
  probePresent: false,
  chromeEmittedImportEnded: false,
  droppedByBridge: false,
  copiedExecutable: false,
  launchedFromTempCopy: false,
  dailyProfileTouched: false,
  productEdited: false,
  handshakes: 0,
};
const profiles = [];
let backend;
let proxyServer;
let chromeClient;
let firstTree = null;
const root = await mkdtemp(join(tmpdir(), 'markbridge-03-import-file-'));
const userData = join(root, 'user-data');
const appData = join(root, 'app-data');
report.root = root;

function note(code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ code, ...extra })}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function exec(file, args) {
  return new Promise((resolveExec, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
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
  if (!text) return;
  const token = text.kind ? `${direction}:${text.type}:${text.kind}` : `${direction}:${text.type}`;
  const bucket = report.phase === 'second' ? report.wire : report.wireFirst;
  if (bucket.length >= 200) return;
  bucket.push(token);
  if (report.phase !== 'second') return;
  if (token === 'c:event:import_ended') {
    report.importEnded = true;
    report.importEndedAt = new Date().toISOString();
  }
  if (token === 'c:event:import_began') report.importBegan = true;
  if (report.importEnded && token === 'c:resync_required') report.resyncAfterImport = true;
  if (report.importEnded && token === 'c:tree_full') report.treeAfterResync = true;
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
  const fail = (code) => {
    if (!report.proxyError && report.phase !== 'between') report.proxyError = code;
    client.destroy();
    upstream.destroy();
  };
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
      report.handshakes += 1;
      if (report.phase === 'second') report.secondHandshake = true;
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
  client.on('error', () => { if (report.phase !== 'between') fail('PROXY_SOCKET'); });
  upstream.on('error', () => { if (report.phase !== 'between') fail('PROXY_SOCKET'); });
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
async function dailyDigest() {
  const data = await readFile(dailyBookmarks);
  return { length: data.length, sha256: createHash('sha256').update(data).digest('hex').toUpperCase() };
}
function sameDaily(digest) {
  return digest.length === expectedDailyLength && digest.sha256 === expectedDailySha;
}
async function profileFacts() {
  const script = `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains(${psQuote(userData)}) -or $_.CommandLine.Contains(${psQuote(dailyProfile)})) }; foreach ($x in $p) { if ($x.CommandLine.Contains(${psQuote(dailyProfile)})) { 'DAILY' } elseif ($x.CommandLine.Contains(${psQuote(userData)})) { 'TEMP' } }`;
  try { return await exec('powershell.exe', ['-NoProfile', '-Command', script]); }
  catch { return ''; }
}
async function guardTree(pid) {
  const rootPid = Number(pid);
  ensure(Number.isInteger(rootPid) && rootPid > 0, 'PROCESS_PID');
  const script = `$root = ${rootPid}; $all = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $root -or $_.ParentProcessId -eq $root }; $daily = 0; $temp = 0; foreach ($p in $all) { if (-not $p.CommandLine) { continue }; if ($p.CommandLine.Contains(${psQuote(dailyProfile)})) { $daily++ } elseif ($p.CommandLine.Contains(${psQuote(userData)})) { $temp++ } }; "DAILY=$daily"; "TEMP=$temp"`;
  try { return await exec('powershell.exe', ['-NoProfile', '-Command', script]); }
  catch { return ''; }
}
async function tempChromePids() {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains(${psQuote(userData)}) } | Select-Object -ExpandProperty ProcessId`;
  try {
    const stdout = String(await exec('powershell.exe', ['-NoProfile', '-Command', script]));
    return stdout.split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 0);
  } catch { return []; }
}
function launchChrome(onEvent) {
  const child = spawn(chromeExe, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  child.on('error', error => { report.spawnError = error.code || 'SPAWN_ERROR'; });
  if (!child.stdio[3] || !child.stdio[4]) throw new Error('CDP_PIPE_MISSING');
  child.stdio[3].on('error', () => {});
  child.stdio[4].on('error', () => {});
  let next = 0;
  let buffer = '';
  const pending = new Map();
  const client = { child, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject, method });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      child.stdio[3].write(`${JSON.stringify(payload)}\0`);
    });
  } };
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      let message;
      try { message = JSON.parse(buffer.slice(0, end)); }
      catch { buffer = buffer.slice(end + 1); continue; }
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
        else request.resolve(message.result ?? {});
      } else if (message.method && onEvent) onEvent(message, client);
    }
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('CHROME_EXIT')); pending.clear(); });
  profiles.push(client);
  chromeClient = client;
  return client;
}
async function evaluate(client, sessionId, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error('CHROME_EVALUATION_FAILED');
  return response.result?.value;
}
async function openOptions(client) {
  const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
  const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;
  await client.call('Runtime.enable', {}, sessionId);
  const ready = await until(async () => {
    try { return await evaluate(client, sessionId, '!!document.querySelector("#pairing-code")'); }
    catch { return false; }
  }, 'OPTIONS_NOT_READY', 12000).catch(() => null);
  if (!ready) {
    const protocol = await evaluate(client, sessionId, 'location.protocol').catch(() => '');
    report.optionsProtocol = typeof protocol === 'string' ? protocol.slice(0, 32) : '';
    throw new Error('OPTIONS_NOT_READY');
  }
  return { targetId, sessionId, evaluate(expression) { return evaluate(client, sessionId, expression); } };
}
async function cache(profileId) { return backend.call('cache', { profileId }); }
async function rememberState() {
  const state = await backend.call('state');
  const connection = state.profiles.find(profile => profile.profileId === report.profileId)?.connection ?? null;
  if (report.phase === 'second' && report.states.at(-1) !== connection) report.states.push(connection);
  if (report.importEnded && connection === 'reconciling') report.backendReconcilingAfterImport = true;
  return connection;
}
const statusLabels = {
  '未配对': 'unpaired',
  '正在连接本机桌面': 'connecting',
  '等待桌面确认扩展身份': 'pending',
  '正在核对完整书签树': 'reconciling',
  '已连接 · 只读同步': 'connected',
  '连接断开 · 桌面保留只读缓存': 'disconnected',
  '连接错误': 'error',
};
async function rememberExtensionStatus(page) {
  const state = await page.evaluate(`(async () => {
    const labels = ${JSON.stringify(statusLabels)};
    try {
      const value = await chrome.runtime.sendMessage({ type: 'status' });
      if (value && typeof value.state === 'string') return value.state;
    } catch (e) {}
    const text = document.querySelector('#status') ? document.querySelector('#status').textContent : '';
    return Object.prototype.hasOwnProperty.call(labels, text) ? labels[text] : '';
  })()`);
  if (typeof state !== 'string' || !state) return null;
  if (report.extensionStatuses.at(-1) !== state) report.extensionStatuses.push(state);
  if (report.importEnded && state === 'reconciling') report.reconcilingAfterImport = true;
  return state;
}
function flatten(nodes, parentId = null) {
  return nodes.flatMap((node, position) => [{
    chromeId: node.id, parentId: node.parentId ?? parentId, position: node.index ?? position, title: node.title, url: node.url ?? null,
  }, ...flatten(node.children ?? [], node.id)]);
}
function normalize(nodes) { return JSON.stringify([...nodes].sort((left, right) => left.chromeId.localeCompare(right.chromeId))); }
function walkIds(node, ids) {
  const value = Number(node.id);
  if (Number.isSafeInteger(value)) ids.push(value);
  for (const child of node.children ?? []) walkIds(child, ids);
}
function feed(hashes, value, encoding) {
  const bytes = Buffer.from(value, encoding);
  for (const hash of hashes) hash.update(bytes);
}
function computeChecksum(roots, mode) {
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  const hashes = [md5, sha];
  const walk = (node) => {
    feed(hashes, String(node.id), 'utf8');
    if (mode.includes('guid') && node.guid) feed(hashes, String(node.guid), 'utf8');
    feed(hashes, String(node.name ?? ''), mode.includes('utf8title') ? 'utf8' : 'utf16le');
    feed(hashes, String(node.type), 'utf8');
    if (node.type === 'url') feed(hashes, String(node.url ?? ''), 'utf8');
    else for (const child of node.children ?? []) walk(child);
    if (mode.includes('meta') && node.meta_info && typeof node.meta_info === 'object') {
      for (const key of Object.keys(node.meta_info).sort()) {
        feed(hashes, key, 'utf8');
        feed(hashes, String(node.meta_info[key]), 'utf8');
      }
    }
  };
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(roots[key]);
  return { md5: md5.digest('hex'), sha256: sha.digest('hex') };
}
function matchChecksum(value) {
  const modes = ['utf16', 'utf8title', 'utf16-guid', 'utf8title-guid', 'utf16-meta', 'utf16-guid-meta'];
  const stored = typeof value.checksum === 'string' ? value.checksum.toLowerCase() : '';
  for (const mode of modes) {
    const digest = computeChecksum(value.roots, mode);
    if (stored && digest.md5 === stored) return { mode, digest };
  }
  return { mode: stored ? 'unmatched' : 'absent', digest: computeChecksum(value.roots, 'utf16') };
}
function rootNodes(value) {
  return [value.roots.bookmark_bar, value.roots.other, value.roots.synced];
}
const probeExpression = `(() => {
  if (globalThis.__mb03Probe) return globalThis.__mb03Probe;
  const probe = { began: 0, ended: 0 };
  globalThis.__mb03Probe = probe;
  const mark = (key, storageKey) => {
    probe[key] += 1;
    try { chrome.storage.local.set({ [storageKey]: probe[key] }); } catch (e) {}
  };
  chrome.bookmarks.onImportBegan.addListener(() => mark('began', 'mb03ImportBegan'));
  chrome.bookmarks.onImportEnded.addListener(() => mark('ended', 'mb03ImportEnded'));
  return probe;
})()`;
async function installProbe(client, sessionId, waiting) {
  try { await client.call('Runtime.enable', {}, sessionId); } catch { /* evaluate still carries the probe */ }
  const run = () => client.call('Runtime.evaluate', { expression: probeExpression, returnByValue: true }, sessionId);
  if (waiting) {
    const attempt = run().then(result => result.result?.value ?? null).catch(() => null);
    const timed = await Promise.race([attempt, delay(200).then(() => null)]);
    try { await client.call('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch { /* already running */ }
    const value = timed ?? await attempt.catch(() => null);
    if (value) return value;
  }
  const result = await run();
  return result.result?.value ?? null;
}
async function readProbe(client, page) {
  let fromWorker = null;
  if (report.workerSession) {
    try { fromWorker = await evaluate(client, report.workerSession, 'globalThis.__mb03Probe ?? null'); }
    catch { fromWorker = null; }
  }
  let stored = null;
  try {
    stored = await page.evaluate(`chrome.storage.local.get(['mb03ImportBegan', 'mb03ImportEnded'])`);
  } catch { stored = null; }
  const ended = Number(fromWorker?.ended ?? 0);
  const storedEnded = Number(stored?.mb03ImportEnded ?? 0);
  report.probeBegan = Number(fromWorker?.began ?? stored?.mb03ImportBegan ?? 0);
  report.probeEnded = Math.max(ended, storedEnded);
  report.chromeEmittedImportEnded = report.probeEnded > 0;
}
async function quitChrome(client) {
  report.phase = 'between';
  try { await client.call('Browser.close'); } catch { /* force-kill follows only if Chrome stays up */ }
  const gone = await until(async () => (await tempChromePids()).length === 0, 'CHROME_QUIT_TIMEOUT', 20000).catch(() => null);
  if (!gone) {
    for (const pid of await tempChromePids()) {
      try { await exec('taskkill', ['/PID', String(pid), '/T', '/F']); } catch { /* already exited */ }
    }
    await until(async () => (await tempChromePids()).length === 0, 'PROFILE_STILL_RUNNING', 10000);
  }
}
async function findNamed(dir, name, depth, rootReal) {
  if (depth < 0) return [];
  const currentReal = await realpath(dir).catch(() => dir);
  if (!currentReal.toLowerCase().startsWith(rootReal.toLowerCase())) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findNamed(path, name, depth - 1, rootReal));
    else if (entry.name === name) found.push(path);
  }
  return found;
}
async function stableBookmarks() {
  const rootReal = await realpath(userData).catch(() => resolve(userData));
  let previous = null;
  return until(async () => {
    const found = await findNamed(userData, 'Bookmarks', 4, rootReal);
    const path = found.find(item => item.toLowerCase().endsWith(`${join('Default', 'Bookmarks').toLowerCase()}`)) ?? found[0];
    if (!path) return false;
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) return false;
    const same = previous && previous.path === path && previous.size === info.size && previous.mtimeMs === info.mtimeMs;
    previous = { path, size: info.size, mtimeMs: info.mtimeMs };
    return same ? path : false;
  }, 'BOOKMARKS_MISSING', 15000);
}
function toChromeTime(unixMillis) {
  const millis = Number.isFinite(unixMillis) ? Math.trunc(unixMillis) : Date.now();
  return (BigInt(millis) * 1000n + 11644473600000000n).toString();
}
function permanentFolder(id, name, date, children = []) {
  return {
    children,
    date_added: date,
    date_last_used: '0',
    date_modified: date,
    guid: randomUUID(),
    id: String(id),
    name,
    type: 'folder',
  };
}
function extraBookmark(id, date) {
  return {
    date_added: date,
    date_last_used: '0',
    guid: randomUUID(),
    id: String(id),
    name: probeName,
    type: 'url',
    url: probeUrl,
  };
}
function buildMissingBookmarks(tree) {
  const roots = Array.isArray(tree) ? tree : [];
  const top = roots.length === 1 && Array.isArray(roots[0].children) ? roots[0].children : roots;
  const byType = {};
  for (const node of top) if (node && node.folderType) byType[node.folderType] = node;
  const bar = byType['bookmarks-bar'] ?? top[0] ?? { id: '1', title: 'Bookmarks bar' };
  const other = byType.other ?? top[1] ?? { id: '2', title: 'Other bookmarks' };
  const mobile = byType.mobile ?? byType.synced ?? { id: '3', title: 'Mobile bookmarks' };
  const date = toChromeTime(bar.dateAdded);
  const nextId = Math.max(Number(bar.id) || 0, Number(other.id) || 0, Number(mobile.id) || 0, 3) + 1;
  const document = {
    checksum: '',
    roots: {
      bookmark_bar: permanentFolder(bar.id ?? '1', String(bar.title || 'Bookmarks bar'), date, [extraBookmark(nextId, date)]),
      other: permanentFolder(other.id ?? '2', String(other.title || 'Other bookmarks'), toChromeTime(other.dateAdded)),
      synced: permanentFolder(mobile.id ?? '3', String(mobile.title || 'Mobile bookmarks'), toChromeTime(mobile.dateAdded)),
    },
    version: 1,
  };
  document.checksum = computeChecksum(document.roots, 'utf16').md5;
  report.checksumAlgorithm = 'utf16';
  return document;
}
async function replaceBookmarks() {
  const path = join(userData, 'Default', 'Bookmarks');
  const resolved = resolve(path);
  const tempRoot = await realpath(userData).catch(() => resolve(userData));
  ensure(resolved.toLowerCase().startsWith(resolve(userData).toLowerCase()), 'BOOKMARKS_PATH');
  ensure(tempRoot.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'BOOKMARKS_PATH');
  ensure(!resolved.toLowerCase().includes(join('Google', 'Chrome', 'User Data').toLowerCase()), 'BOOKMARKS_PATH');
  const bak = join(userData, 'Default', 'Bookmarks.bak');
  const bakBefore = await stat(bak).catch(() => null);
  const existed = await stat(path).then(info => info.isFile(), () => false);
  report.bookmarksFileExisted = existed;
  let original;
  if (existed) {
    const stable = await stableBookmarks();
    original = JSON.parse(await readFile(stable, 'utf8'));
    ensure(original && original.roots && original.roots.bookmark_bar && original.roots.other && original.roots.synced, 'BOOKMARKS_SHAPE');
    ensure(!JSON.stringify(original).includes(probeUrl), 'PROBE_ALREADY_IN_FILE');
    report.tempBookmarksBefore = (await stat(stable)).size;
    const matched = matchChecksum(original);
    report.checksumAlgorithm = matched.mode;
    const ids = [];
    for (const node of rootNodes(original)) walkIds(node, ids);
    const bar = original.roots.bookmark_bar;
    if (!Array.isArray(bar.children)) bar.children = [];
    bar.children.push(extraBookmark(Math.max(0, ...ids) + 1, String(bar.date_added ?? '0')));
    const mode = matched.mode === 'unmatched' || matched.mode === 'absent' ? 'utf16' : matched.mode;
    const digest = computeChecksum(original.roots, mode);
    original.checksum = digest.md5;
    if (typeof original.checksum_sha256 === 'string') original.checksum_sha256 = digest.sha256;
  } else {
    report.tempBookmarksBefore = 0;
    original = buildMissingBookmarks(firstTree);
  }
  const encoded = `${JSON.stringify(original)}\n`;
  const staging = join(userData, 'Default', 'mb03-bookmarks-next.json');
  await writeFile(staging, encoded);
  await rename(staging, path);
  const written = await readFile(path, 'utf8');
  ensure(written.includes(probeUrl) && !written.includes(dailyProfile), 'BOOKMARKS_WRITE');
  report.tempBookmarksAfter = Buffer.byteLength(written);
  report.extraNodeAdded = true;
  report.fileContainsProbe = true;
  const bakAfter = await stat(bak).catch(() => null);
  report.bookmarksBakUnchanged = (bakBefore?.size ?? null) === (bakAfter?.size ?? null)
    && (bakBefore?.mtimeMs ?? null) === (bakAfter?.mtimeMs ?? null);
}
function readDeveloperMode(text) {
  try { return JSON.parse(text)?.extensions?.ui?.developer_mode === true; }
  catch { return false; }
}
async function enableDeveloperMode(text) {
  const path = join(userData, 'Default', 'Preferences');
  const value = text ? JSON.parse(text) : {};
  value.extensions = value.extensions && typeof value.extensions === 'object' ? value.extensions : {};
  value.extensions.ui = value.extensions.ui && typeof value.extensions.ui === 'object' ? value.extensions.ui : {};
  value.extensions.ui.developer_mode = true;
  await writeFile(path, JSON.stringify(value));
  report.developerModeSet = true;
}
function extensionRecord(text) {
  try {
    const settings = JSON.parse(text)?.extensions?.settings?.[report.extensionId];
    if (!settings || typeof settings !== 'object') return null;
    return {
      location: typeof settings.location === 'number' ? settings.location : null,
      state: typeof settings.state === 'number' ? settings.state : null,
      disableReasons: Array.isArray(settings.disable_reasons) ? settings.disable_reasons.filter(item => typeof item === 'number').slice(0, 4) : [],
    };
  } catch { return null; }
}
async function extensionListed(client) {
  const listed = await client.call('Target.getTargets');
  return (listed.targetInfos ?? []).some(info => String(info.url ?? '').includes(report.extensionId));
}
function urlsIn(tree) {
  const urls = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.url) urls.push(node.url);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return urls;
}

function mark(step) { report.step = step; note('step', { step }); }
function guardCounts(text) {
  return {
    daily: Number(String(text).match(/DAILY=(\d+)/)?.[1] ?? 0),
    temp: Number(String(text).match(/TEMP=(\d+)/)?.[1] ?? 0),
  };
}
try {
  ensure(userData.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'PATH_GUARD');
  ensure(!userData.toLowerCase().startsWith(dailyProfile.toLowerCase()), 'PATH_GUARD');
  mark('credentials');
  report.credentialBefore = await cmdkeyCounts();
  mark('daily');
  report.dailyBefore = await dailyDigest();
  ensure(sameDaily(report.dailyBefore), 'DAILY_GUARD');
  mark('bridge');
  await mkdir(appData, { recursive: true });
  await mkdir(userData, { recursive: true });
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [appData, namespace]);
  const bridgePort = await reservePort();
  const proxyPort = await startProxy(bridgePort);
  ensure(proxyPort !== bridgePort, 'PROXY_PORT');
  report.portsDiffer = true;
  await backend.call('start_bridge', { port: bridgePort });
  mark('chrome');
  const client = launchChrome();
  const facts = await until(async () => {
    const counts = guardCounts(await guardTree(client.child.pid));
    return counts.temp > 0 || counts.daily > 0 ? counts : null;
  }, 'PROCESS_FACT_TIMEOUT', 20000).catch(() => null);
  if (!facts || facts.daily > 0 || facts.temp < 1) {
    report.dailyProfileTouched = Boolean(facts && facts.daily > 0);
    throw new Error(facts && facts.daily > 0 ? 'DAILY_PROFILE_GUARD' : 'USER_DATA_GUARD');
  }
  client.version = (await until(() => client.call('Browser.getVersion').then(value => value.product).catch(() => null), 'CDP_TIMEOUT', 15000));
  report.chrome = client.version;
  const loaded = await client.call('Extensions.loadUnpacked', { path: resolve('apps/extension/dist') });
  client.extensionId = loaded.id;
  report.extensionId = loaded.id;
  const page = await openOptions(client);
  const offer = await backend.call('begin_pairing', { displayName: 'File probe' });
  const code = rewritePort(offer.pairingCode, proxyPort, bridgePort);
  report.pairingCodeLength = code.length;
  report.profileId = offer.profileId;
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(code)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING', 30000);
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  await until(async () => (await rememberState()) === 'live', 'PROFILE_NOT_LIVE', 30000);
  await until(async () => report.wireFirst.includes('c:tree_full'), 'FIRST_TREE_TIMEOUT', 20000);
  const beforeTree = await page.evaluate('chrome.bookmarks.getTree()');
  firstTree = beforeTree;
  report.probePresentBefore = urlsIn(beforeTree).includes(probeUrl);
  ensure(!report.probePresentBefore, 'PROBE_PRESENT_BEFORE');
  report.nodesBefore = flatten(beforeTree).length;
  const observed = (await cache(offer.profileId)).nodes.filter(node => !node.deletedAt).map(item => {
    const node = item.node ?? item;
    return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
  });
  report.firstTreeMatched = normalize(observed) === normalize(flatten(beforeTree));
  ensure(report.firstTreeMatched, 'FIRST_TREE');
  mark('quit');
  await quitChrome(client);
  const preferences = await readFile(join(userData, 'Default', 'Preferences'), 'utf8').catch(() => '');
  const secure = await readFile(join(userData, 'Default', 'Secure Preferences'), 'utf8').catch(() => '');
  report.extensionPersisted = preferences.includes(report.extensionId) || secure.includes(report.extensionId);
  report.extensionRecord = extensionRecord(preferences) ?? extensionRecord(secure);
  report.developerMode = readDeveloperMode(preferences) || readDeveloperMode(secure);
  if (!report.developerMode) {
    try { await enableDeveloperMode(preferences); }
    catch { report.developerModeSet = false; }
  }
  mark('replace');
  await replaceBookmarks();
  mark('second');
  report.phase = 'second';
  const sessions = new Map();
  const second = launchChrome((message, client) => {
    if (message.method !== 'Target.attachedToTarget') return;
    const params = message.params ?? {};
    const sessionId = params.sessionId;
    const info = params.targetInfo ?? {};
    if (!sessionId) return;
    sessions.set(sessionId, info);
    const waiting = params.waitingForDebugger === true;
    const isWorker = info.type === 'service_worker' && String(info.url ?? '').includes(report.extensionId);
    void (async () => {
      if (isWorker) {
        report.workerSession = sessionId;
        try {
          const installed = await installProbe(client, sessionId, waiting);
          if (installed) {
            report.probeInstalled = true;
            report.probeInstallPhase = waiting ? 'paused' : 'running';
          }
        } catch { report.probeInstallError = 'PROBE_INSTALL_FAILED'; }
        return;
      }
      if (waiting) {
        try { await client.call('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch { /* already running */ }
      }
    })();
  });
  second.extensionId = report.extensionId;
  const discover = second.call('Target.setDiscoverTargets', { discover: true });
  const autoAttach = second.call('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: 'service_worker', exclude: false }],
  });
  second.version = await until(() => second.call('Browser.getVersion').then(value => value.product).catch(() => null), 'SECOND_CDP_TIMEOUT', 20000);
  await discover.catch(() => { throw new Error('SECOND_DISCOVER'); });
  try {
    await autoAttach;
    report.autoAttachFilter = true;
  } catch {
    await second.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    report.autoAttachFilter = false;
  }
  report.chromeSecond = second.version;
  const secondCounts = guardCounts(await guardTree(second.child.pid));
  if (secondCounts.daily > 0 || secondCounts.temp < 1) {
    report.dailyProfileTouched = secondCounts.daily > 0;
    throw new Error(secondCounts.daily > 0 ? 'DAILY_PROFILE_GUARD' : 'USER_DATA_GUARD');
  }
  report.extensionTargetSeen = await until(() => extensionListed(second).catch(() => false), 'EXTENSION_NOT_PRESENT', 3000).catch(() => false);
  let secondPage = null;
  try { secondPage = await openOptions(second); }
  catch (error) {
    secondPage = null;
    report.optionsError = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'OPTIONS_FAILED';
  }
  if (!secondPage) {
    report.startupWire = report.wire.slice();
    try {
      const loaded = await second.call('Extensions.loadUnpacked', { path: resolve('apps/extension/dist') });
      report.lateLoadUnpacked = loaded.id === report.extensionId;
      second.extensionId = loaded.id || report.extensionId;
      secondPage = await openOptions(second);
    } catch (error) {
      report.lateLoadError = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LATE_LOAD_FAILED';
    }
  }
  report.extensionPresent = Boolean(secondPage) || report.extensionTargetSeen === true;
  report.optionsOpened = Boolean(secondPage);
  await until(async () => {
    if (secondPage) {
      try { await rememberExtensionStatus(secondPage); } catch { /* status poll continues */ }
    }
    try { await rememberState(); } catch { /* backend poll continues */ }
    return report.importEnded && report.reconcilingAfterImport && report.treeAfterResync;
  }, 'IMPORT_WAIT', 20000).catch(() => null);
  if (secondPage) {
    try { await readProbe(second, secondPage); } catch { report.probeReadError = 'PROBE_READ_FAILED'; }
    const actual = await secondPage.evaluate('chrome.bookmarks.getTree()');
    const expected = flatten(actual);
    const cached = (await cache(report.profileId)).nodes.filter(node => !node.deletedAt).map(item => {
      const node = item.node ?? item;
      return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
    });
    report.treesMatch = normalize(cached) === normalize(expected);
    report.probePresent = urlsIn(actual).includes(probeUrl) && cached.some(node => node.url === probeUrl);
    report.nodeCount = expected.length;
    report.treeDigest = createHash('sha256').update(normalize(expected)).digest('hex');
  }
  const importAt = report.wire.indexOf('c:event:import_ended');
  report.treeAfterResync = importAt >= 0 && report.wire.some((token, index) => index > importAt && token === 'c:tree_full');
  report.resyncAfterImport = importAt >= 0 && report.wire.some((token, index) => index > importAt && token === 'c:resync_required');
  report.droppedByBridge = report.chromeEmittedImportEnded && !report.importEnded;
  report.pass = Boolean(report.importEnded && report.reconcilingAfterImport && report.treeAfterResync && report.treesMatch && report.probePresent);
  if (!report.pass) process.exitCode = 1;
  note('import_observation', {
    pass: report.pass,
    importEnded: report.importEnded,
    chromeEmittedImportEnded: report.chromeEmittedImportEnded,
    droppedByBridge: report.droppedByBridge,
    reconcilingAfterImport: report.reconcilingAfterImport,
    treeAfterResync: report.treeAfterResync,
    treesMatch: report.treesMatch,
    probePresent: report.probePresent,
    extensionPresent: report.extensionPresent,
    checksumAlgorithm: report.checksumAlgorithm,
    states: report.states,
    extensionStatuses: report.extensionStatuses,
    wire: report.wire,
  });
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'IMPORT_DRIVER_FAILED';
  report.driverCode = typeof error.code === 'string' ? error.code : null;
  report.driverMessage = String(error.message || '').replace(/[A-Za-z]:\\[^\s"']+/g, '<path>').slice(0, 240);
  if (report.failureCode === 'BOOKMARKS_MISSING') {
    const entries = await readdir(join(userData, 'Default')).catch(() => null);
    report.defaultExists = Boolean(entries);
    report.defaultEntryCount = entries ? entries.length : 0;
    report.defaultNames = entries ? entries.filter(name => /bookmark|preference/i.test(name)).slice(0, 12) : [];
    if (!entries) report.userDataNames = (await readdir(userData).catch(() => [])).slice(0, 30);
  }
  note('import_driver', { errorCode: report.failureCode, driverCode: report.driverCode, step: report.step, defaultExists: report.defaultExists ?? null });
  process.exitCode = 1;
} finally {
  report.phase = 'between';
  if (backend && report.profileId) {
    try { await backend.call('revoke_pairing', { profileId: report.profileId }); } catch { /* shutdown still runs */ }
  }
  if (backend) {
    try { await backend.call('shutdown'); } catch { /* process exit follows */ }
    backend.child.kill();
  }
  for (const client of profiles) {
    if (client.child.exitCode === null) {
      try { await client.call('Browser.close'); } catch { /* taskkill follows */ }
      if (client.child.exitCode === null && client.child.pid) {
        try { await exec('taskkill', ['/PID', String(client.child.pid), '/T', '/F']); } catch { /* already exited */ }
      }
    }
  }
  if (proxyServer) proxyServer.close();
  await deleteNamespaceTargets();
  try { report.credentialAfter = await cmdkeyCounts(); }
  catch { report.credentialAfter = null; }
  try {
    report.dailyAfter = await dailyDigest();
    if (!sameDaily(report.dailyAfter)) {
      report.dailyProfileTouched = true;
      process.exitCode = 1;
      report.pass = false;
    }
  } catch {
    report.dailyAfter = null;
    report.dailyProfileTouched = true;
    process.exitCode = 1;
    report.pass = false;
  }
  report.installedChromeIntact = await stat(chromeExe).then(info => info.isFile(), () => false);
  await rm(root, { recursive: true, force: true }).catch(() => { report.cleanupSkipped = true; });
  report.finishedAt = new Date().toISOString();
  report.exitCode = process.exitCode ?? 0;
  const output = join(evidence, `import-file-${suffix}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  note('import_done', { exitCode: report.exitCode, evidence: `import-file-${suffix}.json`, importEnded: report.importEnded, credentialAfter: report.credentialAfter, dailyAfter: report.dailyAfter });
}
