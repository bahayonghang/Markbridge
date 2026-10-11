import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../../../..');
const exe = resolve(repo, 'target/release/markbridge-desktop.exe');
const writer = resolve(repo, 'apps/desktop/src/features/library/write-b10k.mjs');
const evidence = import.meta.dirname;
const port = 9333;

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
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
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      MARKBRIDGE_APP_DATA: appData,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
    },
    stdio: 'ignore',
    windowsHide: false,
  });
  return child;
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

async function barVisible(page) {
  return page.evaluate(`document.body?.innerText?.includes('MB05BAR') === true`);
}

async function attachMirror(page, userData) {
  await waitFor('INPUT', () => page.evaluate(`(() => {
    const input = document.getElementById('user-data-path');
    return Boolean(input && !input.disabled);
  })()`), 20_000);
  const filled = await page.evaluate(`(() => {
    const input = document.getElementById('user-data-path');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!input || !setter || input.disabled) return false;
    setter.call(input, ${JSON.stringify(userData)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value.length > 0;
  })()`);
  if (!filled) throw new Error('MB05_PATH');
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '枚举资料');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor('ATTACH_BUTTON', () => page.evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '接入只读镜像' && !item.disabled))`), 20_000);
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '接入只读镜像');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor('TREE', () => barVisible(page), 60_000);
}

async function resize(width, height) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await waitFor('TARGET', pageTarget, 5_000);
  const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId });
  await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 40, top: 40, width, height, windowState: 'normal' } });
  browser.socket.close();
  await delay(300);
}

function resizeWin32(pid, width, height) {
  const command = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mb05Win { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool r); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }'
$hwnd = (Get-Process -Id ${pid}).MainWindowHandle
if ($hwnd -eq 0) { throw 'MB05_HWND' }
[void][Mb05Win]::MoveWindow($hwnd, 40, 40, ${width}, ${height}, $true)
$rect = New-Object Mb05Win+RECT
[void][Mb05Win]::GetWindowRect($hwnd, [ref]$rect)
Write-Output ($rect.Right - $rect.Left)
Write-Output ($rect.Bottom - $rect.Top)
`;
  return new Promise((resolveRect, reject) => {
    execFile('pwsh', ['-NoProfile', '-Command', command], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else {
        const [widthText, heightText] = stdout.trim().split(/\s+/);
        resolveRect({ width: Number(widthText), height: Number(heightText) });
      }
    });
  });
}

async function shoot(page, pid, width, height, name) {
  const rect = await resizeWin32(pid, width, height);
  await delay(400);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(evidence, name), Buffer.from(shot.data, 'base64'));
  return rect;
}

