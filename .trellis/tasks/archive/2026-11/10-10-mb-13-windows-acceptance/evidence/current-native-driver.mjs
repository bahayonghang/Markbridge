// Task 13 installed-binary driver, adapted from frozen R08 native drivers.
import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { availablePort, pair, cleanCredentials, until, ensure } from '../../archive/2026-10/10-12-mb-r08-acceptance/evidence/native-driver.mjs';
export { availablePort, pair, cleanCredentials, until, ensure };
export { extensionHash } from '../../archive/2026-10/10-12-mb-r02-connection/evidence/native-driver.mjs';
export { startProbe } from './current-native-probe.mjs';

export const repo = resolve(import.meta.dirname, '../../../..');
export const evidence = import.meta.dirname;
const run = promisify(execFile);
const windowHelper = join(evidence, 'current-native-window.ps1');

export function safeErrorCode(error, fallback) {
  return /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : fallback;
}

export function isOwnedDebugEndpoint(value, port) {
  return typeof value === 'string' && Number.isInteger(port) && port >= 1 && port <= 65535 &&
    new RegExp(`^ws://127\\.0\\.0\\.1:${port}/devtools/browser/[A-Za-z0-9-]+$`).test(value);
}

async function windowState(plan, pid, action) {
  try {
    const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowHelper,
      '-Action', action, '-TargetProcessId', String(pid), '-ExpectedExecutable', plan.executable, '-IsolationRoot', plan.root,
      '-MainTitle', plan.mainTitle ?? 'Markbridge · 签桥', '-PreviewTitle', 'Markbridge 网页预览'], { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout.trim());
  } catch (error) {
    const code = String(error.stderr ?? '').match(/\b(?:NON_ISOLATED_WINDOW_TARGET|ROOT_REDIRECTED|WINDOW_PROCESS_EXECUTABLE_MISMATCH|OWNED_WINDOW_CLOSE_NOT_POSTED)\b/)?.[0];
    throw new Error(code ?? 'NATIVE_WINDOW_HELPER_FAILED');
  }
}

export async function assertRoot(root) {
  ensure(isAbsolute(root) && resolve(root, '..') === resolve(tmpdir()) && /^markbridge-task13-native-[A-Za-z0-9-]+$/.test(basename(root)), 'NON_ISOLATED_ROOT');
  ensure(!(await lstat(root)).isSymbolicLink() && await realpath(root) === resolve(root), 'ROOT_REDIRECTED');
}

export async function assertSubdir(root, path, name) {
  await assertRoot(root);
  ensure(isAbsolute(path) && path === join(root, name) && resolve(path, '..') === root, 'NON_ISOLATED_SUBDIRECTORY');
  try { ensure(!(await lstat(path)).isSymbolicLink() && await realpath(path) === path, 'SUBDIRECTORY_REDIRECTED'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function system(action, root, extra = []) {
  await assertRoot(root);
  try {
    const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'current-native-system.ps1'), '-Action', action, '-IsolationRoot', root, ...extra], { windowsHide: true, timeout: 30000 });
    return JSON.parse(stdout.trim());
  } catch (error) {
    const code = String(error.stderr ?? '').match(/\b(?:WEBVIEW|WINDOW|RESTORE|RECOVERY|INSTALL_LOCATION|PRODUCT_KEY|ROOT|INSTALL_DIRECTORY|EXISTING_MARKBRIDGE|WEBVIEW2_RUNTIME|NON_FIXTURE|FIXTURE_CREDENTIAL|NON_ISOLATED)[A-Z0-9_]+\b/)?.[0];
    throw new Error(code ?? 'NATIVE_SYSTEM_HELPER_FAILED');
  }
}

export async function dialog(app, action = 'inspect', target) {
  const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'current-save-dialog.ps1'), '-TargetProcessId', String(app.child.pid), '-Action', action, ...(target ? ['-TargetPath', target, '-IsolationRoot', app.root] : [])], { windowsHide: true, timeout: 20000 });
  return JSON.parse(stdout.trim());
}

