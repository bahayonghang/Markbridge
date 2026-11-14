// AC13-3 B10K timing on a temp app-data directory. Does not open daily Chrome data.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const repo = resolve(import.meta.dirname, '../../../..');
const exe = resolve(repo, 'target/release/markbridge-desktop.exe');
const seeder = resolve(repo, 'target/debug/examples/seed_profile_cache.exe');
const evidence = import.meta.dirname;
const port = 9357;
const expectedBookmarks = { length: 849515, sha256: 'DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82' };
const namespace = 'Markbridge.Task05.mb13-b10k-20261012';

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

async function bookmarksFingerprint() {
  const path = join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks');
  const data = await readFile(path);
  return { length: data.length, sha256: createHash('sha256').update(data).digest('hex').toUpperCase() };
}

async function credentialCounts() {
  const text = await new Promise((resolveHits) => {
    execFile('cmdkey', ['/list'], { windowsHide: true }, (_error, stdout) => resolveHits(stdout ?? ''));
  });
  const lines = String(text).split(/\r?\n/);
  return {
    pairing: lines.filter((line) => line.includes('Markbridge.Pairing')).length,
    model: lines.filter((line) => line.includes('Markbridge.Model')).length,
  };
}

async function ebStamp() {
  const root = join(process.env.LOCALAPPDATA, 'com.markbridge.desktop', 'EBWebView');
  let names;
  try {
    names = await readdir(root, { recursive: true });
  } catch {
    return { count: null, newest: null };
  }
  let count = 0;
  let newestMs = null;
  for (const name of names) {
    const full = join(root, name);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    count += 1;
    if (newestMs == null || info.mtimeMs > newestMs) newestMs = info.mtimeMs;
  }
  return { count, newest: newestMs == null ? null : new Date(newestMs).toISOString() };
}

async function machine() {
  const stdout = await run('pwsh', ['-NoProfile', '-Command', [
    "$os = Get-CimInstance Win32_OperatingSystem",
    "$cpu = @(Get-CimInstance Win32_Processor)[0]",
    "$dpi = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI).AppliedDPI",
    "[pscustomobject]@{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; cpu = $cpu.Name; cores = [int]$cpu.NumberOfCores; memoryBytes = [int64]$os.TotalVisibleMemorySize * 1024; appliedDpi = [int]$dpi } | ConvertTo-Json -Compress",
  ].join('; ')]);
  return JSON.parse(stdout);
}

function sameBookmarks(value) {
  return value.length === expectedBookmarks.length && value.sha256 === expectedBookmarks.sha256;
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
  throw new Error(`MB13_WAIT_${label}`);
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
      if (message.error) waiter.reject(new Error('MB13_CDP'));
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
    if (result.exceptionDetails) throw new Error('MB13_EVAL');
    return result.result?.value;
  }
}

async function connect(socketUrl) {
  const socket = new WebSocket(socketUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen());
    socket.addEventListener('error', () => reject(new Error('MB13_SOCKET')));
  });
  return new Cdp(socket);
}

async function pageTarget() {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
}

function launch(appData, webviewData) {
  return spawn(exe, [], {
    env: {
      ...process.env,
      MARKBRIDGE_APP_DATA: appData,
      MARKBRIDGE_CREDENTIAL_NAMESPACE: namespace,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false,
  });
}

async function stop(child) {
  if (child && child.exitCode == null && child.signalCode == null) {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolveStop());
      child.on('exit', () => resolveStop());
    });
  }
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      await delay(100);
    } catch {
      return;
    }
  }
}

function protocolNode(node) {
  return {
    chromeId: node.chromeId,
    parentId: node.parentId,
    position: node.position,
    kind: node.kind,
    title: node.title,
    url: node.url,
    folderType: null,
    unmodifiable: null,
    dateAdded: null,
    dateLastUsed: null,
  };
}

