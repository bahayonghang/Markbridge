// Disposable gap evidence. One temporary Chrome profile, isolated app data.
// A 127.0.0.1 proxy rewrites only the pairing port and forwards WebSocket frames.
// Do not log frame bodies, pairing codes, tokens, or credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence');
const runId = randomUUID();
const report = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'disposable Chrome event drop, duplicate, and reorder through a 127.0.0.1 frame proxy; harness cache RPC; no HTML import or export; no bookmark manager; no 10000 corpus; no idle wait',
  command: 'node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-gap-harness.mjs',
  priorFailures: [
    'native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json',
    'native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json',
  ],
  controls: [],
  treesMatch: false,
  eventKinds: {},
};
const profiles = [];
const connections = new Set();
let backend;
let proxyServer;
const proxy = { open: 0, locked: false, closing: false, failureCode: null, mode: 'pass', dropped: 0, replayed: 0, reordered: false, forwardedEvents: 0, eventFrames: 0, clientFrames: 0, active: null };
const paired = [];
function record(control, status, details = {}) {
  const item = { control, status, ...details };
  report.controls.push(item);
  process.stdout.write(`${JSON.stringify(item)}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
function noteProxy(code) {
  if (!proxy.failureCode) proxy.failureCode = code;
  proxy.closing = true;
}
async function until(probe, code, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (proxy.failureCode) throw new Error(proxy.failureCode);
    const result = await probe();
    if (result) return result;
    await delay(80);
  }
  if (proxy.failureCode) throw new Error(proxy.failureCode);
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
function takeFrame(state) {
  const buffer = state.buffer;
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const rsv = (first & 0x70) !== 0;
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
  if (rsv) throw new Error('FRAME_RSV');
  if (!masked) throw new Error('FRAME_CLIENT_UNMASKED');
  if (opcode === 0 || (opcode === 1 && !fin)) throw new Error('FRAME_FRAGMENT');
  if (opcode >= 8) {
    if (!fin || length > 125 || (opcode !== 8 && opcode !== 9 && opcode !== 10)) throw new Error('FRAME_CONTROL');
  } else if (opcode !== 1) throw new Error('FRAME_OPCODE');
  const total = offset + 4 + length;
  if (total > 8 * 1024 * 1024) throw new Error('FRAME_TOO_LARGE');
  if (buffer.length < total) return null;
  const frame = Buffer.from(buffer.subarray(0, total));
  state.buffer = buffer.subarray(total);
  return { frame, opcode, offset, length };
}
function inspectText(meta) {
  if (meta.opcode !== 1) return null;
  const mask = meta.frame.subarray(meta.offset, meta.offset + 4);
  const data = meta.frame.subarray(meta.offset + 4);
  const out = Buffer.alloc(meta.length);
  for (let index = 0; index < meta.length; index += 1) out[index] = data[index] ^ mask[index & 3];
  let value;
  try { value = JSON.parse(out.toString('utf8')); }
  catch { throw new Error('FRAME_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') throw new Error('FRAME_JSON');
  const kind = value.type === 'event' && value.payload && value.payload.event && typeof value.payload.event.kind === 'string' && /^[a-z0-9_]+$/.test(value.payload.event.kind)
    ? value.payload.event.kind
    : null;
  return { type: value.type, kind };
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
  const next = JSON.stringify(value);
  const again = JSON.parse(next);
  if (again.port !== proxyPort || again.protocolVersion !== 1 || again.profileId !== value.profileId || again.credential !== value.credential || again.expiresAt !== value.expiresAt) throw new Error('PAIR_CODE_PORT');
  return next;
}
function maskedFrame(payload, headerLength = 7) {
  const body = Buffer.from(payload);
  const mask = Buffer.from([9, 8, 7, 6]);
  const wide = headerLength === 16;
  const frame = Buffer.alloc((wide ? 4 : 2) + 4 + body.length);
  frame[0] = 0x81;
  if (wide) { frame[1] = 0x80 | 126; frame.writeUInt16BE(body.length, 2); mask.copy(frame, 4); }
  else { frame[1] = 0x80 | body.length; mask.copy(frame, 2); }
  const dataAt = wide ? 8 : 6;
  for (let index = 0; index < body.length; index += 1) frame[dataAt + index] = body[index] ^ mask[index & 3];
  return frame;
}
function selfCheck() {
  const state = { buffer: Buffer.alloc(0) };
  const frame = maskedFrame('{"type":"event","payload":{"event":{"kind":"created"}}}');
  let seen = null;
  for (const byte of frame) {
    state.buffer = Buffer.concat([state.buffer, Buffer.from([byte])]);
    const taken = takeFrame(state);
    if (!taken) continue;
    seen = taken;
  }
  ensure(seen && inspectText(seen).type === 'event' && inspectText(seen).kind === 'created' && state.buffer.length === 0, 'FRAME_SELF_CHECK');
  state.buffer = maskedFrame('{"type":"ping"}', 16);
  const wide = takeFrame(state);
  ensure(wide && inspectText(wide).type === 'ping' && state.buffer.length === 0, 'FRAME_SELF_CHECK');
  state.buffer = Buffer.from([0x89, 0x80, 1, 2, 3, 4]);
  const ping = takeFrame(state);
  ensure(ping && inspectText(ping) === null && state.buffer.length === 0, 'FRAME_SELF_CHECK');
  state.buffer = Buffer.from([0x01, 0x81]);
  let fragmented = false;
  try { takeFrame(state); } catch (error) { fragmented = error.message === 'FRAME_FRAGMENT'; }
  ensure(fragmented, 'FRAME_SELF_CHECK');
  const fake = { protocolVersion: 1, port: 9, profileId: `p:${'11'.repeat(32)}`, credential: '22'.repeat(32), expiresAt: 1 };
  const rewritten = JSON.parse(rewritePort(JSON.stringify(fake), 10, 9));
  ensure(rewritten.port === 10 && rewritten.credential === fake.credential && rewritten.profileId === fake.profileId && rewritten.expiresAt === 1, 'PAIR_REWRITE_SELF_CHECK');
}
function writerFor(socket) {
  let chain = Promise.resolve();
  return function write(buffer) {
    const copy = Buffer.from(buffer);
    const run = chain.then(() => new Promise((resolveWrite, reject) => {
      if (socket.destroyed) { reject(new Error('PROXY_SOCKET')); return; }
      socket.write(copy, error => error ? reject(new Error('PROXY_SOCKET')) : resolveWrite());
    }));
    chain = run.catch(() => {});
    return run;
  };
}
function acceptProxy(client, bridgePort) {
  client.setNoDelay(true);
  const upstream = createConnection({ host: '127.0.0.1', port: bridgePort });
  upstream.setNoDelay(true);
  const state = { client, upstream, buffer: Buffer.alloc(0), queue: Promise.resolve(), write: writerFor(upstream), ready: false, request: Buffer.alloc(0), response: Buffer.alloc(0) };
  const fail = code => { noteProxy(code); client.destroy(); upstream.destroy(); };
  const drain = async () => {
    while (!proxy.failureCode) {
      let meta;
      try { meta = takeFrame(state); }
      catch (error) { fail(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FRAME_PARSE_FAILED'); return; }
      if (!meta) return;
      proxy.clientFrames += 1;
      let inspected = null;
      try { inspected = inspectText(meta); }
      catch (error) { fail(error.message === 'FRAME_JSON' ? 'FRAME_JSON' : 'FRAME_PARSE_FAILED'); return; }
      if (inspected?.type === 'event') {
        proxy.eventFrames += 1;
        if (inspected.kind) report.eventKinds[inspected.kind] = (report.eventKinds[inspected.kind] ?? 0) + 1;
        if (proxy.mode === 'drop') { proxy.dropped += 1; proxy.mode = 'pass'; continue; }
        if (proxy.mode === 'hold') { proxy.heldFrame = meta.frame; proxy.mode = 'later'; continue; }
        if (proxy.mode === 'later') {
          const held = proxy.heldFrame;
          proxy.heldFrame = null;
          proxy.mode = 'pass';
          proxy.reordered = true;
          try { await state.write(meta.frame); await state.write(held); }
          catch (error) { fail(error.message); return; }
          proxy.forwardedEvents += 2;
          continue;
        }
        proxy.forwardedEvents += 1;
        proxy.lastEventFrame = meta.frame;
      }
      try { await state.write(meta.frame); }
      catch (error) { fail(error.message); return; }
    }
  };
  client.on('data', chunk => {
    if (!state.ready) {
      state.request = Buffer.concat([state.request, chunk]);
      let rewritten;
      try { rewritten = rewriteHandshake(state.request, bridgePort); }
      catch (error) { fail(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'HANDSHAKE_FRAMING'); return; }
      if (!rewritten) { if (state.request.length > 65536) fail('HANDSHAKE_FRAMING'); return; }
      upstream.write(rewritten.head);
      state.buffer = rewritten.rest;
      state.ready = true;
      if (state.buffer.length) state.queue = state.queue.then(drain).catch(error => fail(error.message || 'PROXY_FAILED'));
      return;
    }
    state.buffer = Buffer.concat([state.buffer, chunk]);
    state.queue = state.queue.then(drain).catch(error => fail(error.message || 'PROXY_FAILED'));
  });
  upstream.on('data', chunk => {
    if (state.responded) { client.write(chunk); return; }
    state.response = Buffer.concat([state.response, chunk]);
    let split;
    try { split = splitResponse(state.response); }
    catch (error) { fail(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'HANDSHAKE_STATUS'); return; }
    if (!split) { if (state.response.length > 65536) fail('HANDSHAKE_FRAMING'); return; }
    state.responded = true;
    proxy.open += 1;
    connections.add(state);
    proxy.active = state;
    client.write(split.head);
    if (split.rest.length) client.write(split.rest);
  });
  const closed = () => {
    if (state.done) return;
    state.done = true;
    connections.delete(state);
    if (state.responded) proxy.open = Math.max(0, proxy.open - 1);
    if (proxy.active === state) proxy.active = null;
    if (proxy.locked && !proxy.closing && !proxy.failureCode) proxy.failureCode = 'PROXY_CLOSED';
    client.destroy();
    upstream.destroy();
  };
  client.on('close', closed);
  upstream.on('close', closed);
  client.on('error', () => { if (!state.ready || proxy.locked) fail(state.ready ? 'PROXY_SOCKET' : 'HANDSHAKE_SOCKET'); });
  upstream.on('error', () => { if (!state.responded || proxy.locked) fail(state.responded ? 'PROXY_SOCKET' : 'HANDSHAKE_SOCKET'); });
  upstream.on('connect', () => {});
}
function startProxy(bridgePort) {
  proxyServer = createServer(client => acceptProxy(client, bridgePort));
  return new Promise((resolvePort, reject) => {
    const onError = () => reject(new Error('PROXY_BIND'));
    proxyServer.once('error', onError);
    proxyServer.listen(0, '127.0.0.1', () => {
      proxyServer.removeListener('error', onError);
      resolvePort(proxyServer.address().port);
    });
  });
}
async function launchChrome(directory) {
  const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let next = 0;
  let buffer = '';
  const pending = new Map();
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`CDP_${request.method}_FAILED`));
        else request.resolve(message.result);
      }
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
  client.version = (await client.call('Browser.getVersion')).product;
  const loaded = await client.call('Extensions.loadUnpacked', { path: resolve('apps/extension/dist') });
  client.extensionId = loaded.id;
  profiles.push(client);
  return client;
}
async function evaluate(client, page, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page.sessionId);
  if (response.exceptionDetails) {
    const text = `${response.exceptionDetails.text ?? ''} ${response.exceptionDetails.exception?.description ?? ''}`;
    const known = text.match(/\b(NO_WRITABLE_ROOT)\b/);
    throw new Error(known ? known[1] : 'CHROME_EVALUATION_FAILED');
  }
  return response.result.value;
}
async function openOptions(client) {
  const { targetId } = await client.call('Target.createTarget', { url: `chrome-extension://${client.extensionId}/options.html` });
  const { sessionId } = await client.call('Target.attachToTarget', { targetId, flatten: true });
  await client.call('Runtime.enable', {}, sessionId);
  const page = { targetId, sessionId };
  await until(() => evaluate(client, page, '!!document.querySelector("#pairing-code")'), 'OPTIONS_NOT_READY');
  client.page = page;
  return page;
}
async function cache(profileId) { return backend.call('cache', { profileId }); }
async function live(profileId) {
  return until(async () => (await backend.call('state')).profiles.find(profile => profile.profileId === profileId && profile.connection === 'live'), 'PROFILE_NOT_LIVE', 30000);
}
async function pair(client, page, displayName, proxyPort, bridgePort) {
  const offer = await backend.call('begin_pairing', { displayName });
  const code = rewritePort(offer.pairingCode, proxyPort, bridgePort);
  await evaluate(client, page, `document.querySelector('#pairing-code').value=${JSON.stringify(code)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING', 30000);
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  paired.push(offer.profileId);
  await live(offer.profileId);
  ensure(await evaluate(client, page, `document.querySelector('#pairing-code').value === ''`), 'PAIR_CODE_NOT_CLEARED');
  return offer.profileId;
}
function flatten(nodes, parentId = null) {
  return nodes.flatMap((node, position) => [{ chromeId: node.id, parentId: node.parentId ?? parentId, position: node.index ?? position, title: node.title, url: node.url ?? null }, ...flatten(node.children ?? [], node.id)]);
}
function normalize(nodes) { return JSON.stringify([...nodes].sort((left, right) => left.chromeId.localeCompare(right.chromeId))); }
async function matchedTree(client, page, profileId, requiredIds) {
  const actual = await evaluate(client, page, 'chrome.bookmarks.getTree()');
  const expected = flatten(actual);
  const observed = (await cache(profileId)).nodes.filter(node => !node.deletedAt).map(item => {
    const node = item.node ?? item;
    return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
  });
  if (normalize(observed) !== normalize(expected)) return null;
  if (!requiredIds.every(id => expected.some(node => node.chromeId === id) && observed.some(node => node.chromeId === id))) return null;
  return { nodes: expected.length, cacheNodes: observed.length };
}
function stamp(snapshot) { return { lastSeq: snapshot.cursor ? snapshot.cursor.lastSeq : null, revision: snapshot.cursor ? snapshot.cursor.revision : null }; }
async function createBookmark(client, page, title) {
  return evaluate(client, page, `(async()=>{
    const roots = await chrome.bookmarks.getTree();
    const bar = roots[0] && roots[0].children && roots[0].children.find(node => !node.unmodifiable && node.folderType === 'bookmarks-bar');
    if (!bar) throw new Error('NO_WRITABLE_ROOT');
    const node = await chrome.bookmarks.create({ parentId: bar.id, title: ${JSON.stringify(title)}, url: ${JSON.stringify(`https://example.invalid/gap/${title}`)} });
    return { id: node.id, parentId: node.parentId };
  })()`);
}

try {
  selfCheck();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-03-gap-app-'));
  report.dataDirectory = dataDirectory;
  report.credentialNamespace = `Markbridge.Task03.${runId}`;
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [dataDirectory, report.credentialNamespace]);
  const bridgePort = await reservePort();
  const proxyPort = await startProxy(bridgePort);
  report.bridgePort = bridgePort;
  report.proxyPort = proxyPort;
  report.portsDiffer = bridgePort !== proxyPort;
  ensure(report.portsDiffer, 'PROXY_PORT');
  await backend.call('start_bridge', { port: bridgePort });
  const chrome = await launchChrome(await mkdtemp(join(tmpdir(), 'markbridge-03-gap-p1-')));
  report.chrome = chrome.version;
  report.extensionId = chrome.extensionId;
  const page = await openOptions(chrome);
  const profileId = await pair(chrome, page, 'Gap disposable', proxyPort, bridgePort);
  report.profileId = profileId;
  await until(() => proxy.open === 1 && proxy.active, 'PROXY_CONNECTION_COUNT', 15000);
  proxy.locked = true;
  await until(() => matchedTree(chrome, page, profileId, []), 'INITIAL_TREE_TIMEOUT', 15000);
  const beforeDrop = proxy.forwardedEvents;
  proxy.mode = 'drop';
  const dropped = await createBookmark(chrome, page, 'gap-dropped');
  await until(() => {
    if (proxy.forwardedEvents !== beforeDrop) throw new Error('DROP_EXTRA_EVENT');
    return proxy.dropped === 1 && proxy.mode === 'pass';
  }, 'DROP_NOT_SEEN');
  const followed = await createBookmark(chrome, page, 'gap-after');
  const droppedTree = await until(async () => proxy.forwardedEvents === beforeDrop + 1 && await matchedTree(chrome, page, profileId, [dropped.id, followed.id]), 'DROP_TREE_TIMEOUT', 15000);
  ensure(proxy.dropped === 1, 'DROP_COUNT');
  const replayFrame = Buffer.from(proxy.lastEventFrame ?? []);
  const replayMeta = takeFrame({ buffer: replayFrame });
  ensure(replayMeta && inspectText(replayMeta).type === 'event' && replayMeta.frame.length === replayFrame.length, 'REPLAY_FRAME_MISSING');
  record('dropped_event_tree', 'PASS', { ...droppedTree, droppedChromeId: dropped.id, followingChromeId: followed.id, droppedFrames: proxy.dropped, cursor: stamp(await cache(profileId)) });
  const beforeReplay = stamp(await cache(profileId));
  ensure(proxy.mode === 'pass' && proxy.active, 'REPLAY_MODE');
  await proxy.active.write(replayFrame);
  proxy.replayed += 1;
  await delay(750);
  const duplicateTree = await until(async () => {
    const profile = (await backend.call('state')).profiles.find(item => item.profileId === profileId);
    if (!profile || profile.connection !== 'live') return null;
    return matchedTree(chrome, page, profileId, [dropped.id, followed.id]);
  }, 'DUPLICATE_TREE_TIMEOUT', 10000);
  const afterReplay = stamp(await cache(profileId));
  ensure(proxy.replayed === 1, 'REPLAY_COUNT');
  record('duplicate_event_tree', 'PASS', { ...duplicateTree, replayedFrames: proxy.replayed, cursorBefore: beforeReplay, cursorAfter: afterReplay });
  const beforeHold = proxy.forwardedEvents;
  proxy.reordered = false;
  proxy.mode = 'hold';
  const held = await createBookmark(chrome, page, 'gap-held');
  await until(() => {
    if (proxy.reordered) throw new Error('REORDER_EXTRA_EVENT');
    return proxy.mode === 'later';
  }, 'HOLD_NOT_SEEN');
  ensure(proxy.forwardedEvents === beforeHold, 'REORDER_EXTRA_EVENT');
  const later = await createBookmark(chrome, page, 'gap-later');
  const reorderedTree = await until(async () => proxy.reordered && proxy.mode === 'pass' && await matchedTree(chrome, page, profileId, [dropped.id, followed.id, held.id, later.id]), 'REORDER_TREE_TIMEOUT', 15000);
  ensure(proxy.reordered, 'REORDER_NOT_RELEASED');
  record('reordered_event_tree', 'PASS', { ...reorderedTree, heldChromeId: held.id, laterChromeId: later.id, cursor: stamp(await cache(profileId)) });
  report.treesMatch = report.controls.filter(item => item.status === 'PASS').length === 3;
  ensure(report.treesMatch, 'TREE_CONTROL_COUNT');
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'NATIVE_DRIVER_FAILED';
  report.treesMatch = false;
  record('native_driver', 'FAIL', { errorCode: report.failureCode });
  process.exitCode = 1;
} finally {
  proxy.closing = true;
  if (backend) {
    for (const profileId of paired) { try { await backend.call('revoke_pairing', { profileId }); } catch { /* shutdown continues */ } }
    try { await backend.call('shutdown'); } catch { record('backend_shutdown', 'FAIL'); }
  }
  for (const client of profiles) {
    if (client.child.exitCode === null) { try { await client.call('Browser.close'); } catch { /* only this test child */ } }
    if (client.child.exitCode === null) client.child.kill();
  }
  for (const state of connections) { state.client.destroy(); state.upstream.destroy(); }
  if (proxyServer) proxyServer.close();
  report.finishedAt = new Date().toISOString();
  report.chromeProfiles = [...new Set(profiles.map(client => client.directory))];
  report.droppedFrames = proxy.dropped;
  report.replayedFrames = proxy.replayed;
  report.reorderedFrames = proxy.reordered;
  report.forwardedEvents = proxy.forwardedEvents;
  report.eventFrames = proxy.eventFrames;
  report.clientFrames = proxy.clientFrames;
  report.exitCode = process.exitCode ?? 0;
  await writeFile(join(evidence, `native-${runId}.json`), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ evidence: `native-${runId}.json`, exitCode: report.exitCode })}\n`);
}