export async function waitDialog(app) {
  return until(async () => (await dialog(app)).found, 'SAVE_DIALOG_NOT_FOUND');
}

export async function launchInstalled(plan) {
  await assertSubdir(plan.root, plan.installDirectory, 'install');
  await assertSubdir(plan.root, plan.appData, 'app-data');
  ensure(plan.executable === join(plan.installDirectory, 'markbridge-desktop.exe'), 'WRONG_INSTALLED_EXECUTABLE');
  ensure(/^Markbridge\.Task06\.[A-Za-z0-9-]{1,80}$/.test(plan.namespace), 'WRONG_CREDENTIAL_NAMESPACE');
  const readonlyStartupObserver = plan.readonlyStartupObserver;
  ensure(!readonlyStartupObserver || (typeof readonlyStartupObserver === 'function' && /^Markbridge\.Task06\.performance-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(plan.namespace) && !plan.nativeProbe), 'READONLY_STARTUP_OBSERVER_REQUIRES_PERFORMANCE_FIXTURE');
  const debugPort = await availablePort();
  const env = { ...process.env, MARKBRIDGE_APP_DATA: plan.appData, MARKBRIDGE_CREDENTIAL_NAMESPACE: plan.namespace,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*` };
  // A command-local main override preserves the preview's per-profile directories.
  delete env.WEBVIEW2_USER_DATA_FOLDER;
  delete env.MARKBRIDGE_OPEN_HTTP_SUSPEND;
  delete env.MARKBRIDGE_OPEN_HTTP_PIDFILE;
  const nativeProbe = plan.nativeProbe === true;
  if (nativeProbe) env.MARKBRIDGE_NATIVE_PROBE = '1'; else delete env.MARKBRIDGE_NATIVE_PROBE;
  delete env.MARKBRIDGE_NATIVE_PREVIEW_PROBE;
  const nativeStages = [];
  const allowedStages = new Set(['ENTRY', 'CONFIG_ACCEPTED', 'SETUP_ENTER', 'SERVICES_READY', 'MAIN_BUILD_BEGIN', 'MAIN_BUILD_RETURNED',
    'SETUP_COMPLETED', 'TAURI_BUILD_RETURNED', 'RUN_READY', 'RUN_EXIT_REQUESTED', 'RUN_EXIT', 'BRIDGE_SHUTDOWN_BEGIN', 'BRIDGE_SHUTDOWN_END']);
  const preSpawnMonotonicMs = performance.now();
  const child = spawn(plan.executable, [], { cwd: plan.root, windowsHide: true, stdio: nativeProbe ? ['ignore', 'ignore', 'pipe'] : 'ignore', env });
  if (nativeProbe) {
    let fragment = '', discardLine = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      const parts = chunk.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (!discardLine) {
          fragment += parts[index];
          if (fragment.length > 128) { fragment = ''; discardLine = true; }
        }
        if (index < parts.length - 1) {
          const line = !discardLine ? fragment.replace(/\r$/, '') : '';
          const stage = nativeProbe && line.match(/^TASK13_NATIVE_STAGE:([A-Z_]+)$/)?.[1];
          if (stage && allowedStages.has(stage) && !nativeStages.includes(stage)) nativeStages.push(stage);
          fragment = ''; discardLine = false;
        }
      }
    });
    child.stderr.on('error', () => {});
  }
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  let browser;
  let mainOsGuardVerifiedMonotonicMs, readonlyStartupCandidateMonotonicMs;
  const readonlyStartupMilestones = {};
  const knownWebviews = new Map();
  const app = { child, root: plan.root, debugPort, nativeStages,
    get preSpawnMonotonicMs() { return preSpawnMonotonicMs; },
    get mainOsGuardVerifiedMonotonicMs() { return mainOsGuardVerifiedMonotonicMs; },
    get readonlyStartupMilestones() { return Number.isFinite(readonlyStartupCandidateMonotonicMs) ? Object.freeze({ ...readonlyStartupMilestones }) : undefined; },
    get readonlyStartupCandidateMonotonicMs() { return readonlyStartupCandidateMonotonicMs; }, async close() {
    const windowPosts = [];
    let phase = nativeProbe ? 'probe-run-ready' : 'owned-window-close';
    const facts = () => ({ pid: child.pid, exitCode: child.exitCode, signal: child.signalCode,
      method: 'verified_main_and_preview_windows_WM_CLOSE', phase, windowPosts, knownWebviewPids: [...knownWebviews.values()].map(identity => identity.pid),
      knownWebviewIdentities: [...knownWebviews.values()], nativeStageOrder: [...nativeStages] });
    try {
      if (nativeProbe && child.exitCode === null) await until(() => nativeStages.includes('RUN_READY'), 'NORMAL_APP_CLOSE_RUN_READY_NOT_OBSERVED', 30000);
      phase = 'owned-window-close';
      if (child.exitCode === null) {
        await until(async () => {
          if (child.exitCode !== null) return true;
          const observed = await windowState(plan, child.pid, 'close');
          if (windowPosts.length < 120) windowPosts.push(observed);
          return child.exitCode !== null;
        }, 'NORMAL_APP_CLOSE_TIMEOUT', 30000);
      }
      phase = 'app-exit-status';
      ensure(child.exitCode === 0 && child.signalCode === null, 'NORMAL_APP_EXIT_NONZERO');
      if (browser) await browser.close().catch(() => {});
      phase = 'known-webview-exit';
      let knownWebviewAbsence = { presentPids: [] };
      if (knownWebviews.size > 0) knownWebviewAbsence = await until(async () => {
        const observed = await system('known-webview-presence', plan.root, ['-KnownProcessIdentities', JSON.stringify([...knownWebviews.values()])]);
        return observed.presentPids.length === 0 ? observed : null;
      }, 'KNOWN_APP_WEBVIEW_PROCESS_REMAINED');
      app.lastCloseEvidence = { ...facts(), knownWebviewAbsence };
      return app.lastCloseEvidence;
    } catch (error) {
      const code = safeErrorCode(error, 'NORMAL_APP_CLOSE_HELPER_FAILED');
      app.lastCloseEvidence = { ...facts(), closeErrorCode: code };
      try { app.lastCloseEvidence.finalWindowState = await windowState(plan, child.pid, 'inspect'); }
      catch (inspectionError) { app.lastCloseEvidence.windowInspectionErrorCode = safeErrorCode(inspectionError, 'NATIVE_WINDOW_INSPECTION_FAILED'); }
      if (knownWebviews.size > 0) {
        try { app.lastCloseEvidence.knownWebviewPresence = await system('known-webview-presence', plan.root, ['-KnownProcessIdentities', JSON.stringify([...knownWebviews.values()])]); }
        catch (inspectionError) { app.lastCloseEvidence.webviewInspectionErrorCode = safeErrorCode(inspectionError, 'KNOWN_WEBVIEW_INSPECTION_FAILED'); }
      }
      const failure = new Error(code); failure.details = app.lastCloseEvidence; throw failure;
    }
  } };
  try {
    app.inspectData = async profileId => {
      const observed = await system('webview-data', plan.root, ['-TargetProcessId', String(child.pid), ...(profileId ? ['-PreviewProfileId', profileId] : [])]);
      for (const row of observed.observations) {
        ensure(Number.isInteger(row.pid) && row.pid > 0 && row.pid <= 0xffffffff && typeof row.creationUtcTicks === 'string' && /^[1-9][0-9]{0,18}$/.test(row.creationUtcTicks) && BigInt(row.creationUtcTicks).toString() === row.creationUtcTicks && BigInt(row.creationUtcTicks) <= 3155378975999999999n, 'WEBVIEW_PROCESS_IDENTITY_INVALID');
        const key = `${row.pid}:${row.creationUtcTicks}`;
        ensure(knownWebviews.has(key) || knownWebviews.size < 32, 'WEBVIEW_KNOWN_IDENTITY_LIST_INVALID');
        knownWebviews.set(key, { pid: row.pid, creationUtcTicks: row.creationUtcTicks });
      }
      app.lastDataEvidence = observed;
      ensure(observed.observations.every(row => row.insideFixture), 'WEBVIEW_OS_DATA_DIRECTORY_OUTSIDE_FIXTURE');
      return observed;
    };
    const guardMain = async () => {
      app.mainDataEvidence = await until(async () => {
        ensure(!spawnFailed && child.exitCode === null, 'INSTALLED_APP_START_FAILED');
        const observed = await app.inspectData();
        if (observed.observations.length > 0) ensure(observed.observations.every(row => row.expectedMain), 'MAIN_WEBVIEW_OS_DATA_DIRECTORY_MISMATCH');
        return observed.observations.some(row => row.expectedMain && row.observedDirectoryExists) && observed.mainDirectoryExists ? observed : null;
      }, 'MAIN_WEBVIEW_OS_DIRECTORY_NOT_OBSERVED');
      mainOsGuardVerifiedMonotonicMs = performance.now();
      if (nativeProbe) await until(() => nativeStages.includes('RUN_READY'), 'NATIVE_PROBE_RUN_READY_TIMEOUT', 30000);
    };
    const trustedPage = value => { try { return new URL(value).origin === 'http://tauri.localhost'; } catch { return false; } };
    const discoverMain = async () => {
      const runtime = await until(async () => {
        ensure(!spawnFailed, 'INSTALLED_APP_START_FAILED');
        ensure(child.exitCode === null, 'APP_EXITED_BEFORE_WEBVIEW_READY');
        try { const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
          if (!targets.some(target => target.type === 'page' && (readonlyStartupObserver ? trustedPage(target.url) : target.url.includes('tauri.localhost')))) return null;
          if (readonlyStartupObserver) readonlyStartupMilestones.cdpTargetSeen ??= performance.now();
          return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        } catch { return null; }
      }, 'INSTALLED_WEBVIEW_START_TIMEOUT');
      if (readonlyStartupObserver) ensure(isOwnedDebugEndpoint(runtime.webSocketDebuggerUrl, debugPort), 'READONLY_STARTUP_DEBUG_ENDPOINT_UNTRUSTED');
      if (readonlyStartupObserver) readonlyStartupMilestones.cdpConnectStarted = performance.now();
      browser = await chromium.connectOverCDP(runtime.webSocketDebuggerUrl);
      if (readonlyStartupObserver) readonlyStartupMilestones.cdpConnected = performance.now();
      app.page = await until(() => browser.contexts().flatMap(context => context.pages()).find(page => readonlyStartupObserver ? trustedPage(page.url()) : page.url().includes('tauri.localhost')), 'NATIVE_PAGE_TIMEOUT');
      await app.page.getByRole('heading', { name: '书签', exact: true, level: 1 }).waitFor();
      if (readonlyStartupObserver) readonlyStartupMilestones.headingSeen = performance.now();
      app.webview = runtime.Browser;
    };
    if (readonlyStartupObserver) {
      const observer = async () => {
        await discoverMain();
        ensure(trustedPage(app.page.url()), 'READONLY_STARTUP_PAGE_ORIGIN_UNTRUSTED');
        await until(() => readonlyStartupObserver(app.page), 'READONLY_STARTUP_DOM_NOT_OPERABLE');
        const candidate = performance.now();
        readonlyStartupMilestones.domReady = candidate;
        const owner = await system('debug-listener-owner', plan.root, ['-TargetProcessId', String(child.pid), '-DebugPort', String(debugPort)]);
        return { owner, candidate };
      };
      const [guardResult, observerResult] = await Promise.allSettled([guardMain(), observer()]);
      if (guardResult.status === 'rejected') throw guardResult.reason;
      if (observerResult.status === 'rejected') throw observerResult.reason;
      const { owner, candidate } = observerResult.value;
      ensure(app.mainDataEvidence.observations.some(row => row.pid === owner.webviewPid && row.creationUtcTicks === owner.creationUtcTicks && row.expectedMain && row.observedDirectoryExists) && trustedPage(app.page.url()), 'READONLY_STARTUP_OWNER_GUARD_MISMATCH');
      app.readonlyStartupOwnershipProof = { ...owner, pageOriginTrusted: true, exactMainDirectoryVerified: true };
      readonlyStartupCandidateMonotonicMs = candidate;
    } else { await guardMain(); await discoverMain(); }
    app.invoke = (command, args = {}) => app.page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
    return app;
  } catch (error) { error.fixtureApp = app; throw error; }
}

export async function launchChrome(root, name, executable, { headful = false } = {}) {
  ensure(['chrome-a', 'chrome-b'].includes(name), 'WRONG_CHROME_PROFILE_NAME');
  ensure(typeof headful === 'boolean', 'CHROME_HEADFUL_OPTION_INVALID');
  const directory = join(root, name);
  await assertSubdir(root, directory, name);
  const child = spawn(executable, [headful ? '--window-position=-32000,-32000' : '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-background-mode', '--disable-sync', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0, buffer = '';
  const pending = new Map();
  let closeEvidence;
  const closeEvent = event => {
    if (closeEvidence && closeEvidence.events.length < 16) closeEvidence.events.push({ event, elapsedMs: Date.now() - closeEvidence.startedAtMs });
  };
  const endClosePipe = () => {
    if (!child.stdio[3].writableEnded && !child.stdio[3].destroyed) {
      closeEvidence.pipeEofRequested = true; closeEvent('pipe_eof_requested'); child.stdio[3].end();
    }
  };
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id); clearTimeout(request.timeout);
      if (request.method === 'Browser.close' && closeEvidence) {
        closeEvidence.acknowledged = !message.error;
        if (message.error) closeEvidence.closeReplyErrorCode = 'TEST_CHROME_CDP_FAILED';
        closeEvent(message.error ? 'close_reply_error' : 'close_acknowledged');
      }
      if (message.error) request.reject(new Error('TEST_CHROME_CDP_FAILED'));
      else request.resolve(message.result);
    }
  });
  child.on('exit', (code, signal) => {
    if (closeEvidence) { closeEvidence.childExitObserved = true; closeEvidence.exitCode = code; closeEvidence.signal = signal; closeEvent('child_exit_observed'); }
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('TEST_CHROME_EXIT')); } pending.clear();
  });
  child.on('error', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('TEST_CHROME_START_FAILED')); } pending.clear(); });
  child.stdio[3].on('error', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('TEST_CHROME_PIPE_CLOSED')); } pending.clear(); });
  child.stdio[3].on('finish', () => { if (closeEvidence) { closeEvidence.pipeEofFlushed = true; closeEvent('pipe_eof_flushed'); } });
  child.stdio[3].on('close', () => { if (closeEvidence) { closeEvidence.pipeWriteClosed = true; closeEvent('pipe_write_closed'); } });
  child.stdio[4].on('close', () => { if (closeEvidence) { closeEvidence.pipeReadClosed = true; closeEvent('pipe_read_closed'); } });
  const chrome = { child, directory, call(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolveReply, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('TEST_CHROME_CDP_TIMEOUT')); }, 30000);
      pending.set(id, { resolve: resolveReply, reject, timeout, method });
      if (method === 'Browser.close' && closeEvidence) { closeEvidence.frameQueued = true; closeEvent('close_frame_queued'); }
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`, method === 'Browser.close' ? error => {
        if (!closeEvidence) return;
        closeEvidence.frameWriteCallback = !error;
        if (error) closeEvidence.frameWriteErrorCode = 'TEST_CHROME_PIPE_WRITE_FAILED';
        closeEvent(error ? 'close_frame_write_error' : 'close_frame_write_callback');
      } : undefined);
    });
  }, async close({ pipeEof = 'immediate', observationBudgetMs = 180000 } = {}) {
    ensure(['immediate', 'after-ack'].includes(pipeEof), 'CHROME_CLOSE_PIPE_MODE_INVALID');
    ensure([45000, 180000].includes(observationBudgetMs), 'CHROME_CLOSE_OBSERVATION_BUDGET_INVALID');
    closeEvidence = { kind: 'owned_chrome_close', pid: child.pid, method: 'Browser.close', pipeEofMode: pipeEof,
      methodVersion: observationBudgetMs === 45000 ? 1 : 2, observationBudgetMs,
      startedAtMs: Date.now(), phase: 'close-request', acknowledged: false, childExitObserved: child.exitCode !== null,
      exitCode: child.exitCode, signal: child.signalCode, events: [] };
    chrome.lastCloseEvidence = closeEvidence;
    try {
      if (child.exitCode === null) {
        const requested = chrome.call('Browser.close').catch(error => { closeEvidence.requestErrorCode = safeErrorCode(error, 'TEST_CHROME_CLOSE_REQUEST_FAILED'); });
        if (pipeEof === 'after-ack') {
          closeEvidence.phase = 'close-acknowledgement';
          await until(() => closeEvidence.acknowledged || child.exitCode !== null || closeEvidence.requestErrorCode, 'NORMAL_CHROME_CLOSE_ACK_TIMEOUT', 30000);
          if (child.exitCode === null && !closeEvidence.acknowledged) throw new Error(closeEvidence.requestErrorCode ?? 'NORMAL_CHROME_CLOSE_ACK_NOT_RECEIVED');
        }
        endClosePipe(); closeEvidence.phase = 'actual-child-exit';
        await until(() => child.exitCode !== null, 'NORMAL_CHROME_CLOSE_TIMEOUT', Math.max(1, observationBudgetMs - (Date.now() - closeEvidence.startedAtMs)));
        await requested;
      }
      closeEvidence.exitCode = child.exitCode; closeEvidence.signal = child.signalCode;
      ensure(child.exitCode === 0 && child.signalCode === null, 'NORMAL_CHROME_EXIT_NONZERO');
      closeEvidence.elapsedMs = Date.now() - closeEvidence.startedAtMs;
      closeEvidence.phase = 'exit-verified'; return closeEvidence;
    } catch (error) {
      closeEvidence.elapsedMs = Date.now() - closeEvidence.startedAtMs;
      closeEvidence.closeErrorCode = safeErrorCode(error, 'NORMAL_CHROME_CLOSE_HELPER_FAILED');
      closeEvidence.exitCode = child.exitCode; closeEvidence.signal = child.signalCode;
      try { closeEvidence.ownedProcessState = await system('processes', root); }
      catch (inspectionError) { closeEvidence.processInspectionErrorCode = safeErrorCode(inspectionError, 'CHROME_PROCESS_INSPECTION_FAILED'); }
      const failure = new Error(closeEvidence.closeErrorCode); failure.details = closeEvidence; failure.fixtureChrome = chrome; throw failure;
    } finally { endClosePipe(); }
  } };
  try {
    chrome.version = (await chrome.call('Browser.getVersion')).product;
    chrome.extensionId = (await chrome.call('Extensions.loadUnpacked', { path: join(repo, 'apps/extension/dist') })).id;
    const { targetId } = await chrome.call('Target.createTarget', { url: `chrome-extension://${chrome.extensionId}/options.html` });
    const { sessionId } = await chrome.call('Target.attachToTarget', { targetId, flatten: true });
    await chrome.call('Runtime.enable', {}, sessionId);
    chrome.evaluate = async expression => {
      const result = await chrome.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      ensure(!result.exceptionDetails, 'EXTENSION_EVALUATION_FAILED'); return result.result.value;
    };
    await until(() => chrome.evaluate('!!document.querySelector("#pairing-code")'), 'EXTENSION_OPTIONS_TIMEOUT');
    return chrome;
  } catch (error) { error.fixtureChrome = chrome; throw error; }
}
