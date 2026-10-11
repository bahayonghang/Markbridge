// Live library UI timing for 100 Chrome bookmark changes. Cache-only latency is not this gate.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../../../..');
const exe = resolve(repo, 'target/release/markbridge-desktop.exe');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const extensionDir = resolve(repo, 'apps/extension/dist');
const evidence = import.meta.dirname;
const debugPort = 9344;
const runId = randomUUID();

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolveRun(stdout);
    });
  });
}

async function appliedDpi() {
  const stdout = await run('pwsh', ['-NoProfile', '-Command', "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI).AppliedDPI"]);
  return Number(stdout.trim());
}

async function credentialHits() {
  const stdout = await new Promise((resolveHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (_error, text) => resolveHits(text ?? ''));
  });
  const lines = stdout.split(/\r?\n/);
  return {
    pairing: lines.filter((line) => line.includes('Markbridge.Pairing')).length,
    task05: lines.filter((line) => line.includes('Markbridge.Task05')).length,
  };
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

async function waitFor(label, fn, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // The page or debugger is not ready yet.
    }
    await delay(50);
  }
  throw new Error(label);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.pending = new Map();
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString());
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error('MB05_CDP'));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.next;
    this.next += 1;
    return new Promise((resolveMessage, reject) => {
      this.pending.set(id, { resolve: resolveMessage, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('MB05_EVAL');
    return result.result?.value;
  }
}

async function connect(socketUrl) {
  const socket = new WebSocket(socketUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen());
    socket.addEventListener('error', () => reject(new Error('MB05_SOCKET')));
  });
  return new Cdp(socket);
}

async function pageTarget() {
  const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
  return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
}

function launchDesktop(appData, webviewData, namespace) {
  return spawn(exe, [], {
    env: {
      ...process.env,
      MARKBRIDGE_APP_DATA: appData,
      MARKBRIDGE_CREDENTIAL_NAMESPACE: namespace,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false,
  });
}

async function stopDesktop(child) {
  if (!child || (child.exitCode != null && child.signalCode != null)) return;
  if (child.exitCode == null && child.signalCode == null) {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolveStop());
      child.on('exit', () => resolveStop());
    });
  }
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      await delay(100);
    } catch {
      return;
    }
  }
}

function launchChrome(directory) {
  const child = spawn(chromePath, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let next = 0;
  let buffer = '';
  const pending = new Map();
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!message.id) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error('MB05_CHROME_CDP'));
      else request.resolve(message.result);
    }
  });
  child.on('exit', () => {
    for (const request of pending.values()) request.reject(new Error('MB05_CHROME_EXIT'));
    pending.clear();
  });
  return {
    child,
    call(method, params = {}, sessionId) {
      const id = ++next;
      return new Promise((resolveReply, reject) => {
        pending.set(id, { resolve: resolveReply, reject });
        child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
  };
}

async function openOptions(chrome) {
  const { targetId } = await chrome.call('Target.createTarget', { url: `chrome-extension://${chrome.extensionId}/options.html` });
  const { sessionId } = await chrome.call('Target.attachToTarget', { targetId, flatten: true });
  await chrome.call('Runtime.enable', {}, sessionId);
  const page = {
    sessionId,
    async evaluate(expression) {
      const response = await chrome.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (response.exceptionDetails) throw new Error('MB05_EXTENSION_EVAL');
      return response.result.value;
    },
  };
  await waitFor('MB05_OPTIONS', () => page.evaluate('!!document.querySelector("#pairing-code")'), 20_000);
  return page;
}

async function createCorpus(page, nodes) {
  const roots = await page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0];
    const bar = root.children.find((node) => node.folderType === 'bookmarks-bar');
    const other = root.children.find((node) => node.folderType === 'other');
    const mobile = root.children.find((node) => node.folderType === 'mobile');
    if (!root?.id || !bar?.id || !other?.id) return null;
    return { root: root.id, bar: bar.id, other: other.id, mobile: mobile?.id ?? null };
  })()`);
  if (!roots) throw new Error('MB05_CHROME_ROOTS');
  const ids = new Map([['0', roots.root], ['1', roots.bar], ['2', roots.other]]);
  if (roots.mobile) ids.set('3', roots.mobile);
  await page.evaluate(`globalThis.__mb05Ids = new Map(${JSON.stringify([...ids])})`);
  const pending = nodes.filter((node) => node.chromeId !== '3' && !ids.has(node.chromeId));
  const createdBookmarks = [];
  let createdFolders = 0;
  for (let offset = 0; offset < pending.length; offset += 40) {
    const batch = pending.slice(offset, offset + 40).map((node) => ({
      key: node.chromeId,
      parentKey: node.parentId,
      title: node.title,
      url: node.url,
      kind: node.kind,
    }));
    const made = await page.evaluate(`(async () => {
      const batch = ${JSON.stringify(batch)};
      const created = [];
      for (const item of batch) {
        const parentId = globalThis.__mb05Ids.get(item.parentKey);
        if (!parentId) return created;
        const node = await chrome.bookmarks.create(item.url ? { parentId, title: item.title, url: item.url } : { parentId, title: item.title });
        globalThis.__mb05Ids.set(item.key, node.id);
        created.push({ key: item.key, id: node.id, kind: item.kind, url: item.url ?? null });
      }
      return created;
    })()`);
    if (!Array.isArray(made) || made.length !== batch.length) throw new Error('MB05_CORPUS_PARENT');
    for (const item of made) {
      ids.set(item.key, item.id);
      if (item.kind === 'folder') createdFolders += 1;
      else createdBookmarks.push({ id: item.id, url: item.url });
    }
    if ((offset / 40) % 25 === 0) process.stdout.write(`${JSON.stringify({ progress: 'corpus', created: offset + made.length })}\n`);
  }
  const destination = await page.evaluate(`chrome.bookmarks.create({ parentId: ${JSON.stringify(roots.bar)}, title: 'MB05DEST' })`);
  return { createdFolders, createdBookmarks, destinationId: destination.id };
}

async function mutate(page, expression, eventName, id) {
  return page.evaluate(`(async () => {
    let observed = null;
    const listener = (...args) => { if (${id ? `args[0] === ${JSON.stringify(id)}` : 'true'}) observed = Date.now(); };
    chrome.bookmarks.${eventName}.addListener(listener);
    try {
      const result = await (${expression});
      if (observed === null) await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: result && result.id ? result.id : null, eventAt: observed };
    } finally {
      chrome.bookmarks.${eventName}.removeListener(listener);
    }
  })()`);
}

async function setSearch(page, text) {
  const typed = await page.evaluate(`(() => {
    const input = document.getElementById('library-search');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!input || input.disabled || !setter) return false;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!typed) throw new Error('MB05_SEARCH_INPUT');
}

