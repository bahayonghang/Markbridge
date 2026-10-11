// Loaded-profile native B10K search. The file-mirror measurement is a different path.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const repo = resolve(import.meta.dirname, '../../../..');
const exe = resolve(repo, 'target/release/markbridge-desktop.exe');
const seeder = resolve(repo, 'target/debug/examples/seed_profile_cache.exe');
const evidence = import.meta.dirname;
const port = 9343;

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
  throw new Error(`MB05_WAIT_${label}`);
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
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
}

function launch(appData, webviewData) {
  return spawn(exe, [], {
    env: {
      ...process.env,
      MARKBRIDGE_APP_DATA: appData,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false,
  });
}

async function stop(child) {
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
      await fetch(`http://127.0.0.1:${port}/json/version`);
      await delay(100);
    } catch {
      return;
    }
  }
}

async function openPage() {
  const target = await waitFor('CDP', pageTarget, 20_000);
  return connect(target.webSocketDebuggerUrl);
}

function profileReadyExpression() {
  return `document.body?.innerText?.includes('MB05BAR') === true && document.body?.innerText?.includes('显示本机缓存') === true && document.getElementById('library-source')?.value?.startsWith('profile:') === true && document.getElementById('library-search')?.disabled === false`;
}

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
    if (!typed) throw new Error('MB05_SEARCH_INPUT');
    await waitFor('HIT', () => page.evaluate(`Boolean([...document.querySelectorAll('[role=option]')].find((item) => item.textContent?.includes('MB05MARK')))`), 5_000);
    const ended = await page.evaluate('performance.now()');
    samples.push(ended - started);
  }
  return samples;
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

const root = await mkdtemp(join(tmpdir(), 'mb05-profile-'));
const appData = join(root, 'app-data');
const webviewData = join(root, 'webview');
const nodesPath = join(root, 'nodes.json');
const database = join(appData, 'markbridge.sqlite');
if (![appData, webviewData, database, nodesPath].every((item) => isAbsolute(item))) throw new Error('MB05_TEMP');
if (appData.includes('com.markbridge.desktop')) throw new Error('MB05_DAILY_DATA');

const summary = {
  path: 'loaded-profile',
  coldMs: [],
  searchMs: [],
  cacheNodes: null,
  profileSource: null,
  devicePixelRatio: null,
  appliedDpiBefore: null,
  appliedDpiAfter: null,
  credentialsBefore: null,
  credentialsAfter: null,
  error: null,
};
let exitCode = 0;
try {
  summary.appliedDpiBefore = await appliedDpi();
  summary.credentialsBefore = await credentialHits();
  const { buildB10k } = await import(pathToFileURL(resolve(repo, 'apps/desktop/src/features/library/b10k.ts')).href);
  const built = buildB10k();
  const nodes = built.nodes.map(protocolNode);
  if (nodes.length !== 11004) throw new Error('MB05_B10K_COUNT');
  await writeFile(nodesPath, JSON.stringify(nodes));
  const seeded = spawn(seeder, [database, nodesPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let seedOut = '';
  seeded.stdout.on('data', (chunk) => { seedOut += chunk; });
  seeded.stderr.on('data', (chunk) => { seedOut += chunk; });
  const seedCode = await new Promise((resolveCode) => seeded.on('exit', resolveCode));
  if (seedCode !== 0 || !seedOut.includes('SEED_OK')) throw new Error('MB05_SEED');
  const db = new DatabaseSync(database, { readOnly: true });
  summary.cacheNodes = db.prepare('SELECT COUNT(*) AS n FROM bookmarks_cache WHERE deleted_at IS NULL').get().n;
  db.close();
  if (summary.cacheNodes !== 11004) throw new Error('MB05_CACHE_COUNT');

  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const child = launch(appData, webviewData);
    try {
      const page = await openPage();
      await waitFor('COLD', () => page.evaluate(profileReadyExpression()), 15_000);
      summary.coldMs.push(Math.round(performance.now() - started));
      page.socket.close();
    } finally {
      await stop(child);
    }
  }

  const session = launch(appData, webviewData);
  try {
    const page = await openPage();
    await waitFor('TREE', () => page.evaluate(profileReadyExpression()), 20_000);
    summary.profileSource = await page.evaluate(`({
      source: document.getElementById('library-source')?.value ?? '',
      cacheNote: document.body.innerText.includes('显示本机缓存') === true,
      fileMirrorNote: document.body.innerText.includes('只读文件来源') === true,
    })`);
    summary.devicePixelRatio = await page.evaluate('window.devicePixelRatio');
    summary.searchMs = await searchSamples(page);
    page.socket.close();
  } finally {
    await stop(session);
  }
  summary.appliedDpiAfter = await appliedDpi();
  summary.credentialsAfter = await credentialHits();
} catch (error) {
  exitCode = 1;
  summary.error = error instanceof Error ? error.message : 'MB05_FAIL';
  try { summary.appliedDpiAfter = await appliedDpi(); } catch { /* DPI read is recorded only when it succeeds. */ }
  try { summary.credentialsAfter = await credentialHits(); } catch { /* Credential name count is recorded only when cmdkey returns. */ }
} finally {
  await rm(root, { recursive: true, force: true });
}

const warm = summary.searchMs.slice(1);
const report = {
  path: summary.path,
  cacheNodes: summary.cacheNodes,
  profileSource: summary.profileSource,
  coldMs: summary.coldMs,
  coldP50: summary.coldMs.length ? percentile(summary.coldMs, 0.5) : null,
  coldP95: summary.coldMs.length ? percentile(summary.coldMs, 0.95) : null,
  coldMax: summary.coldMs.length ? Math.max(...summary.coldMs) : null,
  searchCount: summary.searchMs.length,
  searchP50: summary.searchMs.length ? percentile(summary.searchMs, 0.5) : null,
  searchP95: summary.searchMs.length ? percentile(summary.searchMs, 0.95) : null,
  searchMax: summary.searchMs.length ? Math.max(...summary.searchMs) : null,
  searchCold: summary.searchMs[0] ?? null,
  searchWarmP50: warm.length ? percentile(warm, 0.5) : null,
  searchWarmP95: warm.length ? percentile(warm, 0.95) : null,
  searchWarmMax: warm.length ? Math.max(...warm) : null,
  searchMs: summary.searchMs,
  devicePixelRatio: summary.devicePixelRatio,
  appliedDpiBefore: summary.appliedDpiBefore,
  appliedDpiAfter: summary.appliedDpiAfter,
  credentialsBefore: summary.credentialsBefore,
  credentialsAfter: summary.credentialsAfter,
  error: summary.error,
};
await writeFile(join(evidence, 'profile-search.json'), `${JSON.stringify(report)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = exitCode;
