// Disposable sort evidence. One temporary Chrome profile, isolated app data.
// Does not import or export HTML, open the bookmark manager, or print credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/10-10-mb-03-chrome-bridge/evidence');
const runId = randomUUID();
const report = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'disposable Chrome sort order via chrome.bookmarks.move; harness cache RPC; no HTML import or export; no bookmark manager; no 10000 corpus; no idle wait',
  command: 'node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-sort-harness.mjs',
  priorFailures: [
    'native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json',
    'native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json',
  ],
  controls: [],
  cacheOrder: null,
  chromeOrder: null,
  ordersMatch: false,
};
const profiles = [];
let backend;
const paired = [];
function record(control, status, details = {}) {
  const item = { control, status, ...details };
  report.controls.push(item);
  process.stdout.write(`${JSON.stringify(item)}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
async function until(probe, code, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await probe(); if (result) return result; await delay(80); }
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
async function pair(client, page, displayName) {
  const offer = await backend.call('begin_pairing', { displayName });
  await evaluate(client, page, `document.querySelector('#pairing-code').value=${JSON.stringify(offer.pairingCode)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  paired.push(offer.profileId);
  await live(offer.profileId);
  ensure(await evaluate(client, page, `document.querySelector('#pairing-code').value === ''`), 'PAIR_CODE_NOT_CLEARED');
  return offer.profileId;
}
function cacheChildren(snapshot, parentId) {
  const children = snapshot.nodes.filter(item => {
    const node = item.node ?? item;
    return node.parentId === parentId && !item.deletedAt;
  }).map(item => item.node ?? item);
  const positions = children.map(node => node.position);
  const order = [...children].sort((left, right) => left.position - right.position || left.chromeId.localeCompare(right.chromeId)).map(node => node.chromeId);
  return { order, positions: order.map(id => children.find(node => node.chromeId === id).position), unique: new Set(positions).size === positions.length, count: children.length };
}
async function chromeChildren(client, page, folderId) {
  return evaluate(client, page, `(async()=>{
    const roots = await chrome.bookmarks.getTree();
    const stack = [...roots];
    while (stack.length) {
      const node = stack.pop();
      if (node.id === ${JSON.stringify(folderId)}) return (node.children ?? []).map(child => child.id);
      if (node.children) stack.push(...node.children);
    }
    return null;
  })()`);
}
async function remember(client, page, profileId, folderId) {
  const cached = cacheChildren(await cache(profileId), folderId);
  const chromeOrder = await chromeChildren(client, page, folderId);
  report.cacheOrder = cached.order;
  report.cachePositions = cached.positions;
  report.cachePositionsUnique = cached.unique;
  report.chromeOrder = chromeOrder;
  report.ordersMatch = Array.isArray(chromeOrder) && cached.unique && cached.order.length === 3 && chromeOrder.length === 3 && cached.order.join(',') === chromeOrder.join(',');
  return { ...cached, chromeOrder };
}

try {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-03-sort-app-'));
  report.dataDirectory = dataDirectory;
  report.credentialNamespace = `Markbridge.Task03.${runId}`;
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [dataDirectory, report.credentialNamespace]);
  const port = await new Promise(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); }); });
  await backend.call('start_bridge', { port });
  const chrome = await launchChrome(await mkdtemp(join(tmpdir(), 'markbridge-03-sort-p1-')));
  report.chrome = chrome.version;
  report.extensionId = chrome.extensionId;
  const page = await openOptions(chrome);
  const profileId = await pair(chrome, page, 'Sort disposable');
  report.profileId = profileId;
  const created = await evaluate(chrome, page, `(async()=>{
    const roots = await chrome.bookmarks.getTree();
    const bar = roots[0] && roots[0].children && roots[0].children.find(node => !node.unmodifiable && node.folderType === 'bookmarks-bar');
    if (!bar) throw new Error('NO_WRITABLE_ROOT');
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: 'sort-folder' });
    const ids = [];
    for (const name of ['sort-a', 'sort-b', 'sort-c']) {
      const node = await chrome.bookmarks.create({ parentId: folder.id, title: name, url: 'https://example.invalid/sort/' + name });
      ids.push(node.id);
    }
    return { folderId: folder.id, ids };
  })()`);
  report.folderChromeId = created.folderId;
  report.createdOrder = created.ids;
  await until(async () => {
    const seen = await remember(chrome, page, profileId, created.folderId);
    return seen.order.length === 3 && seen.order.join(',') === created.ids.join(',');
  }, 'CREATE_ORDER_TIMEOUT', 15000);
  const movedId = created.ids[2];
  report.movedChromeId = movedId;
  report.moveIndex = 0;
  await evaluate(chrome, page, `chrome.bookmarks.move(${JSON.stringify(movedId)},{parentId:${JSON.stringify(created.folderId)},index:0}).then(node=>({id:node.id,index:node.index}))`);
  const afterMove = await remember(chrome, page, profileId, created.folderId);
  ensure(Array.isArray(afterMove.chromeOrder) && afterMove.chromeOrder.join(',') !== created.ids.join(','), 'ORDER_UNCHANGED');
  await until(async () => {
    const seen = await remember(chrome, page, profileId, created.folderId);
    return seen.count === 3 && seen.chromeOrder && seen.chromeOrder.length === 3 && seen.unique && seen.order.join(',') === seen.chromeOrder.join(',');
  }, 'CACHE_SORT_TIMEOUT', 15000);
  const finalOrders = await remember(chrome, page, profileId, created.folderId);
  ensure(finalOrders.count === 3 && finalOrders.chromeOrder.length === 3, 'SORT_CHILD_COUNT');
  ensure(finalOrders.unique, 'SORT_POSITION_TIE');
  ensure(finalOrders.order.join(',') === finalOrders.chromeOrder.join(','), 'SORT_ORDER_MISMATCH');
  ensure(finalOrders.chromeOrder.join(',') !== created.ids.join(','), 'ORDER_UNCHANGED');
  record('actual_chrome_move_child_order', 'PASS', { cacheOrder: report.cacheOrder, chromeOrder: report.chromeOrder });
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'NATIVE_DRIVER_FAILED';
  report.ordersMatch = false;
  record('native_driver', 'FAIL', { errorCode: report.failureCode, cacheOrder: report.cacheOrder, chromeOrder: report.chromeOrder });
  process.exitCode = 1;
} finally {
  if (backend) {
    for (const profileId of paired) { try { await backend.call('revoke_pairing', { profileId }); } catch { /* shutdown continues */ } }
    try { await backend.call('shutdown'); } catch { record('backend_shutdown', 'FAIL'); }
  }
  for (const client of profiles) { if (client.child.exitCode === null) { try { await client.call('Browser.close'); } catch { /* only this test child */ } } }
  report.finishedAt = new Date().toISOString();
  report.chromeProfiles = [...new Set(profiles.map(client => client.directory))];
  report.exitCode = process.exitCode ?? 0;
  await writeFile(join(evidence, `native-${runId}.json`), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ evidence: `native-${runId}.json`, exitCode: report.exitCode })}\n`);
}