function rowMatchExpression(needle) {
  const wanted = JSON.stringify(needle);
  return `(() => {
    const wanted = ${wanted};
    const matches = (item) => {
      const url = item.querySelector('.library-url')?.textContent ?? '';
      const title = item.querySelector('.library-title')?.textContent ?? '';
      return url === wanted || title === wanted;
    };`;
}

async function waitMatch(page, needle, present, timeoutMs) {
  const started = Date.now();
  const match = rowMatchExpression(needle);
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(`${match}
      const matched = [...document.querySelectorAll('[role=option]')].some(matches);
      const empty = document.body.innerText.includes('没有匹配的标题或网址');
      return { matched, empty };
    })()`);
    if (present && state.matched) return Date.now();
    if (!present && state.empty && !state.matched) return Date.now();
    await delay(25);
  }
  return null;
}

async function clickOption(page, needle) {
  const match = rowMatchExpression(needle);
  return page.evaluate(`${match}
    const option = [...document.querySelectorAll('[role=option]')].find(matches);
    option?.click();
    return Boolean(option);
  })()`);
}

function normalize(nodes) {
  return nodes.map((node) => ({
    chromeId: String(node.chromeId),
    parentId: node.parentId ?? null,
    position: Number(node.position),
    title: node.title ?? '',
    url: node.url || null,
  })).sort((left, right) => left.chromeId.localeCompare(right.chromeId));
}

function compareTrees(actual, observed) {
  const left = normalize(actual);
  const right = normalize(observed);
  const rightById = new Map(right.map((node) => [node.chromeId, node]));
  const ids = [];
  for (const node of left) {
    const other = rightById.get(node.chromeId);
    if (!other || other.parentId !== node.parentId || other.position !== node.position || other.title !== node.title || other.url !== node.url) ids.push(node.chromeId);
  }
  for (const node of right) {
    if (!left.some((item) => item.chromeId === node.chromeId)) ids.push(node.chromeId);
  }
  return { equal: left.length === right.length && ids.length === 0, chromeCount: left.length, uiCount: right.length, mismatchIds: ids.slice(0, 5), mismatchCount: ids.length };
}