const probe = `(() => {
  const article = [...document.querySelectorAll('article.profile')].find((item) => item.querySelector('h3')?.textContent === 'B10K');
  const count = [...(article?.querySelectorAll('dt') ?? [])].find((item) => item.textContent === '缓存节点')?.nextElementSibling?.textContent ?? '';
  const operable = document.body?.innerText?.includes('MB05BAR') === true
    && document.body?.innerText?.includes('显示本机缓存') === true
    && document.getElementById('library-source')?.value?.startsWith('profile:') === true
    && document.getElementById('library-search')?.disabled === false;
  return { nodeCount: count.trim(), operable };
})()`;

async function searchSamples(page) {
  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    await page.evaluate(`(() => {
      const input = document.getElementById('library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) return false;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await delay(250);
    const started = await page.evaluate('performance.now()');
    const typed = await page.evaluate(`(() => {
      const input = document.getElementById('library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) return false;
      setter.call(input, 'MB05MARK');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!typed) throw new Error('MB13_SEARCH_INPUT');
    await waitFor('HIT', () => page.evaluate(`Boolean([...document.querySelectorAll('[role=option]')].find((item) => item.textContent?.includes('MB05MARK')))`), 5_000);
    const ended = await page.evaluate('performance.now()');
    samples.push(ended - started);
  }
  return samples;
}

function stats(samples) {
  if (!samples.length) return { p50: null, p95: null, max: null };
  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
  };
}

const report = {
  seed: 20261010,
  path: 'loaded-profile-cache',
  liveChrome: false,
  syncDefinition: 'process start until the B10K profile metric cache node count is 11004',
  coldDefinition: 'process start until the cache tree is operable: MB05BAR visible, cached-read-only note, profile source, search enabled',
  searchDefinition: 'page performance.now from before the MB05MARK input evaluate until a role=option contains MB05MARK; warm drops the first sample',
  percentile: 'sorted[ceil(n*ratio)-1]',
  bookmarks: null,
  folders: null,
  maxDepth: null,
  cacheNodes: null,
  syncMs: [],
  coldMs: [],
  searchMs: [],
  bookmarksBefore: null,
  bookmarksAfter: null,
  credentialsBefore: null,
  credentialsAfter: null,
  ebBefore: null,
  ebAfter: null,
  machine: null,
  exe: null,
  devicePixelRatio: null,
  ac13_3: 'FAIL',
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
};

let exitCode = 0;
let root = null;
try {
  report.bookmarksBefore = await bookmarksFingerprint();
  report.credentialsBefore = await credentialCounts();
  report.ebBefore = await ebStamp();
  if (!sameBookmarks(report.bookmarksBefore)) throw new Error('MB13_BOOKMARKS_BEFORE');
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`);
    throw new Error('MB13_PORT');
  } catch (error) {
    if (error instanceof Error && error.message === 'MB13_PORT') throw error;
  }
  const exeInfo = await stat(exe);
  report.exe = { bytes: exeInfo.size, mtime: exeInfo.mtime.toISOString() };
  await stat(seeder);
  report.machine = await machine();

  root = await mkdtemp(join(tmpdir(), 'mb13-b10k-'));
  const appData = join(root, 'app-data');
  const webviewData = join(root, 'webview');
  const nodesPath = join(root, 'nodes.json');
  const database = join(appData, 'markbridge.sqlite');
  if (![appData, webviewData, database, nodesPath].every((item) => isAbsolute(item))) throw new Error('MB13_TEMP');
  if ([appData, webviewData, database].some((item) => item.toLowerCase().includes('com.markbridge.desktop') || item.toLowerCase().includes('\\google\\'))) throw new Error('MB13_DAILY');

  const { B10K_SEED, buildB10k } = await import(pathToFileURL(resolve(repo, 'apps/desktop/src/features/library/b10k.ts')).href);
  if (B10K_SEED !== 20261010) throw new Error('MB13_SEED');
  const built = buildB10k();
  report.bookmarks = built.bookmarks;
  report.folders = built.folders;
  report.maxDepth = built.maxDepth;
  const nodes = built.nodes.map(protocolNode);
  if (built.bookmarks !== 10_000 || built.folders !== 1_000 || built.maxDepth !== 20 || nodes.length !== 11_004) throw new Error('MB13_SHAPE');
  await writeFile(nodesPath, JSON.stringify(nodes));
  const seeded = spawn(seeder, [database, nodesPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let seedOut = '';
  seeded.stdout.on('data', (chunk) => { seedOut += chunk; });
  seeded.stderr.on('data', (chunk) => { seedOut += chunk; });
  const seedCode = await new Promise((resolveCode) => seeded.on('exit', resolveCode));
  if (seedCode !== 0 || !seedOut.includes('SEED_OK')) throw new Error('MB13_SEED_WRITE');
  const db = new DatabaseSync(database, { readOnly: true });
  report.cacheNodes = Number(db.prepare('SELECT COUNT(*) AS n FROM bookmarks_cache WHERE deleted_at IS NULL').get().n);
  db.close();
  if (report.cacheNodes !== 11_004) throw new Error('MB13_CACHE_COUNT');

  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const child = launch(appData, webviewData);
    let syncMs = null;
    let coldMs = null;
    try {
      const page = await connect((await waitFor('CDP', pageTarget, 20_000)).webSocketDebuggerUrl);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (syncMs == null || coldMs == null)) {
        const state = await page.evaluate(probe).catch(() => null);
        const elapsed = Math.round(performance.now() - started);
        if (state?.nodeCount === '11004' && syncMs == null) syncMs = elapsed;
        if (state?.operable === true && coldMs == null) coldMs = elapsed;
        if (syncMs == null || coldMs == null) await delay(50);
      }
      page.socket.close();
    } finally {
      await stop(child);
    }
    if (syncMs == null || coldMs == null) throw new Error('MB13_BOOT');
    report.syncMs.push(syncMs);
    report.coldMs.push(coldMs);
  }

  const session = launch(appData, webviewData);
  try {
    const page = await connect((await waitFor('CDP', pageTarget, 20_000)).webSocketDebuggerUrl);
    await waitFor('TREE', async () => {
      const state = await page.evaluate(probe);
      return state.operable === true && state.nodeCount === '11004';
    }, 20_000);
    report.devicePixelRatio = await page.evaluate('window.devicePixelRatio');
    report.searchMs = await searchSamples(page);
    page.socket.close();
  } finally {
    await stop(session);
  }
} catch (error) {
  exitCode = 1;
  report.error = error instanceof Error ? error.message : 'MB13_FAIL';
} finally {
  try { report.bookmarksAfter = await bookmarksFingerprint(); } catch { report.bookmarksAfter = null; }
  try { report.credentialsAfter = await credentialCounts(); } catch { report.credentialsAfter = null; }
  try { report.ebAfter = await ebStamp(); } catch { report.ebAfter = null; }
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
}

const warm = report.searchMs.slice(1);
const syncStats = stats(report.syncMs);
const coldStats = stats(report.coldMs);
const searchStats = stats(report.searchMs);
const warmStats = stats(warm);
report.syncP50 = syncStats.p50;
report.syncP95 = syncStats.p95;
report.syncMax = syncStats.max;
report.coldP50 = coldStats.p50;
report.coldP95 = coldStats.p95;
report.coldMax = coldStats.max;
report.searchCount = report.searchMs.length;
report.searchP50 = searchStats.p50;
report.searchP95 = searchStats.p95;
report.searchMax = searchStats.max;
report.searchCold = report.searchMs[0] ?? null;
report.searchWarmCount = warm.length;
report.searchWarmP50 = warmStats.p50;
report.searchWarmP95 = warmStats.p95;
report.searchWarmMax = warmStats.max;
const thresholds = report.coldMs.length === 3
  && report.coldMs.every((value) => value <= 3_000)
  && report.syncMs.length === 3
  && report.searchMs.length === 30
  && warmStats.p95 != null
  && warmStats.p95 <= 200
  && report.bookmarks === 10_000
  && report.folders === 1_000
  && report.maxDepth === 20
  && report.cacheNodes === 11_004
  && sameBookmarks(report.bookmarksBefore ?? {})
  && sameBookmarks(report.bookmarksAfter ?? {})
  && report.error == null;
report.ac13_3 = thresholds ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();
await writeFile(join(evidence, 'b10k-result.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = exitCode;