async function searchSamples(page) {
  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    await page.evaluate(`(() => {
      const input = document.getElementById('library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await delay(250);
    const started = await page.evaluate('performance.now()');
    await page.evaluate(`(() => {
      const input = document.getElementById('library-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, 'MB05MARK');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitFor('HIT', () => page.evaluate(`Boolean([...document.querySelectorAll('[role=option]')].find((item) => item.textContent?.includes('MB05MARK')))`), 5_000);
    const ended = await page.evaluate('performance.now()');
    samples.push(ended - started);
  }
  return samples;
}

async function keyboard(page) {
  await page.evaluate(`document.querySelector('[role=treeitem]')?.focus()`);
  const before = await page.evaluate(`({
    role: document.activeElement?.getAttribute('role') ?? '',
    id: document.activeElement?.id ?? '',
  })`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await delay(100);
  const down = await page.evaluate(`({
    role: document.activeElement?.getAttribute('role') ?? '',
    id: document.activeElement?.id ?? '',
    inLibrary: (document.activeElement?.id ?? '').startsWith('library-row-'),
    expanded: document.activeElement?.getAttribute('aria-expanded'),
  })`);
  down.moved = down.id !== '' && down.id !== before.id;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await delay(200);
  const right = await page.evaluate(`({
    role: document.activeElement?.getAttribute('role') ?? '',
    id: document.activeElement?.id ?? '',
    inLibrary: (document.activeElement?.id ?? '').startsWith('library-row-'),
    expanded: document.activeElement?.getAttribute('aria-expanded'),
    activeClass: document.activeElement?.className ?? '',
  })`);
  return { before, down, right };
}

async function longTitleLayout(page) {
  await page.evaluate(`(() => {
    const input = document.getElementById('library-search');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(input, '长标题');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor('LONG', () => page.evaluate(`Boolean([...document.querySelectorAll('.library-title')].find((item) => item.textContent?.startsWith('长标题')))`), 5_000);
  return page.evaluate(`(() => {
    const title = [...document.querySelectorAll('.library-title')].find((item) => item.textContent?.startsWith('长标题'));
    const row = title?.closest('.library-row');
    const titleStyle = title ? getComputedStyle(title) : null;
    const rowStyle = row ? getComputedStyle(row) : null;
    return {
      found: Boolean(title),
      titleClient: title?.clientWidth ?? null,
      titleScroll: title?.scrollWidth ?? null,
      titleOverflows: title ? title.scrollWidth > title.clientWidth + 1 : null,
      rowClient: row?.clientWidth ?? null,
      rowScroll: row?.scrollWidth ?? null,
      rowOverflows: row ? row.scrollWidth > row.clientWidth + 1 : null,
      whiteSpace: titleStyle?.whiteSpace ?? null,
      textOverflow: titleStyle?.textOverflow ?? null,
      rowWidth: rowStyle?.width ?? null,
    };
  })()`);
}

const root = await mkdtemp(join(tmpdir(), 'mb05-'));
const userData = join(root, 'user-data');
const appData = join(root, 'app-data');
const webviewData = join(root, 'webview');
if (![userData, appData, webviewData].every((item) => isAbsolute(item))) throw new Error('MB05_TEMP');
await mkdir(appData, { recursive: true });
await mkdir(webviewData, { recursive: true });
const wrote = spawn(process.execPath, ['--experimental-strip-types', writer, userData], { stdio: 'ignore' });
const writeCode = await new Promise((resolveCode) => wrote.on('exit', resolveCode));
if (writeCode !== 0) throw new Error('MB05_WRITER');

const shotsOnly = process.argv.includes('--shots');
const summary = { coldMs: [], searchMs: [], keyboard: null, longTitle: null, screenshots: [], rects: [], dpi: null, readOnlyText: false, resize: 'WIN32' };
try {
  const first = launch(appData, webviewData);
  try {
    const page = await openPage();
    await attachMirror(page, userData);
    page.socket.close();
  } finally {
    await stop(first);
    await delay(500);
  }
  if (!shotsOnly) for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const child = launch(appData, webviewData);
    try {
      const page = await openPage();
      await waitFor('COLD', () => barVisible(page), 15_000);
      summary.coldMs.push(Math.round(performance.now() - started));
      page.socket.close();
    } finally {
      await stop(child);
    }
  }
  const session = launch(appData, webviewData);
  try {
    const page = await openPage();
    await waitFor('TREE', () => barVisible(page), 20_000);
    summary.readOnlyText = await page.evaluate(`document.body.innerText.includes('不能写入浏览器') === true`);
    try {
      summary.rects.push(await shoot(page, session.pid, 1280, 800, 'native-1280x800.png'));
      summary.rects.push(await shoot(page, session.pid, 1920, 1080, 'native-1920x1080.png'));
      summary.screenshots = ['native-1280x800.png', 'native-1920x1080.png'];
    } catch {
      summary.resize = 'UNVERIFIED';
    }
    summary.dpi = await page.evaluate('window.devicePixelRatio');
    if (!shotsOnly) {
      summary.keyboard = await keyboard(page);
      summary.searchMs = await searchSamples(page);
      summary.longTitle = await longTitleLayout(page);
    }
    page.socket.close();
  } finally {
    await stop(session);
  }
} catch (error) {
  summary.error = error instanceof Error ? error.message : 'MB05_FAIL';
} finally {
  await rm(root, { recursive: true, force: true });
}

const warm = summary.searchMs.slice(1);
const report = {
  coldMs: summary.coldMs,
  coldP50: summary.coldMs.length ? percentile(summary.coldMs, 0.5) : null,
  coldP95: summary.coldMs.length ? percentile(summary.coldMs, 0.95) : null,
  coldMax: summary.coldMs.length ? Math.max(...summary.coldMs) : null,
  searchCount: summary.searchMs.length,
  searchCold: summary.searchMs[0] ?? null,
  searchWarmP50: warm.length ? percentile(warm, 0.5) : null,
  searchWarmP95: warm.length ? percentile(warm, 0.95) : null,
  searchWarmMax: warm.length ? Math.max(...warm) : null,
  keyboard: summary.keyboard,
  longTitle: summary.longTitle,
  screenshots: summary.screenshots,
  rects: summary.rects,
  devicePixelRatio: summary.dpi,
  readOnlyText: summary.readOnlyText,
  resize: summary.resize,
  error: summary.error ?? null,
};
await writeFile(join(evidence, 'native-summary.json'), `${JSON.stringify(report)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