const report = {
  runId,
  namespace: `Markbridge.Task05.${runId}`,
  status: 'UNVERIFIED',
  blocker: null,
  coldNotApplicable: 'This command measures live UI visibility, not cold start.',
  samples: [],
  p50: null,
  p95: null,
  max: null,
  tree: null,
  listenerPort: null,
  createdFolders: null,
  createdBookmarks: null,
  chrome: null,
  appliedDpiBefore: null,
  appliedDpiAfter: null,
  credentialsBefore: null,
  credentialsAfter: null,
  error: null,
};
let desktop = null;
let desktopErr = '';
let chrome = null;
let extensionPage = null;
let desktopPage = null;
const root = await mkdtemp(join(tmpdir(), 'mb05-live-'));
const appData = join(root, 'app-data');
const webviewData = join(root, 'webview');
const chromeData = join(root, 'chrome');
let exitCode = 0;

try {
  if (![appData, webviewData, chromeData].every((item) => isAbsolute(item) && !item.includes('com.markbridge.desktop'))) throw new Error('MB05_TEMP');
  report.appliedDpiBefore = await appliedDpi();
  report.credentialsBefore = await credentialHits();
  const { buildB10k } = await import(pathToFileURL(resolve(repo, 'apps/desktop/src/features/library/b10k.ts')).href);
  const built = buildB10k();
  chrome = launchChrome(chromeData);
  chrome.version = (await chrome.call('Browser.getVersion')).product;
  report.chrome = chrome.version;
  const loaded = await chrome.call('Extensions.loadUnpacked', { path: extensionDir });
  chrome.extensionId = loaded.id;
  extensionPage = await openOptions(chrome);
  const corpus = await createCorpus(extensionPage, built.nodes);
  report.createdFolders = corpus.createdFolders;
  report.createdBookmarks = corpus.createdBookmarks.length;
  if (corpus.createdFolders !== 1000 || corpus.createdBookmarks.length !== 10000) throw new Error('MB05_B10K_COUNT');
  const chromeCount = await extensionPage.evaluate(`(async () => {
    const walk = (nodes) => nodes.reduce((sum, node) => sum + 1 + walk(node.children ?? []), 0);
    return walk(await chrome.bookmarks.getTree());
  })()`);
  let bridgePort = await freePort();
  desktop = launchDesktop(appData, webviewData, report.namespace);
  desktop.stderr.on('data', (chunk) => {
    desktopErr += chunk.toString();
    if (desktopErr.length > 4000) desktopErr = desktopErr.slice(-4000);
  });
  desktopPage = await connect((await waitFor('MB05_DESKTOP', pageTarget, 20_000)).webSocketDebuggerUrl);
  await waitFor('MB05_PORT_INPUT', () => desktopPage.evaluate(`(() => {
    const input = document.getElementById('bridge-port');
    const button = input?.form?.querySelector('button');
    if (!input || !button) return false;
    return button.textContent === '连接已启动' || input.disabled === false;
  })()`), 20_000);
  if (desktopErr.includes('invalid acceptance credential namespace')) throw new Error('MB05_NAMESPACE');
  const requestedPort = String(bridgePort);
  const selected = await desktopPage.evaluate(`(() => {
    const input = document.getElementById('bridge-port');
    const button = input?.form?.querySelector('button');
    if (!input || !button) return null;
    if (button.textContent === '连接已启动') {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 1024 || value > 65535) return null;
      return { port: value, listening: true };
    }
    if (input.disabled) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return null;
    const text = ${JSON.stringify(requestedPort)};
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value === text ? { port: Number(text), listening: false } : null;
  })()`);
  if (!selected) throw new Error('MB05_PORT');
  bridgePort = selected.port;
  report.listenerPort = bridgePort;
  if (!selected.listening) {
    await waitFor('MB05_START', () => desktopPage.evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '启动连接' && !item.disabled))`), 10_000);
    await desktopPage.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '启动连接'); button?.click(); return Boolean(button); })()`);
  }
  await waitFor('MB05_LISTENING', () => desktopPage.evaluate(`document.body.innerText.includes(${JSON.stringify(`127.0.0.1:${bridgePort}`)})`), 10_000);
  await waitFor('MB05_PAIR_BUTTON', () => desktopPage.evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '生成配对串' && !item.disabled))`), 10_000);
  await desktopPage.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '生成配对串'); button?.click(); return Boolean(button); })()`);
  const code = await waitFor('MB05_PAIR_CODE', () => desktopPage.evaluate(`document.getElementById('pairing-code')?.value || ''`), 10_000);
  if (typeof code !== 'string' || !code.startsWith('{')) throw new Error('MB05_PAIR_CODE');
  await waitFor('MB05_EXTENSION_PAIR', () => extensionPage.evaluate(`document.querySelector('#pair')?.disabled === false`), 10_000);
  await extensionPage.evaluate(`(() => { const input = document.querySelector('#pairing-code'); input.value = ${JSON.stringify(code)}; document.querySelector('#pair').click(); return true; })()`);
  await waitFor('MB05_CONFIRM', () => desktopPage.evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '确认此扩展' && !item.disabled))`), 20_000);
  await desktopPage.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '确认此扩展'); button?.click(); return Boolean(button); })()`);
  await waitFor('MB05_LIVE_COUNT', () => desktopPage.evaluate(`(() => {
    const live = document.body.innerText.includes('资料正在实时同步');
    const term = [...document.querySelectorAll('dt')].find((item) => item.textContent === '缓存节点');
    const count = Number(term?.nextElementSibling?.textContent ?? '');
    return live && count >= ${chromeCount};
  })()`), 180_000);
  // A row matches only when its .library-title or .library-url equals the needle. Substring search would let item/6 satisfy item/61.
  const itemBookmarks = corpus.createdBookmarks.filter((item) => item.url?.includes('/item/'));
  const itemUrls = itemBookmarks.map((item) => item.url);
  const unique = itemBookmarks.filter((item) => itemUrls.every((url) => url === item.url || !url.includes(item.url))).slice(0, 75);
  if (unique.length < 75) throw new Error('MB05_UNIQUE_SAMPLES');
  const samples = [];
  for (let index = 0; index < 100; index += 1) {
    const kind = ['created', 'changed', 'moved', 'removed'][Math.floor(index / 25)];
    let needle = '';
    let prepare = async () => {};
    let expression = '';
    let eventName = '';
    let eventId = null;
    if (kind === 'created') {
      needle = `MB05C${index}`;
      expression = `chrome.bookmarks.create({ parentId: ${JSON.stringify(corpus.destinationId)}, title: ${JSON.stringify(needle)}, url: ${JSON.stringify(`https://example.com/mb05-add/${index}`)} })`;
      eventName = 'onCreated';
      prepare = async () => {
        await setSearch(desktopPage, needle);
        if (await waitMatch(desktopPage, needle, false, 3_000) == null) throw new Error('MB05_SEARCH_READY');
      };
    } else if (kind === 'changed') {
      const sample = unique[index - 25];
      needle = `MB05E${index}`;
      expression = `chrome.bookmarks.update(${JSON.stringify(sample.id)}, { title: ${JSON.stringify(needle)} })`;
      eventName = 'onChanged';
      eventId = sample.id;
      prepare = async () => {
        await setSearch(desktopPage, needle);
        if (await waitMatch(desktopPage, needle, false, 3_000) == null) throw new Error('MB05_SEARCH_READY');
      };
    } else if (kind === 'moved') {
      const sample = unique[index - 50];
      needle = sample.url;
      expression = `chrome.bookmarks.move(${JSON.stringify(sample.id)}, { parentId: ${JSON.stringify(corpus.destinationId)}, index: 0 })`;
      eventName = 'onMoved';
      eventId = sample.id;
      prepare = async () => {
        await setSearch(desktopPage, needle);
        await waitMatch(desktopPage, needle, true, 5_000);
        if (!await clickOption(desktopPage, needle)) throw new Error('MB05_MOVE_SELECT');
        await waitFor('MB05_MOVE_DETAIL', () => desktopPage.evaluate(`document.querySelector('.library-detail-url')?.textContent === ${JSON.stringify(needle)}`), 5_000);
      };
    } else {
      const sample = unique[index - 75];
      needle = sample.url;
      expression = `chrome.bookmarks.remove(${JSON.stringify(sample.id)})`;
      eventName = 'onRemoved';
      eventId = sample.id;
      prepare = async () => {
        await setSearch(desktopPage, needle);
        if (await waitMatch(desktopPage, needle, true, 5_000) == null) throw new Error('MB05_SEARCH_READY');
      };
    }
    await prepare();
    const operation = await mutate(extensionPage, expression, eventName, eventId);
    if (operation.eventAt == null) throw new Error('MB05_CHROME_EVENT');
    let seen = null;
    if (kind === 'removed') seen = await waitMatch(desktopPage, needle, false, 8_000);
    else if (kind === 'moved') {
      const started = Date.now();
      while (Date.now() - started < 8_000) {
        const visible = await desktopPage.evaluate(`document.querySelector('.library-path')?.innerText?.includes('MB05DEST') === true`);
        if (visible) { seen = Date.now(); break; }
        await delay(25);
      }
    } else seen = await waitMatch(desktopPage, needle, true, 8_000);
    const ms = seen == null ? Date.now() - operation.eventAt : seen - operation.eventAt;
    samples.push({ index, kind, ms, timedOut: seen == null });
    if ((index + 1) % 10 === 0) process.stdout.write(`${JSON.stringify({ progress: 'ui', index: index + 1, kind })}\n`);
  }
  report.samples = samples;
  const latencies = samples.map((item) => item.ms);
  report.p50 = percentile(latencies, 0.5);
  report.p95 = percentile(latencies, 0.95);
  report.max = Math.max(...latencies);
  const profileId = await desktopPage.evaluate(`document.getElementById('library-source')?.value?.startsWith('profile:') ? document.getElementById('library-source').value.slice('profile:'.length) : ''`);
  if (!profileId) throw new Error('MB05_PROFILE_ID');
  const uiNodes = await desktopPage.evaluate(`(async () => {
    const result = await window.__TAURI_INTERNALS__.invoke('cache_tree', { profileId: ${JSON.stringify(profileId)}, folderId: null, depth: 0 });
    return result.nodes.map((node) => ({ chromeId: node.chromeId, parentId: node.parentId ?? null, position: node.position, title: node.title, url: node.url ?? null }));
  })()`);
  const chromeNodes = await extensionPage.evaluate(`(async () => {
    const walk = (nodes, parentId = null) => nodes.flatMap((node, position) => [{ chromeId: node.id, parentId: node.parentId ?? parentId, position: node.index ?? position, title: node.title ?? '', url: node.url ?? null }, ...walk(node.children ?? [], node.id)]);
    return walk(await chrome.bookmarks.getTree());
  })()`);
  report.tree = compareTrees(chromeNodes, uiNodes);
  const withinGate = samples.length === 100 && samples.every((item) => item.ms <= 3000 && !item.timedOut);
  report.status = withinGate && report.tree.equal ? 'PASS' : 'FAIL';
  try {
    await waitFor('MB05_REVOKE', () => desktopPage.evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '吊销配对' && !item.disabled))`), 10_000);
    await desktopPage.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '吊销配对'); button?.click(); return Boolean(button); })()`);
    await waitFor('MB05_REVOKED', () => desktopPage.evaluate(`document.body.innerText.includes('未配对')`), 10_000);
    report.revoked = true;
  } catch {
    report.revoked = false;
  }
} catch (error) {
  exitCode = report.samples.length === 100 && report.tree ? 0 : 2;
  report.error = error instanceof Error && /^MB05_[A-Z0-9_]+$/.test(error.message) ? error.message : 'MB05_LIVE_FAILED';
  if (desktopErr.includes('STARTUP_FAILED')) report.startup = 'STARTUP_FAILED';
  if (desktopErr.includes('invalid acceptance credential namespace')) report.startup = 'MB05_NAMESPACE';
  if (report.samples.length !== 100 || !report.tree) {
    report.status = 'UNVERIFIED';
    report.blocker = report.error;
  } else report.status = 'FAIL';
} finally {
  try { report.appliedDpiAfter = await appliedDpi(); } catch { /* DPI is recorded only when the registry read succeeds. */ }
  if (desktopPage) {
    try { desktopPage.socket.close(); } catch { /* The desktop socket may already be closed. */ }
  }
  await stopDesktop(desktop);
  if (chrome && chrome.child.exitCode == null) {
    try { await chrome.call('Browser.close'); } catch { /* Close the disposable browser by process id next. */ }
    if (chrome.child.exitCode == null) {
      await new Promise((resolveStop) => {
        const killer = spawn('taskkill', ['/PID', String(chrome.child.pid), '/T', '/F'], { stdio: 'ignore' });
        killer.on('exit', () => resolveStop());
      });
    }
  }
  await delay(500);
  try { report.credentialsAfter = await credentialHits(); } catch { /* Credential name count is recorded only when cmdkey returns. */ }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      break;
    } catch {
      await delay(300);
    }
  }
  await writeFile(join(evidence, 'profile-live.json'), `${JSON.stringify(report)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, error: report.error, p50: report.p50, p95: report.p95, max: report.max, tree: report.tree, samples: report.samples.length, dpi: [report.appliedDpiBefore, report.appliedDpiAfter], credentials: [report.credentialsBefore, report.credentialsAfter] })}\n`);
  process.exit(exitCode);
}
