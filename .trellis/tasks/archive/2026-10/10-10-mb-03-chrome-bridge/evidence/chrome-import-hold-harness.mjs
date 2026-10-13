// Bookmarks read hold. One temporary Chrome process.
// A normal Bookmarks JSON is written before launch. Its read is held so the
// bookmark model cannot finish. The first CDP commands are Target.setAutoAttach
// with waitForDebuggerOnStart, then Extensions.loadUnpacked. The shipped
// extension listener must be installed while Bookmarks.Storage.TimeToLoadAtStartup2
// is still 0. The hold is not initial_preferences and not the level-1 first-run hold.
// No second process, no Netscape HTML, no bookmark manager, no chrome://bookmarks.
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, realpath } from 'node:fs/promises';
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
const notedDailyLength = 850304;
const notedDailySha = '09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D';
const probeUrl = 'https://example.invalid/mb03-hold-probe';
const probeName = 'mb03-hold-probe';
let suffix = randomBytes(3).toString('hex');
while (suffix === 'd27028' || suffix === 'e9d63e' || suffix === 'c55f21') suffix = randomBytes(3).toString('hex');
const namespace = `Markbridge.Task03.${suffix}`;
const report = {
  suffix,
  namespace,
  source: 'bookmarks-read-hold',
  startedAt: new Date().toISOString(),
  command: 'node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-import-hold-harness.mjs',
  wire: [],
  states: [],
  extensionStatuses: [],
  cdpOrder: [],
  importBegan: false,
  importEnded: false,
  resyncAfterImport: false,
  treeAfterResync: false,
  reconcilingAfterImport: false,
  treesMatch: false,
  probePresent: false,
  chromeEmittedImportEnded: null,
  droppedByBridge: false,
  copiedExecutable: false,
  launchedFromTempCopy: false,
  chromeLaunchCount: 0,
  loadUnpackedCalls: 0,
  dailyProfileTouched: false,
  productEdited: false,
  initialPreferences: false,
  level1FirstRunHold: false,
  readHold: 'FSCTL_REQUEST_OPLOCK',
  holdKind: 'bookmarks-read',
  holdStatus: null,
  handshakes: 0,
  workerPaused: false,
  shippedListenerAttached: false,
  listenerAttachedBeforeModelFinished: null,
  histogramBeforeResume: null,
  histogramAfterListeners: null,
  probeInstalled: false,
  probeBegan: 0,
  probeEnded: 0,
  pass: false,
};
const profiles = [];
const sessions = new Map();
const queuedEvents = [];
let backend;
let proxyServer;
let chromeClient;
let releaseEvents = false;
let resolveWorker = () => {};
const workerPrepared = new Promise(resolve => { resolveWorker = resolve; });
const root = await mkdtemp(join(tmpdir(), 'markbridge-03-import-hold-'));
const userData = join(root, 'user-data');
const appData = join(root, 'app-data');
const holdStatusPath = join(root, 'hold-status.txt');
const holdReleasePath = join(root, 'hold-release');
report.root = root;
report.output = `evidence/import-hold-${suffix}.json`;
let holdChild = null;

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
function withTimeout(promise, code, timeout = 20000) {
  return Promise.race([
    promise,
    delay(timeout).then(() => { throw new Error(code); }),
  ]);
}
async function until(probe, code, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await probe();
    if (result) return result;
    await delay(40);
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
  if (!text || report.wire.length >= 200) return;
  const token = text.kind ? `${direction}:${text.type}:${text.kind}` : `${direction}:${text.type}`;
  report.wire.push(token);
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
    if (!report.proxyError) report.proxyError = code;
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
async function dailyDigest() {
  const data = await readFile(dailyBookmarks);
  return { length: data.length, sha256: createHash('sha256').update(data).digest('hex').toUpperCase() };
}
function sameDaily(left, right) {
  return Boolean(left && right && left.length === right.length && left.sha256 === right.sha256);
}
async function guardTree(pid) {
  const rootPid = Number(pid);
  ensure(Number.isInteger(rootPid) && rootPid > 0, 'PROCESS_PID');
  const script = `$root = ${rootPid}; $all = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $root -or $_.ParentProcessId -eq $root }; $daily = 0; $temp = 0; foreach ($p in $all) { if (-not $p.CommandLine) { continue }; if ($p.CommandLine.Contains(${psQuote(dailyProfile)})) { $daily++ } elseif ($p.CommandLine.Contains(${psQuote(userData)})) { $temp++ } }; "DAILY=$daily"; "TEMP=$temp"`;
  try { return await exec('powershell.exe', ['-NoProfile', '-Command', script]); }
  catch { return ''; }
}
function guardCounts(text) {
  return {
    daily: Number(String(text).match(/DAILY=(\d+)/)?.[1] ?? 0),
    temp: Number(String(text).match(/TEMP=(\d+)/)?.[1] ?? 0),
  };
}
function launchChrome() {
  report.chromeLaunchCount += 1;
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
    if (report.cdpOrder.length < 12) report.cdpOrder.push(method);
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
        if (message.error) {
          const text = String(message.error.message || message.error.code || 'FAILED').replace(/[A-Za-z]:\\[^\s"']+/g, '<path>').slice(0, 160);
          report.lastCdpError = `${request.method}:${text}`;
          request.reject(new Error(`CDP_${request.method}_FAILED`));
        } else request.resolve(message.result ?? {});
      } else if (message.method) {
        if (!releaseEvents) queuedEvents.push(message);
        else handleEvent(client, message);
      }
    }
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('CHROME_EXIT')); pending.clear(); });
  profiles.push(client);
  chromeClient = client;
  return client;
}
function isShippedWorker(info) {
  const url = String(info.url || '');
  return info.type === 'service_worker' && url.includes('/worker.js') && (!report.extensionId || url.includes(report.extensionId));
}
function handleEvent(client, message) {
  if (message.method !== 'Target.attachedToTarget') return;
  const params = message.params ?? {};
  const sessionId = params.sessionId;
  const info = params.targetInfo ?? {};
  if (!sessionId) return;
  sessions.set(info.targetId || sessionId, { sessionId, info, waiting: params.waitingForDebugger === true });
  if (isShippedWorker(info) && !report.workerSession) {
    report.workerSession = sessionId;
    report.workerPaused = params.waitingForDebugger === true;
    void prepareWorker(client, sessionId, params.waitingForDebugger === true);
    return;
  }
  if (params.waitingForDebugger === true) {
    void client.call('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
}
async function histogramCount(client) {
  try {
    const result = await client.call('Browser.getHistograms', { query: 'Bookmarks.Storage.TimeToLoad', delta: false });
    const rows = Array.isArray(result.histograms) ? result.histograms : [];
    report.bookmarkLoadHistograms = rows.slice(0, 6).map(item => ({ name: String(item.name || ''), count: Number(item.count) || 0 }));
    if (!rows.length) return 0;
    return Math.max(...rows.map(item => Number(item.count) || 0));
  } catch {
    report.histogramError = report.lastCdpError || 'HISTOGRAM_FAILED';
    return null;
  }
}
async function evaluate(client, sessionId, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error('CHROME_EVALUATION_FAILED');
  return response.result?.value;
}
async function prepareWorker(client, sessionId, waiting) {
  try {
    if (waiting) {
      report.histogramBeforeResume = await histogramCount(client);
      await client.call('Runtime.runIfWaitingForDebugger', {}, sessionId);
    }
    try { await client.call('Runtime.enable', {}, sessionId); } catch { /* evaluate still runs */ }
    const has = await until(async () => {
      try { return await evaluate(client, sessionId, 'chrome.bookmarks.onImportEnded.hasListeners()') === true; }
      catch { return false; }
    }, 'LISTENER_NOT_ATTACHED', 8000).catch(() => false);
    report.shippedListenerAttached = has === true;
    if (has === true) report.histogramAtListener = await histogramCount(client);
    else report.histogramAtListener = null;
    report.histogramAfterListeners = report.histogramAtListener;
    if (has === true && report.histogramAtListener === 0) report.listenerAttachedBeforeModelFinished = true;
    else if (has === true && typeof report.histogramAtListener === 'number' && report.histogramAtListener > 0) report.listenerAttachedBeforeModelFinished = false;
    else report.listenerAttachedBeforeModelFinished = null;
    if (report.listenerAttachedBeforeModelFinished === true) {
      const installed = await evaluate(client, sessionId, `(() => {
        if (globalThis.__mb03Hold) return globalThis.__mb03Hold;
        const probe = { began: 0, ended: 0 };
        globalThis.__mb03Hold = probe;
        chrome.bookmarks.onImportBegan.addListener(() => { probe.began += 1; });
        chrome.bookmarks.onImportEnded.addListener(() => { probe.ended += 1; });
        return probe;
      })()`).catch(() => null);
      report.probeInstalled = Boolean(installed);
    }
  } catch (error) {
    report.workerError = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'WORKER_FAILED';
  } finally {
    resolveWorker();
  }
}
async function openOptions(client) {
  const url = `chrome-extension://${client.extensionId}/options.html`;
  const created = await client.call('Target.createTarget', { url });
  let sessionId = await until(() => {
    const known = sessions.get(created.targetId);
    if (known) return known.sessionId;
    for (const value of sessions.values()) if (value.info.url === url) return value.sessionId;
    return null;
  }, 'OPTIONS_TARGET', 8000).catch(() => null);
  if (!sessionId) {
    const attached = await client.call('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    sessionId = attached.sessionId;
    await client.call('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
  await client.call('Runtime.enable', {}, sessionId);
  const ready = await until(async () => {
    try { return await evaluate(client, sessionId, '!!document.querySelector("#pairing-code")'); }
    catch { return false; }
  }, 'OPTIONS_NOT_READY', 12000).catch(() => null);
  if (!ready) throw new Error('OPTIONS_NOT_READY');
  return { sessionId, evaluate(expression) { return evaluate(client, sessionId, expression); } };
}
async function cache(profileId) { return backend.call('cache', { profileId }); }
async function rememberState() {
  const state = await backend.call('state');
  const connection = state.profiles.find(profile => profile.profileId === report.profileId)?.connection ?? null;
  if (report.states.at(-1) !== connection) report.states.push(connection);
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
function feed(hash, value, encoding) { hash.update(Buffer.from(value, encoding)); }
function checksum(roots) {
  const md5 = createHash('md5');
  const walk = (node) => {
    feed(md5, String(node.id), 'utf8');
    feed(md5, String(node.name ?? ''), 'utf16le');
    feed(md5, String(node.type), 'utf8');
    if (node.type === 'url') feed(md5, String(node.url ?? ''), 'utf8');
    else for (const child of node.children ?? []) walk(child);
  };
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(roots[key]);
  return md5.digest('hex');
}
function toChromeTime(unixMillis) {
  return (BigInt(unixMillis) * 1000n + 11644473600000000n).toString();
}
function folder(id, name, date, children = []) {
  return { children, date_added: date, date_last_used: '0', date_modified: date, guid: randomUUID(), id: String(id), name, type: 'folder' };
}
function seedDocument() {
  const date = toChromeTime(Date.now());
  const roots = {
    bookmark_bar: folder(1, 'Bookmarks bar', date, [{
      date_added: date, date_last_used: '0', guid: randomUUID(), id: '4', name: probeName, type: 'url', url: probeUrl,
    }]),
    other: folder(2, 'Other bookmarks', date),
    synced: folder(3, 'Mobile bookmarks', date),
  };
  return { checksum: checksum(roots), roots, version: 1 };
}
function countNodes(node) {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}
function holdScript() {
  return `
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public class BookmarksReadHold {
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
  const uint FSCTL_REQUEST_OPLOCK = 0x00090240;
  [StructLayout(LayoutKind.Sequential)]
  struct INBUF { public ushort Version; public ushort Length; public uint Level; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)]
  struct OUTBUF { public ushort Version; public ushort Length; public uint Original; public uint NewLevel; public uint Flags; public uint Access; public ushort Share; }
  [StructLayout(LayoutKind.Sequential)]
  struct OVERLAPPED { public IntPtr Internal; public IntPtr InternalHigh; public uint Offset; public uint OffsetHigh; public IntPtr hEvent; }
  public static void Hold(string path, string statusPath, string releasePath) {
    IntPtr handle = CreateFileW(path, GENERIC_READ, 0, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero);
    if (handle == new IntPtr(-1)) { File.WriteAllText(statusPath, "OPEN_FAIL " + GetLastError()); return; }
    INBUF input = new INBUF();
    input.Version = 1;
    input.Length = (ushort)Marshal.SizeOf(typeof(INBUF));
    input.Level = 1 | 2 | 4;
    input.Flags = 1 | 4;
    IntPtr inMem = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(INBUF)));
    Marshal.StructureToPtr(input, inMem, false);
    int outSize = Marshal.SizeOf(typeof(OUTBUF));
    IntPtr outMem = Marshal.AllocHGlobal(outSize);
    IntPtr ev = CreateEventW(IntPtr.Zero, true, false, null);
    OVERLAPPED ov = new OVERLAPPED();
    ov.hEvent = ev;
    IntPtr ovMem = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(OVERLAPPED)));
    Marshal.StructureToPtr(ov, ovMem, false);
    uint returned;
    bool ok = DeviceIoControl(handle, FSCTL_REQUEST_OPLOCK, inMem, (uint)Marshal.SizeOf(typeof(INBUF)), outMem, (uint)outSize, out returned, ovMem);
    uint err = GetLastError();
    if (ok || err != 997) { CloseHandle(handle); File.WriteAllText(statusPath, "OPLOCK_FAIL " + err); return; }
    File.WriteAllText(statusPath, "HELD");
    while (!File.Exists(releasePath)) Thread.Sleep(30);
    CloseHandle(handle);
    File.WriteAllText(statusPath, "RELEASED");
  }
}
"@
[BookmarksReadHold]::Hold($args[0], $args[1], $args[2])
`;
}
async function readHold() {
  try { return (await readFile(holdStatusPath, 'utf8')).trim(); }
  catch { return ''; }
}
async function startHold(bookmarksPath) {
  const scriptPath = join(root, 'hold-read.ps1');
  await writeFile(scriptPath, holdScript());
  holdChild = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, bookmarksPath, holdStatusPath, holdReleasePath], { windowsHide: true, stdio: 'ignore' });
  await until(async () => {
    const status = await readHold();
    return status === 'HELD' || status.startsWith('OPEN_FAIL') || status.startsWith('OPLOCK_FAIL');
  }, 'HOLD_TIMEOUT', 15000);
  report.holdStatus = await readHold();
  ensure(report.holdStatus === 'HELD', 'HOLD_FAILED');
}
async function releaseHold() {
  if (report.holdReleased || !holdChild) return;
  await writeFile(holdReleasePath, 'release');
  await until(async () => {
    const status = await readHold();
    return status === 'RELEASED' || status.startsWith('OPEN_FAIL') || status.startsWith('OPLOCK_FAIL');
  }, 'HOLD_RELEASE_TIMEOUT', 8000).catch(() => null);
  report.holdStatus = await readHold();
  report.holdReleased = report.holdStatus === 'RELEASED';
}
async function assertDailyUnchanged() {
  const digest = await dailyDigest();
  if (!sameDaily(report.dailyBefore, digest)) {
    report.dailyAfter = digest;
    report.dailyChangedDuringRun = true;
    throw new Error('DAILY_CHANGED');
  }
}

try {
  ensure(namespace.startsWith('Markbridge.Task03.'), 'NAMESPACE');
  ensure(userData.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'PATH_GUARD');
  ensure(!userData.toLowerCase().includes(join('Google', 'Chrome', 'User Data').toLowerCase()), 'PATH_GUARD');
  report.credentialBefore = await cmdkeyCounts();
  ensure(report.credentialBefore.pairing === 0, 'PAIRING_NAMESPACE');
  report.notedDaily = { length: notedDailyLength, sha256: notedDailySha };
  report.dailyBefore = await dailyDigest();
  report.dailyMatchesNoted = sameDaily(report.dailyBefore, report.notedDaily);
  await mkdir(join(userData, 'Default'), { recursive: true });
  await mkdir(appData, { recursive: true });
  const seeded = seedDocument();
  report.seedNodeCount = countNodes(seeded.roots.bookmark_bar) + countNodes(seeded.roots.other) + countNodes(seeded.roots.synced);
  ensure(report.seedNodeCount < 1000, 'SEED_TOO_LARGE');
  const encoded = `${JSON.stringify(seeded)}\n`;
  const bookmarksPath = join(userData, 'Default', 'Bookmarks');
  await writeFile(bookmarksPath, encoded);
  const written = await readFile(bookmarksPath, 'utf8');
  ensure(written.includes(probeUrl) && !written.includes(dailyProfile), 'BOOKMARKS_WRITE');
  report.seedBytes = Buffer.byteLength(written);
  report.seedWrittenBeforeLaunch = true;
  const preferences = await stat(join(userData, 'initial_preferences')).then(info => info.isFile(), () => false);
  ensure(!preferences, 'INITIAL_PREFERENCES');
  ensure(!written.includes('mb03-live-probe'), 'LIVE_PROBE_TEXT');
  await startHold(bookmarksPath);
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [appData, namespace]);
  const bridgePort = await reservePort();
  const proxyPort = await startProxy(bridgePort);
  ensure(proxyPort !== bridgePort, 'PROXY_PORT');
  report.portsDiffer = true;
  await backend.call('start_bridge', { port: bridgePort });
  const client = launchChrome();
  ensure(report.chromeLaunchCount === 1, 'CHROME_LAUNCH_COUNT');
  const factsPromise = until(async () => {
    const counts = guardCounts(await guardTree(client.child.pid));
    return counts.temp > 0 || counts.daily > 0 ? counts : null;
  }, 'PROCESS_FACT_TIMEOUT', 20000).catch(() => null);
  await withTimeout(client.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }), 'CDP_TIMEOUT', 20000);
  releaseEvents = true;
  const loadPromise = withTimeout(client.call('Extensions.loadUnpacked', { path: resolve('apps/extension/dist') }), 'LOAD_UNPACKED_TIMEOUT', 20000);
  report.loadUnpackedCalls += 1;
  for (const message of queuedEvents.splice(0)) handleEvent(client, message);
  const loaded = await loadPromise;
  client.extensionId = loaded.id;
  report.extensionId = loaded.id;
  ensure(report.cdpOrder[0] === 'Target.setAutoAttach' && report.cdpOrder[1] === 'Extensions.loadUnpacked', 'CDP_ORDER');
  ensure(report.loadUnpackedCalls === 1, 'LOAD_UNPACKED_COUNT');
  const facts = await factsPromise;
  if (!facts || facts.daily > 0 || facts.temp < 1) {
    report.dailyProfileTouched = Boolean(facts && facts.daily > 0);
    throw new Error(facts && facts.daily > 0 ? 'DAILY_PROFILE_GUARD' : 'USER_DATA_GUARD');
  }
  await assertDailyUnchanged();
  client.version = (await withTimeout(client.call('Browser.getVersion'), 'CDP_TIMEOUT', 15000)).product;
  report.chrome = client.version;
  await Promise.race([workerPrepared, delay(12000)]);
  if (!report.workerSession) {
    const listed = await client.call('Target.getTargets');
    const worker = (listed.targetInfos ?? []).find(info => isShippedWorker(info));
    report.workerListedLate = Boolean(worker);
    if (worker && !sessions.has(worker.targetId)) {
      const attached = await client.call('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
      report.workerSession = attached.sessionId;
      report.workerPaused = false;
      await prepareWorker(client, attached.sessionId, false);
    }
  }
  if (report.listenerAttachedBeforeModelFinished !== true) {
    throw new Error(report.listenerAttachedBeforeModelFinished === false ? 'HISTOGRAM_ALREADY_LOADED' : 'LISTENER_NOT_READY');
  }
  await releaseHold();
  ensure(report.holdReleased === true, 'HOLD_RELEASE_FAILED');
  await delay(1500);
  if (report.workerSession && report.probeInstalled) {
    const early = await evaluate(client, report.workerSession, 'globalThis.__mb03Hold ?? null').catch(() => null);
    report.probeAfterRelease = { began: Number(early?.began) || 0, ended: Number(early?.ended) || 0 };
  }
  const page = await openOptions(client);
  const offer = await backend.call('begin_pairing', { displayName: 'Hold import' });
  const code = rewritePort(offer.pairingCode, proxyPort, bridgePort);
  report.pairingCodeLength = code.length;
  report.profileId = offer.profileId;
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(code)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING', 30000);
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  await until(async () => (await rememberState()) === 'live', 'PROFILE_NOT_LIVE', 30000);
  ensure(await page.evaluate(`document.querySelector('#pairing-code').value === ''`), 'PAIR_CODE_NOT_CLEARED');
  await until(async () => {
    try { await rememberExtensionStatus(page); } catch { /* status poll continues */ }
    try { await rememberState(); } catch { /* backend poll continues */ }
    return report.importEnded && report.extensionStatuses.includes('reconciling') && report.treeAfterResync;
  }, 'IMPORT_WAIT', 20000).catch(() => null);
  if (report.workerSession && report.probeInstalled) {
    const probe = await evaluate(client, report.workerSession, 'globalThis.__mb03Hold ?? null').catch(() => null);
    report.probeBegan = Number(probe?.began) || 0;
    report.probeEnded = Number(probe?.ended) || 0;
    report.chromeEmittedImportEnded = report.probeEnded > 0;
  }
  report.droppedByBridge = report.chromeEmittedImportEnded === true && !report.importEnded;
  const actual = await page.evaluate('chrome.bookmarks.getTree()');
  const expected = flatten(actual);
  const cached = (await cache(report.profileId)).nodes.filter(node => !node.deletedAt).map(item => {
    const node = item.node ?? item;
    return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
  });
  report.treesMatch = normalize(cached) === normalize(expected);
  report.probePresent = urlsIn(actual).includes(probeUrl) && cached.some(node => node.url === probeUrl);
  report.nodeCount = expected.length;
  report.reconcilingReached = report.extensionStatuses.includes('reconciling');
  report.pass = report.listenerAttachedBeforeModelFinished === true && report.importEnded && report.reconcilingReached && report.treeAfterResync && report.treesMatch && report.probePresent;
  if (!report.pass) process.exitCode = 1;
  note('import_observation', {
    pass: report.pass,
    importEnded: report.importEnded,
    chromeEmittedImportEnded: report.chromeEmittedImportEnded,
    droppedByBridge: report.droppedByBridge,
    listenerAttachedBeforeModelFinished: report.listenerAttachedBeforeModelFinished,
    workerPaused: report.workerPaused,
    reconcilingReached: report.reconcilingReached,
    treeAfterResync: report.treeAfterResync,
    treesMatch: report.treesMatch,
    probePresent: report.probePresent,
    wire: report.wire,
  });
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'IMPORT_DRIVER_FAILED';
  report.driverMessage = String(error.message || '').replace(/[A-Za-z]:\\[^\s"']+/g, '<path>').slice(0, 240);
  note('import_driver', { errorCode: report.failureCode });
  process.exitCode = 1;
} finally {
  try { await releaseHold(); } catch { /* shutdown still runs */ }
  if (holdChild && holdChild.exitCode === null) holdChild.kill();
  if (backend && report.profileId) {
    try { await backend.call('revoke_pairing', { profileId: report.profileId }); } catch { /* shutdown still runs */ }
  }
  if (backend) {
    try { await backend.call('shutdown'); } catch { /* process exit follows */ }
    backend.child.kill();
  }
  for (const client of profiles) {
    if (client.child.exitCode === null) {
      try { await withTimeout(client.call('Browser.close'), 'BROWSER_CLOSE_TIMEOUT', 5000); } catch { /* taskkill follows */ }
      if (client.child.exitCode === null && client.child.pid) {
        try { await exec('taskkill', ['/PID', String(client.child.pid), '/T', '/F']); } catch { /* already exited */ }
      }
    }
  }
  if (proxyServer) proxyServer.close();
  try { await deleteNamespaceTargets(); } catch { /* credential count still runs */ }
  try { report.credentialAfter = await cmdkeyCounts(); }
  catch { report.credentialAfter = null; }
  try {
    report.dailyAfter = await dailyDigest();
    if (report.dailyBefore) {
      report.dailyStable = sameDaily(report.dailyBefore, report.dailyAfter);
      report.dailyMatchesNoted = sameDaily(report.dailyAfter, report.notedDaily);
      if (!report.dailyStable) {
        report.dailyChangedDuringRun = true;
        process.exitCode = 1;
        report.pass = false;
      }
    }
  } catch {
    report.dailyAfter = null;
    report.dailyProfileTouched = true;
    process.exitCode = 1;
    report.pass = false;
  }
  if ((report.credentialAfter?.pairing ?? 0) !== 0) {
    report.pairingLeft = true;
    process.exitCode = 1;
    report.pass = false;
  }
  await rm(root, { recursive: true, force: true }).catch(() => { report.cleanupSkipped = true; });
  report.exitCode = process.exitCode ?? 0;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `import-hold-${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
}
