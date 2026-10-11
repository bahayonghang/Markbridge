// Actual disposable Google Chrome acceptance. Raw protocol responses stay in memory.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve('.trellis/tasks/10-10-mb-03-chrome-bridge/evidence');
const runId = randomUUID();
const report = { runId, startedAt: new Date().toISOString(), scope: 'disposable Chrome + production Rust Bridge, no Tauri GUI', controls: [], metrics: [] };
const profiles = [];
const smoke = process.argv.includes('--smoke');
let backend;
const paired = [];
function record(control, status, details = {}) {
  const item = { control, status, ...details };
  report.controls.push(item);
  process.stdout.write(`${JSON.stringify(item)}\n`);
}
function ensure(condition, code) { if (!condition) throw new Error(code); }
async function until(probe, code, timeout = 20000) {
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
  const events = [];
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
      } else events.push(message);
    }
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('CHROME_EXIT')); pending.clear(); });
  const client = { child, directory, events, call(method, params = {}, sessionId) {
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
  client.page = page;
  return page;
}
async function closePage(client, page) { await client.call('Target.closeTarget', { targetId: page.targetId }); }
async function cache(profileId) { return backend.call('cache', { profileId }); }
async function live(profileId) {
  return until(async () => (await backend.call('state')).profiles.find(profile => profile.profileId === profileId && profile.connection === 'live'), 'PROFILE_NOT_LIVE', 30000);
}
async function pair(client, page, displayName, badFirst = false) {
  const offer = await backend.call('begin_pairing', { displayName });
  if (badFirst) {
    const invalid = JSON.parse(offer.pairingCode); invalid.credential = 'invalid-credential-that-is-long-enough';
    await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(JSON.stringify(invalid))};document.querySelector('#pair').click();true`);
    await delay(1300);
    const state = await backend.call('state');
    ensure(state.profiles.length === 0 && state.pending.every(item => item.instanceId === null), 'WRONG_TOKEN_WRITES');
    record('actual_extension_wrong_pair_token_zero_identity_writes', 'PASS');
    await page.evaluate(`chrome.runtime.sendMessage({type:'forget'})`);
    await delay(1100);
  }
  await page.evaluate(`document.querySelector('#pairing-code').value=${JSON.stringify(offer.pairingCode)};document.querySelector('#pair').click();true`);
  const pending = await until(async () => (await backend.call('state')).pending.find(item => item.profileId === offer.profileId && item.instanceId), 'PAIR_NOT_PENDING');
  ensure(pending.origin === `chrome-extension://${client.extensionId}`, 'PAIR_ORIGIN_BINDING');
  await backend.call('confirm_pairing', { profileId: offer.profileId, instanceId: pending.instanceId });
  paired.push(offer.profileId);
  await live(offer.profileId);
  ensure(await page.evaluate(`document.querySelector('#pairing-code').value === ''`), 'PAIR_CODE_NOT_CLEARED');
  return offer.profileId;
}
async function createCorpus(page) {
  return page.evaluate(`(async()=>{
    const roots=await chrome.bookmarks.getTree();
    const root=roots[0].children.find(node=>!node.unmodifiable && node.folderType==='bookmarks-bar');
    if(!root)throw Error('NO_WRITABLE_ROOT');
    let seed=20261010;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    const folders=[],depths=[];
    for(let i=0;i<${smoke ? 10 : 1000};i++){
      let parent=root.id,depth=3;
      if(i>0){let p=i<18?i-1:random()%folders.length;while(depths[p]>=19)p=random()%folders.length;parent=folders[p];depth=depths[p]+1;}
      const node=await chrome.bookmarks.create({parentId:parent,title:'合成目录 '+i});folders.push(node.id);depths.push(depth);
    }
    const bookmarks=[];
    for(let start=0;start<${smoke ? 100 : 10000};start+=40){
      const batch=[];for(let i=start;i<Math.min(start+40,${smoke ? 100 : 10000});i++){let p=random()%folders.length;while(depths[p]>=20)p=random()%folders.length;batch.push(chrome.bookmarks.create({parentId:folders[p],title:'Synthetic | 合成 '+i%137,url:'https://example.invalid/fixture/'+i%233}));}
      const nodes=await Promise.all(batch);bookmarks.push(...nodes.map(node=>({id:node.id,parentId:node.parentId,title:node.title,url:node.url})));
    }
    return {folders,bookmarks,maxDepth:Math.max(...depths)+1,seed:20261010};
  })()`);
}
async function mutate(page, expression, event, id) {
  return page.evaluate(`(async()=>{
    let observed=null;
    const listener=(nodeId)=>{if(${id ? `nodeId===${JSON.stringify(id)}` : 'true'})observed=Date.now();};
    chrome.bookmarks.${event}.addListener(listener);
    try {const result=await (${expression});if(observed===null)await new Promise(resolve=>setTimeout(resolve,20));return {result,eventAt:observed};}
    finally{chrome.bookmarks.${event}.removeListener(listener);}
  })()`);
}
async function verifyTree(page, profileId) {
  const actual = await page.evaluate(`chrome.bookmarks.getTree()`);
  const flatten = (nodes, parentId = null) => nodes.flatMap((node, position) => [{ chromeId: node.id, parentId: node.parentId ?? parentId, position: node.index ?? position, title: node.title, url: node.url ?? null }, ...flatten(node.children ?? [], node.id)]);
  const normalize = nodes => JSON.stringify(nodes.sort((left, right) => left.chromeId.localeCompare(right.chromeId)));
  const observed = (await cache(profileId)).nodes.filter(node => !node.deletedAt).map(item => {
    const node = item.node ?? item;
    return { chromeId: node.chromeId, parentId: node.parentId, position: node.position, title: node.title, url: node.url ?? null };
  });
  const expected = flatten(actual);
  ensure(normalize(observed) === normalize(expected), 'FINAL_TREE_MISMATCH');
  return { nodes: expected.length, treeDigest: createHash('sha256').update(normalize(expected)).digest('hex') };
}

try {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'markbridge-03-app-'));
  report.dataDirectory = dataDirectory;
  report.credentialNamespace = `Markbridge.Task03.${runId}`;
  backend = rpcProcess(resolve('target/debug/examples/bridge_harness.exe'), [dataDirectory, report.credentialNamespace]);
  const port = await new Promise(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); }); });
  await backend.call('start_bridge', { port });
  const first = await launchChrome(await mkdtemp(join(tmpdir(), 'markbridge-03-p1-')));
  const page1 = await openOptions(first);
  const corpus = await createCorpus(page1);
  record(smoke ? 'actual_chrome_B100_diagnostic' : 'actual_chrome_B10K_fixture', 'PASS', { bookmarks: corpus.bookmarks.length, folders: corpus.folders.length, maxDepth: corpus.maxDepth, seed: corpus.seed, chrome: first.version, extensionId: first.extensionId });
  const profile1 = await pair(first, page1, 'Disposable P1', true);
  report.profile1 = profile1;
  record('actual_chrome_pairing_and_full_tree', 'PASS', await verifyTree(page1, profile1));
  if (!smoke) {
  const second = await launchChrome(await mkdtemp(join(tmpdir(), 'markbridge-03-p2-')));
  const page2 = await openOptions(second);
  await page2.evaluate(`chrome.bookmarks.create({parentId:'1',title:'P2 synthetic',url:'https://example.invalid/p2'})`);
  const profile2 = await pair(second, page2, 'Disposable P2');
  const one = await cache(profile1), two = await cache(profile2);
  const unwrap = node => node.node ?? node;
  const common = one.localIds.find(left => two.localIds.some(right => right.chromeId === left.chromeId));
  const peer = two.localIds.find(right => right.chromeId === common.chromeId);
  ensure(common && common.bookmarkId !== peer.bookmarkId, 'P2_LOCAL_ID_COLLISION');
  record('actual_chrome_P2_equal_chromeId_isolation', 'PASS', { profiles: 2, extensionIds: [first.extensionId, second.extensionId], cacheCounts: [one.nodes.length, two.nodes.length] });
  for (let index = 0; index < 100; index++) {
    const kind = ['created', 'changed', 'moved', 'removed'][Math.floor(index / 25)];
    let operation;
    let match;
    const sample = corpus.bookmarks[index];
    if (kind === 'created') {
      operation = await mutate(page1, `chrome.bookmarks.create({parentId:${JSON.stringify(corpus.folders[0])},title:'追加合成 ${index}',url:'https://example.invalid/add/${index}'})`, 'onCreated');
      match = nodes => nodes.some(item => unwrap(item).chromeId === operation.result.id);
    } else if (kind === 'changed') {
      const title = `修改合成 ${index}`;
      operation = await mutate(page1, `chrome.bookmarks.update(${JSON.stringify(sample.id)},{title:${JSON.stringify(title)}})`, 'onChanged', sample.id);
      match = nodes => nodes.some(item => unwrap(item).chromeId === sample.id && unwrap(item).title === title);
    } else if (kind === 'moved') {
      const destination = corpus.folders.find(id => id !== sample.parentId);
      operation = await mutate(page1, `chrome.bookmarks.move(${JSON.stringify(sample.id)},{parentId:${JSON.stringify(destination)},index:0})`, 'onMoved', sample.id);
      match = nodes => nodes.some(item => unwrap(item).chromeId === sample.id && unwrap(item).parentId === destination && unwrap(item).position === 0);
    } else {
      operation = await mutate(page1, `chrome.bookmarks.remove(${JSON.stringify(sample.id)}).then(()=>null)`, 'onRemoved', sample.id);
      match = nodes => !nodes.some(item => unwrap(item).chromeId === sample.id && !item.deletedAt);
    }
    ensure(operation.eventAt !== null, 'CHROME_EVENT_TIMESTAMP_MISSING');
    await until(async () => match((await cache(profile1)).nodes), `CACHE_${kind}_TIMEOUT`, 15000);
    report.metrics.push({ index, kind, unit: 'ms', eventToCache: Date.now() - operation.eventAt });
  }
  const latencies = report.metrics.map(item => item.eventToCache).sort((left, right) => left - right);
  record('actual_chrome_B10K_100_changes_cache_latency', latencies.at(-1) <= 3000 ? 'PASS' : 'FAIL', { count: 100, p50: latencies[49], p95: latencies[94], max: latencies.at(-1), unit: 'ms', boundary: 'Chrome event to Rust cache; excludes Tauri UI' });
  record('actual_chrome_final_tree_equivalence', 'PASS', await verifyTree(page1, profile1));
  const reconnectAt = Date.now();
  await backend.call('reconnect_profile', { profileId: profile1 });
  await page1.evaluate(`chrome.runtime.sendMessage({type:'reconnect'})`);
  await live(profile1);
  record('actual_chrome_explicit_reconnect', Date.now() - reconnectAt <= 10000 ? 'PASS' : 'FAIL', { elapsed: Date.now() - reconnectAt, unit: 'ms' });
  await first.call('ServiceWorker.enable', {}, page1.sessionId);
  await first.call('ServiceWorker.stopAllWorkers', {}, page1.sessionId);
  const stoppedSession = (await cache(profile1)).cursor.sessionId;
  await closePage(first, page1);
  await until(async () => {
    const state = (await backend.call('state')).profiles.find(item => item.profileId === profile1);
    const current = (await cache(profile1)).cursor;
    return state?.connection === 'live' && current.sessionId !== stoppedSession;
  }, 'WORKER_ALARM_RECOVERY_TIMEOUT', 90000);
  record('actual_chrome_forced_worker_stop_alarm_recovery', 'PASS');
  await first.call('Browser.close');
  await delay(1000);
  const restarted = await launchChrome(first.directory);
  const restartedPage = await openOptions(restarted);
  await live(profile1);
  record('actual_chrome_browser_restart_full_reconciliation', 'PASS', await verifyTree(restartedPage, profile1));
  await closePage(restarted, restartedPage);
  await closePage(second, page2);
  const idleSession = (await cache(profile1)).cursor.sessionId;
  const idleAt = Date.now();
  record('actual_chrome_idle_5min_started', 'NOT_RUN', { debuggerAttachedToWorker: false, extensionPagesOpen: 0 });
  for (let index = 0; index < 11; index++) { await delay(28000); process.stdout.write(`${JSON.stringify({ progress: 'idle', elapsedSeconds: Math.floor((Date.now() - idleAt) / 1000) })}\n`); }
  ensure((await backend.call('state')).profiles.find(item => item.profileId === profile1)?.connection === 'live', 'IDLE_NOT_LIVE');
  const afterIdle = await openOptions(restarted);
  const idleBookmark = await afterIdle.evaluate(`chrome.bookmarks.create({parentId:${JSON.stringify(corpus.folders[0])},title:'闲置后合成',url:'https://example.invalid/idle'})`);
  await until(async () => (await cache(profile1)).nodes.some(item => unwrap(item).chromeId === idleBookmark.id), 'IDLE_EVENT_MISSING');
  ensure((await cache(profile1)).cursor.sessionId === idleSession, 'IDLE_SESSION_RESTARTED');
  record('actual_chrome_idle_5min_event_same_session', 'PASS', { elapsed: Date.now() - idleAt, unit: 'ms', debuggerAttachedToWorker: false });
  const beforeRevoke = (await cache(profile2)).nodes.length;
  await backend.call('revoke_pairing', { profileId: profile2 });
  const revoked = (await backend.call('state')).profiles.find(item => item.profileId === profile2);
  ensure(revoked.connection === 'unpaired', 'REVOKE_NOT_UNPAIRED');
  const revokedPage = await openOptions(second);
  await revokedPage.evaluate(`chrome.bookmarks.create({parentId:'1',title:'吊销后合成',url:'https://example.invalid/revoked'})`);
  await delay(1500);
  ensure((await cache(profile2)).nodes.length === beforeRevoke, 'REVOKED_CACHE_WRITE');
  record('actual_chrome_revocation_zero_late_cache_writes', 'PASS');
  record('actual_chrome_import_reorder_OS_suspend_and_Tauri_GUI', 'UNVERIFIED', { reason: 'No native UI automation evidence; unit fault injection is recorded separately' });
  }
} catch (error) {
  report.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'NATIVE_DRIVER_FAILED';
  record('native_driver', 'FAIL', { errorCode: report.failureCode });
  if (backend) {
    try {
      const state = await backend.call('state');
      record('failure_backend_state', 'UNVERIFIED', { profiles: state.profiles.map(({ connection, nodeCount, revision, errorCode }) => ({ connection, nodeCount, revision, errorCode })), pendingCount: state.pending.length });
    } catch { /* no raw exception output */ }
  }
  for (const client of profiles) {
    if (client.page && client.child.exitCode === null) {
      try {
        const value = await client.page.evaluate(`chrome.runtime.sendMessage({type:'status'})`);
        record('failure_extension_state', 'UNVERIFIED', { state: value.state, nodeCount: value.nodeCount, errorCode: value.errorCode });
      } catch { /* closed page is not an additional product failure */ }
    }
  }
  process.exitCode = 1;
} finally {
  if (backend) {
    for (const profileId of paired) { try { await backend.call('revoke_pairing', { profileId }); } catch { /* report shutdown separately */ } }
    try { await backend.call('shutdown'); } catch { record('backend_shutdown', 'FAIL'); }
  }
  for (const client of profiles) { if (client.child.exitCode === null) { try { await client.call('Browser.close'); } catch { /* only this test child */ } } }
  report.finishedAt = new Date().toISOString();
  report.chromeProfiles = [...new Set(profiles.map(client => client.directory))];
  await writeFile(join(evidence, `native-${runId}.json`), `${JSON.stringify(report, null, 2)}\n`);
}
