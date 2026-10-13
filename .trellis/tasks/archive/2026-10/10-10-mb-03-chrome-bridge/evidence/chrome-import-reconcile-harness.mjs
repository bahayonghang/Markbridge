// One temporary Chrome process. Pair through a 127.0.0.1 port rewrite, then
// open chrome://settings/importData. Import only a non-HTML source whose data
// directory the page exposes inside this temp profile. No Bookmarks seed, no
// read hold, no initial_preferences, no oplock, no Netscape HTML, no
// chrome://bookmarks. Do not log pairing codes, bookmark titles, URLs, or trees.
import { spawn, execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence');
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const extensionPath = resolve('apps/extension/dist');
const banned = new Set(['d27028', 'e9d63e', 'c55f21', '0fd93c']);
let suffix = randomBytes(3).toString('hex');
while (banned.has(suffix)) suffix = randomBytes(3).toString('hex');
const namespace = `Markbridge.Task03.${suffix}`;
const notedDaily = {
  length: 850304,
  sha256: '09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D',
};
const report = {
  suffix,
  namespace,
  source: 'UNVERIFIED',
  v04: 'UNVERIFIED',
  osSleep: 'UNVERIFIED',
  importStatus: 'UNVERIFIED',
  startedAt: new Date().toISOString(),
  command: 'node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-import-reconcile-harness.mjs',
  output: `evidence/import-reconcile-${suffix}.json`,
  notedDaily,
  wire: [],
  states: [],
  extensionStatuses: [],
  sources: [],
  pathFields: [],
  controlIds: [],
  modelLoaded: false,
  treeFullBeforeTrigger: false,
  readyBeforeTrigger: null,
  dialogFound: false,
  importPageOpened: false,
  importClicked: false,
  importEnded: false,
  reconcilingAfterImport: false,
  treeAfterResync: false,
  treesMatch: false,
  importedNodeCount: 0,
  importedNodesInBoth: false,
  chromeLaunchCount: 0,
  loadUnpackedCalls: 0,
  bookmarksSeed: false,
  initialPreferences: false,
  oplock: false,
  htmlFileWritten: false,
  bookmarksManagerOpened: false,
  dailyProfileTouched: false,
  productEdited: false,
  edgePlanted: false,
  edgeLinkExisted: false,
  edgePackageExisted: false,
  edgePackageCreated: false,
  edgeJunctionCreated: false,
  edgeJunctionRemoved: null,
  edgePackageRemoved: null,
  edgeResolvedInsideTemp: false,
  pass: false,
};
const profiles = [];
let backend;
let proxyServer;
let shuttingDown = false;
let importArmed = false;
let dailyBaseline = null;
let signatureBefore = null;

function note(code, extra = {}) {
  const safe = { code };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  process.stdout.write(`${JSON.stringify(safe)}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function isInside(child, parent) {
  const left = resolve(child).toLowerCase();
  const right = resolve(parent).toLowerCase();
  return left === right || left.startsWith(right.endsWith('\\') ? right : `${right}\\`);
}
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
    if (report.proxyError) throw new Error(report.proxyError);
    const result = await probe();
    if (result) return result;
    await delay(40);
  }
  if (report.proxyError) throw new Error(report.proxyError);
  throw new Error(code);
}
function fnv(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function identity(nodes) {
  return JSON.stringify([...nodes].sort((left, right) => String(left.chromeId).localeCompare(String(right.chromeId))));
}
function rpcProcess(exe, args) {
  const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let next = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
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
  if (total > 8 * 1024 * 1024) throw new Error('FRAME_TOO_LARGE');
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
  if (!text || report.wire.length >= 400) return;
  const token = text.kind ? `${direction}:${text.type}:${text.kind}` : `${direction}:${text.type}`;
  report.wire.push(token);
  if (!importArmed) return;
  const after = report.wire.slice(report.wireAtTrigger ?? 0);
  if (after.includes('c:event:import_ended')) report.importEnded = true;
  const ended = after.indexOf('c:event:import_ended');
  if (ended >= 0 && after.slice(ended).includes('c:tree_full')) report.treeAfterResync = true;
}
function rewriteHandshake(buffer, bridgePort) {
  const text = buffer.toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  if (end < 0) return null;
  if (end > 65536) throw new Error('HANDSHAKE_FRAMING');
  const lines = text.slice(0, end).split('\r\n');
  if (lines[0] !== 'GET / HTTP/1.1') throw new Error('HANDSHAKE_TARGET');
  let host = 0;
  const next = [];
  for (const line of lines) {
    if (/^sec-websocket-extensions:/i.test(line)) continue;
    if (/^host:/i.test(line)) { host += 1; next.push(`Host: 127.0.0.1:${bridgePort}`); continue; }
    next.push(line);
  }
  if (host !== 1) throw new Error('HANDSHAKE_HOST');
  if (next.filter(line => /^origin:/i.test(line)).length !== 1) throw new Error('HANDSHAKE_ORIGIN');
  return { head: Buffer.from(`${next.join('\r\n')}\r\n\r\n`, 'latin1'), rest: Buffer.from(buffer.subarray(end + 4)) };
}
function splitResponse(buffer) {
  const text = buffer.toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  if (end < 0) return null;
  if (end > 65536) throw new Error('HANDSHAKE_FRAMING');
  if (!text.startsWith('HTTP/1.1 101')) throw new Error('HANDSHAKE_STATUS');
  return { head: buffer.subarray(0, end + 4), rest: buffer.subarray(end + 4) };
}
function rewritePort(raw, proxyPort, bridgePort) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('PAIR_CODE_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PAIR_CODE_SHAPE');
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'credential,expiresAt,port,profileId,protocolVersion') throw new Error('PAIR_CODE_SHAPE');
  if (value.protocolVersion !== 1 || value.port !== bridgePort || !Number.isInteger(proxyPort)) throw new Error('PAIR_CODE_PORT');
  value.port = proxyPort;
  return JSON.stringify(value);
}
function drainFrames(state, direction, wantMask) {
  let frame = takeFrame(state, wantMask);
  while (frame) {
    pushWire(direction, frame.text);
    frame = takeFrame(state, wantMask);
  }
}
function acceptProxy(client, bridgePort) {
  client.setNoDelay(true);
  const upstream = createConnection({ host: '127.0.0.1', port: bridgePort });
  upstream.setNoDelay(true);
  const clientState = { buffer: Buffer.alloc(0), ready: false, request: Buffer.alloc(0) };
  const serverState = { buffer: Buffer.alloc(0), responded: false, response: Buffer.alloc(0) };
  const fail = code => {
    if (!shuttingDown && !report.proxyError) report.proxyError = code;
    client.destroy();
    upstream.destroy();
  };
  client.on('data', chunk => {
    try {
      if (!clientState.ready) {
        clientState.request = Buffer.concat([clientState.request, chunk]);
        const rewritten = rewriteHandshake(clientState.request, bridgePort);
        if (!rewritten) { if (clientState.request.length > 65536) fail('HANDSHAKE_FRAMING'); return; }
        upstream.write(rewritten.head);
        if (rewritten.rest.length) upstream.write(rewritten.rest);
        clientState.ready = true;
        clientState.buffer = rewritten.rest;
        if (clientState.buffer.length) drainFrames(clientState, 'c', true);
        return;
      }
      clientState.buffer = Buffer.concat([clientState.buffer, chunk]);
      drainFrames(clientState, 'c', true);
      upstream.write(chunk);
    } catch (error) { fail(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FRAME_PARSE_FAILED'); }
  });
  upstream.on('data', chunk => {
    try {
      if (!serverState.responded) {
        serverState.response = Buffer.concat([serverState.response, chunk]);
        const split = splitResponse(serverState.response);
        if (!split) { if (serverState.response.length > 65536) fail('HANDSHAKE_FRAMING'); return; }
        serverState.responded = true;
        report.handshakes = (report.handshakes ?? 0) + 1;
        client.write(split.head);
        if (split.rest.length) client.write(split.rest);
        serverState.buffer = Buffer.from(split.rest);
        if (serverState.buffer.length) drainFrames(serverState, 's', false);
        return;
      }
      serverState.buffer = Buffer.concat([serverState.buffer, chunk]);
      drainFrames(serverState, 's', false);
      client.write(chunk);
    } catch (error) { fail(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FRAME_PARSE_FAILED'); }
  });
  const closed = () => {
    if (report.bridgeReady && !shuttingDown && !report.proxyError) report.proxyError = 'PROXY_CLOSED';
    client.destroy();
    upstream.destroy();
  };
  client.on('close', closed);
  upstream.on('close', closed);
  client.on('error', () => fail(clientState.ready ? 'PROXY_SOCKET' : 'HANDSHAKE_SOCKET'));
  upstream.on('error', () => fail(serverState.responded ? 'PROXY_SOCKET' : 'HANDSHAKE_SOCKET'));
}
function startProxy(bridgePort) {
  proxyServer = createServer(client => acceptProxy(client, bridgePort));
  return new Promise((resolvePort, reject) => {
    proxyServer.once('error', () => reject(new Error('PROXY_BIND')));
    proxyServer.listen(0, '127.0.0.1', () => resolvePort(proxyServer.address().port));
  });
}
function launchChrome(directory) {
  report.chromeLaunchCount += 1;
  const child = spawn(chromeExe, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  if (!child.stdio[3] || !child.stdio[4]) throw new Error('CDP_PIPE_MISSING');
  child.stdio[3].on('error', () => {});
  child.stdio[4].on('error', () => {});
  let next = 0;
  let buffer = '';
  const pending = new Map();
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      let message;
      try { message = JSON.parse(buffer.slice(0, end)); }
      catch { buffer = buffer.slice(end + 1); continue; }
      buffer = buffer.slice(end + 1);
      if (!message.id || !pending.has(message.id)) continue;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
      else request.resolve(message.result ?? {});
    }
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('CHROME_EXIT')); pending.clear(); });
  const client = { child, directory, call(method, params = {}, sessionId) {
    const id = ++next;
    return new Promise((resolveReply, reject) => {
      pending.set(id, { resolve: resolveReply, reject, method });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  } };
  profiles.push(client);
  return client;
}
async function evaluate(client, page, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page.sessionId);
  if (response.exceptionDetails) throw new Error('CHROME_EVALUATION_FAILED');
  return response.result?.value;
}
function assertPage(url) {
  if (String(url).startsWith('chrome://bookmarks')) throw new Error('BOOKMARKS_PAGE_FORBIDDEN');
  if (url !== 'chrome://settings/importData' && !String(url).startsWith('chrome-extension://')) throw new Error('PAGE_FORBIDDEN');
}
async function openTarget(client, url, ready) {
  assertPage(url);
  const { targetId } = await client.call('Target.createTarget', { url });
  const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
  await client.call('Runtime.enable', {}, sessionId);
  const page = { targetId, sessionId };
  await until(() => evaluate(client, page, ready).then(value => Boolean(value)).catch(() => false), 'PAGE_NOT_READY', 20000);
  return page;
}
async function cmdkeyCounts() {
  let stdout = '';
  try { stdout = await exec('cmdkey', ['/list']); }
  catch (error) { stdout = error.stdout || ''; }
  const lines = String(stdout).split(/\r?\n/);
  return {
    pairing: lines.filter(line => line.includes('Markbridge.Pairing')).length,
    namespace: lines.filter(line => line.includes(namespace)).length,
  };
}
async function deleteNamespaceTargets() {
  let stdout = '';
  try { stdout = await exec('cmdkey', ['/list']); }
  catch (error) { stdout = error.stdout || ''; }
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = line.match(/Target:\s*(.+)/i);
    if (!match) continue;
    const target = match[1].trim();
    if (!target.includes(namespace) || target.includes('Markbridge.Pairing')) continue;
    try { await exec('cmdkey', [`/delete:${target}`]); } catch { /* count remains the evidence */ }
  }
}
function dailyPath() {
  const root = process.env.LOCALAPPDATA;
  ensure(root, 'LOCALAPPDATA_MISSING');
  return join(root, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks');
}
function dailyProfilePath() {
  const root = process.env.LOCALAPPDATA;
  ensure(root, 'LOCALAPPDATA_MISSING');
  return join(root, 'Google', 'Chrome', 'User Data');
}
async function dailyDigest() {
  const data = await readFile(dailyPath());
  return { length: data.length, sha256: createHash('sha256').update(data).digest('hex').toUpperCase() };
}
async function checkDaily() {
  const digest = await dailyDigest();
  if (!dailyBaseline) dailyBaseline = digest;
  if (digest.length !== dailyBaseline.length || digest.sha256 !== dailyBaseline.sha256) {
    report.dailyChangedDuringRun = true;
    throw new Error('DAILY_HASH_CHANGED');
  }
  return digest;
}
async function guardTree(pid, userData) {
  const script = `$root = ${Number(pid)}; $all = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $root -or $_.ParentProcessId -eq $root }; $daily = 0; $temp = 0; foreach ($p in $all) { if (-not $p.CommandLine) { continue }; if ($p.CommandLine.Contains(${psQuote(dailyProfilePath())})) { $daily++ } elseif ($p.CommandLine.Contains(${psQuote(userData)})) { $temp++ } }; "DAILY=$daily"; "TEMP=$temp"`;
  try { return await exec('powershell.exe', ['-NoProfile', '-Command', script]); }
  catch { return ''; }
}
function guardCounts(text) {
  return {
    daily: Number(String(text).match(/DAILY=(\d+)/)?.[1] ?? 0),
    temp: Number(String(text).match(/TEMP=(\d+)/)?.[1] ?? 0),
  };
}
const statusLabels = {
  '未配对': 'unpaired',
  '正在连接本机桌面': 'connecting',
  '等待桌面确认扩展身份': 'pending',
  '正在核对完整书签树': 'reconciling',
  '已连接 · 只读同步': 'connected',
  '连接断开 · 桌面保留只读缓存': 'disconnected',
  '连接错误': 'error',
  '正在读取连接状态': 'reading',
  '扩展连接不可用': 'unavailable',
};
async function rememberState() {
  const state = await backend.call('state');
  const connection = state.profiles.find(profile => profile.profileId === report.profileId)?.connection ?? null;
  if (report.states.at(-1) !== connection) report.states.push(connection);
  return connection;
}
async function rememberExtensionStatus(client, page) {
  const state = await evaluate(client, page, `(async () => {
    const labels = ${JSON.stringify(statusLabels)};
    try {
      const value = await chrome.runtime.sendMessage({ type: 'status' });
      if (value && typeof value.state === 'string') return value.state;
    } catch (e) {}
    const text = document.querySelector('#status') ? document.querySelector('#status').textContent : '';
    return Object.prototype.hasOwnProperty.call(labels, text) ? labels[text] : 'unmapped';
  })()`);
  if (typeof state !== 'string' || !state) return null;
  if (report.extensionStatuses.at(-1) !== state) report.extensionStatuses.push(state);
  if (importArmed && state === 'reconciling') report.reconcilingAfterImport = true;
  return state;
}
const signatureExpression = `(async () => {
  const tree = await chrome.bookmarks.getTree();
  if (!Array.isArray(tree)) return null;
  const nodes = [];
  const walk = (list, parentId) => {
    for (let index = 0; index < (list || []).length; index += 1) {
      const node = list[index];
      const title = node.title == null ? '' : String(node.title);
      const url = node.url == null ? '' : String(node.url);
      const text = title + '\\n' + url;
      let hash = 2166136261;
      for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
      nodes.push({ chromeId: String(node.id), parentId: node.parentId == null ? parentId : String(node.parentId), position: node.index == null ? index : node.index, hash: hash >>> 0 });
      if (node.children) walk(node.children, String(node.id));
    }
  };
  walk(tree, null);
  return { count: nodes.length, nodes };
})()`;
function cacheSignature(payload) {
  return (payload.nodes ?? []).filter(item => !item.deletedAt).map(item => {
    const node = item.node ?? item;
    const title = node.title == null ? '' : String(node.title);
    const url = node.url == null ? '' : String(node.url);
    return { chromeId: String(node.chromeId), parentId: node.parentId == null ? null : String(node.parentId), position: node.position, hash: fnv(`${title}\n${url}`) };
  });
}
const scrapeExpression = `(() => {
  try {
    const sources = [];
    const pathFields = [];
    const controlIds = [];
    const seen = new Set();
    let dialogFound = false;
    function looksPath(value) {
      const text = String(value || '').trim();
      return /^[A-Za-z]:[\\\\/]/.test(text) || text.startsWith('\\\\\\\\');
    }
    function addSource(name, path, fileInput) {
      const clean = String(name || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      if (!clean || /https?:\\/\\//i.test(clean)) return;
      const key = clean + '\\n' + (path || '') + '\\n' + (fileInput ? '1' : '0');
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({ name: clean, path: path && looksPath(path) ? String(path).trim().slice(0, 260) : null, fileInput: Boolean(fileInput) });
    }
    function walk(node, scope, depth) {
      if (!node || depth > 60) return;
      if (node.nodeType === 1) {
        const id = node.id || '';
        const local = node.localName || '';
        if (id && /import|browser|bookmark|file|path/i.test(id) && controlIds.length < 40 && !controlIds.includes(id)) controlIds.push(id);
        const nextScope = Boolean(scope || local.includes('import') || /import|browser/i.test(id));
        if (local.includes('import') || /import|browser/i.test(id)) dialogFound = true;
        if (nextScope && local === 'option') addSource(node.textContent, node.value, false);
        if (nextScope && node.getAttribute && node.getAttribute('role') === 'option') addSource(node.innerText || node.textContent, null, false);
        if (nextScope && (local === 'input' || local === 'textarea')) {
          const value = typeof node.value === 'string' ? node.value : '';
          pathFields.push({ id: id, type: node.type || local, value: looksPath(value) ? value.trim().slice(0, 260) : '' });
          if ((node.type || '') === 'file') addSource(node.getAttribute('aria-label') || 'file', null, true);
        }
        if (node.shadowRoot) walk(node.shadowRoot, nextScope, depth + 1);
        for (const child of node.children || []) walk(child, nextScope, depth + 1);
        return;
      }
      for (const child of node.children || []) walk(child, scope, depth + 1);
    }
    walk(document, false, 0);
    return { href: location.href, title: document.title, dialogFound, sources, pathFields, controlIds };
  } catch (e) {
    return { href: String(location && location.href || ''), dialogFound: false, sources: [], pathFields: [], controlIds: [], error: 'SCRAPE_FAILED' };
  }
})()`;
function importExpression(name) {
  return `(async () => {
    const wanted = ${JSON.stringify(name)};
    function walk(node, visit, depth) {
      if (!node || depth > 60) return;
      if (node.nodeType === 1) {
        visit(node);
        if (node.shadowRoot) walk(node.shadowRoot, visit, depth + 1);
        for (const child of node.children || []) walk(child, visit, depth + 1);
        return;
      }
      for (const child of node.children || []) walk(child, visit, depth + 1);
    }
    function text(node) { return String(node.innerText || node.textContent || (node.getAttribute && node.getAttribute('aria-label')) || '').trim().replace(/\\s+/g, ' '); }
    let select = null;
    const boxes = [];
    let importButton = null;
    walk(document, node => {
      if (node.id === 'browserSelect') select = node;
      if (node.localName === 'cr-checkbox' || (node.localName === 'input' && node.type === 'checkbox')) boxes.push(node);
      if (node.id === 'import') importButton = node;
    }, 0);
    if (select && select.options) {
      const option = [...select.options].find(item => text(item) === wanted);
      if (!option) return { clicked: false, reason: 'OPTION_MISSING' };
      select.value = option.value;
      select.selectedIndex = option.index;
      select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else {
      let picked = false;
      walk(document, node => {
        if (picked || !node.getAttribute || node.getAttribute('role') !== 'option' || text(node) !== wanted) return;
        node.click();
        picked = true;
      }, 0);
      if (!picked) return { clicked: false, reason: 'OPTION_MISSING' };
    }
    const bookmark = boxes.find(node => node.id === 'importDialogBookmarks' || /书签|bookmark/i.test(text(node)));
    if (!bookmark) return { clicked: false, reason: 'BOOKMARKS_CONTROL_MISSING' };
    const checked = box => Boolean(box.checked);
    if (!checked(bookmark)) bookmark.click();
    for (const box of boxes) { if (box !== bookmark && checked(box)) box.click(); }
    if (!importButton) {
      walk(document, node => {
        if (importButton) return;
        if (node.localName !== 'button' && node.localName !== 'cr-button') return;
        const label = text(node);
        if (label === '导入' || label === 'Import') importButton = node;
      }, 0);
    }
    if (!importButton) return { clicked: false, reason: 'IMPORT_BUTTON_MISSING' };
    importButton.click();
    return { clicked: true, reason: 'CLICKED' };
  })()`;
}
function isHtmlSource(source) {
  if (source.fileInput) return true;
  const text = `${source.name} ${source.path ?? ''}`;
  if (/html|netscape/i.test(text)) return true;
  if (source.name.includes('书签') && source.name.includes('文件')) return true;
  if (source.name.includes('收藏夹') && source.name.includes('文件')) return true;
  return false;
}
function looksPath(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\');
}
function edgePackageRoot() {
  return join(process.env.LOCALAPPDATA, 'Packages', 'Microsoft.MicrosoftEdge_8wekyb3d8bbwe');
}
function edgeLinkPath() {
  return join(edgePackageRoot(), 'AC', 'MicrosoftEdge', 'User', 'Default');
}
async function pathExists(target) {
  try { await stat(target); return true; }
  catch { return false; }
}
async function plantEdge(userData, userReal) {
  const link = edgeLinkPath();
  const packageRoot = edgePackageRoot();
  report.edgeLinkExisted = await pathExists(link);
  report.edgePackageExisted = await pathExists(packageRoot);
  if (report.edgeLinkExisted || report.edgePackageExisted) return false;
  const target = join(userData, 'edge-source');
  const db = join(target, 'DataStore', 'Data', 'spartan.edb');
  try {
    await exec('python', [join(evidence, 'edge-spartan-seed.py'), db]);
  } catch {
    throw new Error('EDGE_SEED_FAILED');
  }
  report.seedExitCode = 0;
  report.edgePackageCreated = true;
  await mkdir(join(packageRoot, 'AC', 'MicrosoftEdge', 'User'), { recursive: true });
  try {
    await exec('cmd.exe', ['/c', 'mklink', '/J', link, target]);
  } catch {
    throw new Error('EDGE_LINK_FAILED');
  }
  report.edgeJunctionCreated = true;
  const resolved = await realpath(link);
  const dbInfo = await stat(join(link, 'DataStore', 'Data', 'spartan.edb'));
  const dbResolved = await realpath(join(link, 'DataStore', 'Data', 'spartan.edb'));
  if (!dbInfo.isFile() || !isInside(resolved, userReal) || !isInside(dbResolved, userReal)) {
    throw new Error('EDGE_LINK_OUTSIDE_TEMP');
  }
  report.edgePlanted = true;
  report.edgeResolvedInsideTemp = true;
  return true;
}
async function removeEdgePlant() {
  if (!report.edgePackageCreated && !report.edgeJunctionCreated) return;
  const link = edgeLinkPath();
  const packageRoot = edgePackageRoot();
  if (report.edgeJunctionCreated) {
    try {
      await rmdir(link);
      report.edgeJunctionRemoved = true;
    } catch {
      report.edgeJunctionRemoved = false;
    }
  }
  if (report.edgeJunctionRemoved === false) {
    report.edgePackageRemoved = false;
    return;
  }
  if (!(await pathExists(link))) {
    try {
      await rm(packageRoot, { recursive: true, force: true });
      report.edgePackageRemoved = !(await pathExists(packageRoot));
    } catch {
      report.edgePackageRemoved = false;
    }
  }
}
async function classify(rawSources, pathFields, tempRoot, dailyReal) {
  const sources = rawSources.map(source => ({ ...source }));
  const exposed = [...new Set(pathFields.map(field => field.value).filter(looksPath))];
  const open = sources.filter(source => !isHtmlSource(source));
  if (exposed.length === 1 && open.length === 1 && !open[0].path) open[0].path = exposed[0];
  const classified = [];
  for (const source of sources) {
    const html = isHtmlSource(source);
    let insideTemp = false;
    let exists = false;
    let resolved = null;
    if (source.path && looksPath(source.path) && isInside(source.path, tempRoot)) {
      try {
        resolved = await realpath(source.path);
        const info = await stat(resolved);
        exists = info.isDirectory();
        insideTemp = exists && isInside(resolved, tempRoot) && !isInside(resolved, dailyReal);
      } catch {
        insideTemp = false;
      }
    }
    classified.push({ name: source.name, path: source.path ?? null, html, fileInput: Boolean(source.fileInput), insideTemp, exists });
  }
  return classified;
}
function selfCheck() {
  const state = { buffer: Buffer.alloc(0) };
  const body = Buffer.from('{"type":"event","payload":{"event":{"kind":"created"}}}');
  const mask = Buffer.from([1, 2, 3, 4]);
  const frame = Buffer.alloc(6 + body.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | body.length;
  mask.copy(frame, 2);
  for (let index = 0; index < body.length; index += 1) frame[6 + index] = body[index] ^ mask[index & 3];
  state.buffer = frame;
  const taken = takeFrame(state, true);
  ensure(taken && taken.text.type === 'event' && taken.text.kind === 'created' && state.buffer.length === 0, 'FRAME_SELF_CHECK');
  ensure(isInside('C:\\temp\\markbridge-03-import-reconcile-a\\Default', 'C:\\temp\\markbridge-03-import-reconcile-a'), 'PATH_SELF_CHECK');
  ensure(!isInside('C:\\temp\\markbridge-03-import-reconcile-ab', 'C:\\temp\\markbridge-03-import-reconcile-a'), 'PATH_SELF_CHECK');
  ensure(namespace.startsWith('Markbridge.Task03.'), 'NAMESPACE');
  ensure(!banned.has(suffix) && /^[0-9a-f]{6}$/.test(suffix), 'NAMESPACE');
}
function receiptText() {
  const sourceText = report.sources.length
    ? report.sources.map(source => `${source.name}（路径 ${source.path ?? '无'}，html=${source.html}，insideTemp=${source.insideTemp}）`).join('；')
    : '没有列出来源';
  const pathText = report.pathFields.length
    ? report.pathFields.map(field => `${field.id || field.type || 'field'}=${field.value || '空'}`).join('；')
    : '无';
  const before = report.dailyBefore ? `长度 ${report.dailyBefore.length}，SHA256 \`${report.dailyBefore.sha256}\`` : '没有读到';
  const after = report.dailyAfter ? `长度 ${report.dailyAfter.length}，SHA256 \`${report.dailyAfter.sha256}\`` : '没有读到';
  const verdict = report.pass
    ? '这次临时目录内的非 HTML 来源走完了 import_ended、扩展 reconciling 和随后的完整树。V04 总行不改为 PASS。OS 休眠保持 UNVERIFIED。'
    : '这个来源是 UNVERIFIED。缺少 import_ended 或其他通过条件时，不把它记成产品缺陷。导入保持 UNVERIFIED。OS 休眠保持 UNVERIFIED。V04 总行不改为 PASS。';
  return `

## chrome://settings/importData

日期：2026-10-12。工作目录为仓库根。一个临时 Chrome 进程。\`--user-data-dir\` 在 \`os.tmpdir()\` 下，前缀 \`markbridge-03-import-reconcile-\`。扩展用 \`Extensions.loadUnpacked\` 加载 \`apps/extension/dist\`。命名空间 \`${report.namespace}\`。\`bridge_harness\` 的第二个参数是该命名空间。配对码只记录长度 ${report.pairingCodeLength ?? '未取得'}。没有设置 \`Markbridge.Pairing\`。没有播种启动 Bookmarks，没有读保持，没有 \`initial_preferences\`，没有 oplock。没有写 Netscape HTML，没有打开 \`chrome://bookmarks\`。一次性 Spartan 库写在临时 user-data-dir 内，再接到旧版 Edge 的检测目录。\`edgePlanted\` 是 ${report.edgePlanted}。\`edgeResolvedInsideTemp\` 是 ${report.edgeResolvedInsideTemp}。\`edgeLinkExisted\` 是 ${report.edgeLinkExisted}。\`edgePackageExisted\` 是 ${report.edgePackageExisted}。\`edgeJunctionRemoved\` 是 ${report.edgeJunctionRemoved}。\`edgePackageRemoved\` 是 ${report.edgePackageRemoved}。没有写日常 Chrome、Chromium Edge 用户数据、Firefox、IE 收藏夹或 Markbridge 应用数据。没有改产品文件。

| 命令 | 退出码 |
|---|---:|
| \`${report.command}\` | ${report.exitCode} |

观察文件是 \`${report.output}\`。\`pass\` 是 ${report.pass}。\`source\` 是 ${report.source}。\`failureCode\` 是 ${report.failureCode ?? 'null'}。\`chromeLaunchCount\` 是 ${report.chromeLaunchCount}。\`loadUnpackedCalls\` 是 ${report.loadUnpackedCalls}。

触发前 \`modelLoaded\` 是 ${report.modelLoaded}。\`treeFullBeforeTrigger\` 是 ${report.treeFullBeforeTrigger}。后端连接是 \`${report.connectionBeforeTrigger ?? 'null'}\`。扩展状态是 \`${report.extensionStatusBeforeTrigger ?? 'null'}\`。节点数 ${report.nodeCountBefore ?? 'null'}。

\`importPageOpened\` 是 ${report.importPageOpened}。\`dialogFound\` 是 ${report.dialogFound}。来源：${sourceText}。路径字段：${pathText}。\`trigger\` 是 ${report.triggerName ?? 'none'}。\`importClicked\` 是 ${report.importClicked}。

\`importEnded\` 是 ${report.importEnded}。\`reconcilingAfterImport\` 是 ${report.reconcilingAfterImport}。\`statusSamples\` 是 ${Array.isArray(report.statusSamples) && report.statusSamples.length ? report.statusSamples.join('、') : '无'}。\`treeAfterResync\` 是 ${report.treeAfterResync}。\`treesMatch\` 是 ${report.treesMatch}。\`importedNodeCount\` 是 ${report.importedNodeCount}。\`importedNodesInBoth\` 是 ${report.importedNodesInBoth}。

\`%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Bookmarks\` 启动前${before}。结束后${after}。运行中哈希${report.dailyChangedDuringRun ? '发生了变化' : '没有变化'}。没有写该文件。先前观察到的长度 ${notedDaily.length}、SHA256 \`${notedDaily.sha256}\` 只作对照，不是这次的通过条件。\`dailyMatchesNoted\` 是 ${report.dailyMatchesNoted}。

${verdict}03 未归档。
`;
}

try {
  selfCheck();
  const localAppData = process.env.LOCALAPPDATA;
  ensure(localAppData, 'LOCALAPPDATA_MISSING');
  const dailyProfile = dailyProfilePath();
  const userData = await mkdtemp(join(tmpdir(), 'markbridge-03-import-reconcile-'));
  const appData = await mkdtemp(join(tmpdir(), 'markbridge-03-import-reconcile-app-'));
  report.userData = userData;
  report.appData = appData;
  const userReal = await realpath(userData);
  const tempReal = await realpath(tmpdir());
  let dailyReal = dailyProfile;
  try { dailyReal = await realpath(dailyProfile); } catch { /* string guard still applies */ }
  ensure(basename(userData).startsWith('markbridge-03-import-reconcile-'), 'USER_DATA_PREFIX');
  ensure(isInside(userReal, tempReal), 'USER_DATA_NOT_TEMP');
  ensure(!isInside(userReal, dailyReal), 'USER_DATA_UNDER_DAILY');
  ensure(!userReal.toLowerCase().includes(join('Google', 'Chrome', 'User Data').toLowerCase()), 'USER_DATA_UNDER_DAILY');
  try {
    const diff = await exec('git', ['diff', '--name-only', '--', 'apps', 'crates', 'packages', 'scripts', 'tests']);
    report.productDiffBefore = String(diff).trim().split(/\r?\n/).filter(Boolean);
  } catch { report.productDiffBefore = null; }
  report.credentialBefore = await cmdkeyCounts();
  ensure(report.credentialBefore.pairing === 0, 'PAIRING_NAMESPACE');
  report.dailyBefore = await checkDaily();
  report.dailyMatchesNoted = report.dailyBefore.length === notedDaily.length && report.dailyBefore.sha256 === notedDaily.sha256;
  ensure(resolve(appData) !== resolve(userData) && !isInside(appData, dailyReal), 'APP_DATA_PATH');
  await plantEdge(userData, userReal);
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [appData, namespace]);
  ensure(namespace.startsWith('Markbridge.Task03.'), 'NAMESPACE');
  const bridgePort = await reservePort();
  const proxyPort = await startProxy(bridgePort);
  ensure(proxyPort !== bridgePort, 'PROXY_PORT');
  report.portsDiffer = true;
  await backend.call('start_bridge', { port: bridgePort });
  const chrome = launchChrome(userData);
  ensure(report.chromeLaunchCount === 1, 'CHROME_LAUNCH_COUNT');
  const facts = await until(async () => {
    const counts = guardCounts(await guardTree(chrome.child.pid, userData));
    if (counts.daily > 0) {
      report.dailyProfileTouched = true;
      throw new Error('DAILY_PROFILE_GUARD');
    }
    return counts.temp > 0 ? counts : null;
  }, 'USER_DATA_GUARD', 20000);
  ensure(facts.temp > 0 && facts.daily === 0, 'USER_DATA_GUARD');
  chrome.version = (await chrome.call('Browser.getVersion')).product;
  report.chrome = chrome.version;
  const loaded = await chrome.call('Extensions.loadUnpacked', { path: extensionPath });
  report.loadUnpackedCalls += 1;
  chrome.extensionId = loaded.id;
  report.extensionId = loaded.id;
  ensure(report.loadUnpackedCalls === 1 && report.chromeLaunchCount === 1, 'CHROME_LAUNCH_COUNT');
  const options = await openTarget(chrome, `chrome-extension://${chrome.extensionId}/options.html`, '!!document.querySelector("#pairing-code") && !!document.querySelector("#pair") && !!document.querySelector("#status")');
  await until(async () => {
    try { return ['unpaired', 'error'].includes(await rememberExtensionStatus(chrome, options)); }
    catch { return false; }
  }, 'EXTENSION_STATUS', 20000);
  const offer = await backend.call('begin_pairing', { displayName: 'Reconcile disposable' });
  const code = rewritePort(offer.pairingCode, proxyPort, bridgePort);
  report.pairingCodeLength = code.length;
  report.profileId = offer.profileId;
  await evaluate(chrome, options, `document.querySelector('#pairing-code').value=${JSON.stringify(code)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING', 30000);
  ensure(pending.origin === `chrome-extension://${chrome.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  await until(async () => {
    try {
      const connection = await rememberState();
      const status = await rememberExtensionStatus(chrome, options);
      report.connectionBeforeTrigger = connection;
      report.extensionStatusBeforeTrigger = status;
      report.treeFullBeforeTrigger = report.wire.includes('c:tree_full');
      return connection === 'live' && status === 'connected' && report.treeFullBeforeTrigger;
    } catch { return false; }
  }, 'BRIDGE_NOT_READY', 30000);
  report.bridgeReady = true;
  const current = await evaluate(chrome, options, signatureExpression);
  ensure(current && current.count > 0 && Array.isArray(current.nodes), 'MODEL_NOT_LOADED');
  signatureBefore = current;
  report.modelLoaded = true;
  report.nodeCountBefore = current.count;
  report.readyBeforeTrigger = { treeFull: true, connection: 'live', extensionStatus: 'connected', modelLoaded: true };
  note('bridge_ready', { modelLoaded: true, nodeCount: current.count });
  await checkDaily();
  const settings = await openTarget(chrome, 'chrome://settings/importData', 'document.readyState === "interactive" || document.readyState === "complete"');
  report.importPageOpened = true;
  const scrapeDeadline = Date.now() + 15000;
  let scraped = null;
  while (Date.now() < scrapeDeadline) {
    scraped = await evaluate(chrome, settings, scrapeExpression);
    const names = Array.isArray(scraped?.sources) ? scraped.sources.map(source => source.name) : [];
    if (names.includes('Microsoft Edge')) break;
    await delay(200);
  }
  report.dialogFound = Boolean(scraped && scraped.dialogFound);
  report.importPageHref = scraped && scraped.href ? String(scraped.href).slice(0, 160) : null;
  report.importPageTitle = scraped && scraped.title ? String(scraped.title).slice(0, 120) : null;
  report.controlIds = Array.isArray(scraped?.controlIds) ? scraped.controlIds.slice(0, 40) : [];
  report.pathFields = Array.isArray(scraped?.pathFields) ? scraped.pathFields.slice(0, 20).map(field => ({
    id: String(field.id || ''),
    type: String(field.type || ''),
    value: looksPath(field.value) ? String(field.value).slice(0, 260) : '',
  })) : [];
  report.scrapeError = scraped?.error ?? null;
  await checkDaily();
  const classified = await classify(Array.isArray(scraped?.sources) ? scraped.sources : [], report.pathFields, userReal, dailyReal);
  if (report.edgePlanted) {
    const edge = classified.find(source => source.name === 'Microsoft Edge' && !source.html);
    if (edge) {
      try {
        const resolved = await realpath(edgeLinkPath());
        const dbInfo = await stat(join(edgeLinkPath(), 'DataStore', 'Data', 'spartan.edb'));
        const dbResolved = await realpath(join(edgeLinkPath(), 'DataStore', 'Data', 'spartan.edb'));
        edge.path = resolved;
        edge.exists = dbInfo.isFile();
        edge.insideTemp = dbInfo.isFile() && isInside(resolved, userReal) && isInside(dbResolved, userReal) && !isInside(resolved, dailyReal);
        report.edgeResolvedInsideTemp = edge.insideTemp;
      } catch {
        edge.insideTemp = false;
        report.edgeResolvedInsideTemp = false;
      }
    }
  }
  report.sources = classified;
  const eligible = classified.filter(source => source.name === 'Microsoft Edge' && source.insideTemp && !source.html && source.exists && report.edgePlanted);
  report.eligibleCount = eligible.length;
  note('import_page', { dialogFound: report.dialogFound, sources: classified.length, eligible: eligible.length });
  if (!eligible.length) {
    report.failureCode = 'NO_IN_TEMP_NON_HTML_SOURCE';
    report.triggerName = null;
    report.pass = false;
    throw new Error('NO_IN_TEMP_NON_HTML_SOURCE');
  }
  const chosen = eligible[0];
  report.triggerName = chosen.name;
  await checkDaily();
  report.wireAtTrigger = report.wire.length;
  importArmed = true;
  await evaluate(chrome, options, `window.__mb03Seen = []; window.__mb03Stop = false; void (async () => { while (!window.__mb03Stop) { try { const value = await chrome.runtime.sendMessage({ type: 'status' }); const state = value && typeof value.state === 'string' ? value.state : ''; if (state && window.__mb03Seen[window.__mb03Seen.length - 1] !== state) window.__mb03Seen.push(state); } catch (e) {} } })(); true`);
  const clicked = await evaluate(chrome, settings, importExpression(chosen.name));
  report.importClick = clicked && clicked.reason ? clicked.reason : 'CLICK_FAILED';
  report.importClicked = Boolean(clicked && clicked.clicked);
  if (!report.importClicked) throw new Error(report.importClick || 'IMPORT_CLICK_FAILED');
  await until(async () => {
    try {
      const seen = await evaluate(chrome, options, 'Array.isArray(window.__mb03Seen) ? window.__mb03Seen.slice() : []');
      if (Array.isArray(seen)) {
        report.statusSamples = seen.filter(state => typeof state === 'string').slice(0, 20);
        if (report.statusSamples.includes('reconciling')) report.reconcilingAfterImport = true;
        for (const state of report.statusSamples) {
          if (report.extensionStatuses.at(-1) !== state) report.extensionStatuses.push(state);
        }
      }
    } catch { /* sampler poll continues */ }
    try { await rememberExtensionStatus(chrome, options); } catch { /* status poll continues */ }
    try { await rememberState(); } catch { /* backend poll continues */ }
    return report.importEnded && report.reconcilingAfterImport && report.treeAfterResync;
  }, 'IMPORT_WAIT', 25000).catch(error => { report.importWait = error.message; return null; });
  try { await evaluate(chrome, options, 'window.__mb03Stop = true; true'); } catch { /* page may already be gone */ }
  const after = await evaluate(chrome, options, signatureExpression);
  const cached = cacheSignature(await backend.call('cache', { profileId: report.profileId }));
  const pageNodes = after && Array.isArray(after.nodes) ? after.nodes : [];
  report.nodeCountAfter = pageNodes.length;
  report.treesMatch = pageNodes.length > 0 && identity(pageNodes) === identity(cached);
  const beforeIds = new Set((signatureBefore?.nodes ?? []).map(node => node.chromeId));
  const imported = pageNodes.filter(node => !beforeIds.has(node.chromeId));
  const cachedIds = new Set(cached.map(node => node.chromeId));
  report.importedNodeCount = imported.length;
  report.importedNodesInBoth = imported.length > 0 && imported.every(node => cachedIds.has(node.chromeId));
  report.pass = Boolean(report.importEnded && report.reconcilingAfterImport && report.treeAfterResync && report.treesMatch && report.importedNodesInBoth);
  if (report.pass) {
    report.source = chosen.name;
    report.importStatus = 'PASS';
  } else {
    report.failureCode = !report.importEnded ? 'IMPORT_ENDED_MISSING' : !report.reconcilingAfterImport ? 'RECONCILING_NOT_SEEN' : !report.treeAfterResync ? 'TREE_AFTER_MISSING' : !report.treesMatch ? 'TREE_MISMATCH' : 'IMPORTED_NODES_MISSING';
    report.importStatus = 'UNVERIFIED';
  }
  if (!report.pass) process.exitCode = 1;
} catch (error) {
  if (!report.failureCode) report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'IMPORT_DRIVER_FAILED';
  report.pass = false;
  report.source = 'UNVERIFIED';
  report.importStatus = 'UNVERIFIED';
  note('import_driver', { errorCode: report.failureCode });
  process.exitCode = 1;
} finally {
  shuttingDown = true;
  if (backend && report.profileId) {
    try { await backend.call('revoke_pairing', { profileId: report.profileId }); } catch { /* shutdown still runs */ }
  }
  if (backend) {
    try { await Promise.race([backend.call('shutdown'), delay(5000)]); } catch { /* process kill follows */ }
    backend.child.kill();
  }
  for (const client of profiles) {
    if (client.child.exitCode === null) {
      try { await Promise.race([client.call('Browser.close'), delay(5000)]); } catch { /* taskkill follows */ }
      if (client.child.exitCode === null && client.child.pid) {
        try { await exec('taskkill', ['/PID', String(client.child.pid), '/T', '/F']); } catch { /* already exited */ }
      }
    }
  }
  if (proxyServer) proxyServer.close();
  try { await deleteNamespaceTargets(); } catch { /* credential count still runs */ }
  try { report.credentialAfter = await cmdkeyCounts(); }
  catch { report.credentialAfter = null; }
  if ((report.credentialAfter?.pairing ?? 0) !== 0) {
    report.pairingLeft = true;
    report.pass = false;
    report.source = 'UNVERIFIED';
    report.importStatus = 'UNVERIFIED';
    process.exitCode = 1;
  }
  try {
    report.dailyAfter = await dailyDigest();
    report.dailyChangedDuringRun = Boolean(report.dailyBefore) && (report.dailyBefore.length !== report.dailyAfter.length || report.dailyBefore.sha256 !== report.dailyAfter.sha256);
    if (report.dailyChangedDuringRun) {
      report.failureCode = report.failureCode || 'DAILY_HASH_CHANGED';
      report.pass = false;
      report.source = 'UNVERIFIED';
      report.importStatus = 'UNVERIFIED';
      process.exitCode = 1;
    }
  } catch {
    report.dailyAfter = null;
    report.pass = false;
    report.source = 'UNVERIFIED';
    process.exitCode = 1;
  }
  try { await removeEdgePlant(); }
  catch { report.edgePackageRemoved = false; }
  if (report.edgeJunctionCreated && report.edgeJunctionRemoved !== true) {
    report.failureCode = report.failureCode || 'EDGE_LINK_LEFT';
    report.pass = false;
    report.source = 'UNVERIFIED';
    report.importStatus = 'UNVERIFIED';
    process.exitCode = 1;
  }
  if (report.userData) await rm(report.userData, { recursive: true, force: true }).catch(() => { report.cleanupSkipped = true; });
  if (report.appData) await rm(report.appData, { recursive: true, force: true }).catch(() => { report.cleanupSkipped = true; });
  try {
    const diff = await exec('git', ['diff', '--name-only', '--', 'apps', 'crates', 'packages', 'scripts', 'tests']);
    report.productDiff = String(diff).trim().split(/\r?\n/).filter(Boolean);
    const before = report.productDiffBefore;
    report.productEdited = Array.isArray(before) ? report.productDiff.some(file => !before.includes(file)) : null;
  } catch {
    report.productDiff = null;
    report.productEdited = null;
  }
  report.v04 = 'UNVERIFIED';
  report.osSleep = 'UNVERIFIED';
  report.exitCode = process.exitCode ?? 0;
  report.finishedAt = new Date().toISOString();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(evidence, `import-reconcile-${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await appendFile(join(evidence, 'receipts.md'), receiptText(), 'utf8');
  process.stdout.write(`${JSON.stringify({ evidence: report.output, exitCode: report.exitCode, source: report.source, modelLoaded: report.modelLoaded, importEnded: report.importEnded, trigger: report.triggerName ?? null })}\n`);
}
