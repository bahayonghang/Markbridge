// Native preview-host security checks. Profile names are synthetic IPC fixture IDs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, evidence, fixtureRoot, launch, cleanCredentials, until, ensure } from './native-driver.mjs';
import { startProbe } from './native-probe.mjs';
import { watchFocus } from './native-focus.mjs';
const run = promisify(execFile), runId = randomUUID().slice(0, 8);
const report = { runId, mode: process.argv[2] ?? 'final', startedAt: new Date().toISOString(), scope: 'Actual isolated Tauri preview-* with synthetic profile IDs; trusted host calls are real IPC, remote probes run their own page scripts', controls: [], errors: [] };
let app, probe, stage = 'prepare', request = 0;
const pass = (control, facts = {}) => { report.controls.push({ control, status: 'PASS', ...facts }); console.log(JSON.stringify({ control, status: 'PASS' })); };
const state = () => app.invoke('web_preview_state');
const action = action => app.invoke('web_preview_action', { action });
const open = async (profileId, path) => {
  // Keep even a failed download guard inside this disposable fixture directory.
  const preferences = join(report.isolationRoot, 'app-data', 'preview-sessions', Buffer.from(profileId).toString('hex'), 'EBWebView', 'Default', 'Preferences');
  if (!await access(preferences).then(() => true, () => false)) {
    const downloads = join(report.isolationRoot, 'downloads');
    await mkdir(downloads, { recursive: true });
    await mkdir(join(preferences, '..'), { recursive: true });
    await writeFile(preferences, JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
  }
  return app.invoke('open_web_preview', { profileId, chromeId: '1', requestId: `r05-native-${++request}`, url: `${probe.base}${path}` });
};
async function printWindow(title, name, activate = false) {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'native-print-window.ps1'), '-ProcessId', String(app.child.pid), '-TitleLike', title, '-OutPath', join(evidence, 'native-screenshots', `${runId}-${name}.png`), ...(activate ? ['-Activate'] : [])], { windowsHide: true, timeout: 20000 }).catch(error => {
    report.windowHelperError = String(error.stderr ?? '').slice(0, 1200); throw new Error('WINDOW_HELPER_FAILURE');
  });
  ensure(stdout.includes('PRINT_OK=True'), 'WINDOW_CAPTURE_FAILED');
  return { hwnd: stdout.match(/HWND=(\d+)/)?.[1], foreground: stdout.includes('FG_SAME=True') };
}
try {
  report.environment = await environment(); report.isolationRoot = await fixtureRoot();
  probe = await startProbe(); app = await launch(report.isolationRoot); report.webview = app.webview;
  app.page.on('pageerror', () => report.errors.push('MAIN_PAGE_ERROR'));
  await app.resize(1100, 760);
  report.viewport = await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  await app.page.evaluate(() => localStorage.setItem('r05-main', 'main-only'));
  const focus = await watchFocus(app, runId);
  const mainWindow = focus.mainWindow;
  report.mainWindow = mainWindow;
  ensure(mainWindow.foreground, 'TEST_MAIN_WINDOW_NOT_ACTIVE');
  stage = 'isolated-window';
  await open('r05-profile-a', '/a');
  const a = await probe.hello('/a');
  await until(async () => (await state()).phase === 'ready', 'PREVIEW_NOT_READY');
  const previewWindow = await printWindow('网页预览', 'remote-ready');
  report.windows = { mainWindow, previewWindow };
  ensure(mainWindow.hwnd && previewWindow.hwnd && mainWindow.hwnd !== previewWindow.hwnd, 'WINDOW_NOT_SEPARATE');
  report.focusObservation = await focus.result();
  report.focusObserved = report.focusObservation.observed;
  if (!report.focusObserved) report.errors.push('PREVIEW_FOREGROUND_NOT_OBSERVED');
  ensure(a.main === null && a.local === null && a.cookie === '', 'NEW_PREVIEW_SESSION_NOT_ISOLATED');
  ensure(await app.page.locator('#r05-probe').count() === 0, 'REMOTE_HTML_IN_TRUSTED_DOM');
  ensure((await app.invoke('get_bridge_state')).profiles.length === 0, 'MAIN_IPC_INVALID');
  pass('separate_window_and_main_storage_dom_isolation', { mainWindow, previewWindow });

  stage = 'ipc-denials';
  const denied = await probe.job('invoke');
  ensure(denied.results.length === probe.commands.length && denied.results.every(row => row.outcome === 'DENIED' || row.outcome === 'NO_IPC'), 'REMOTE_IPC_NOT_DENIED');
  pass('all_registered_app_commands_denied_to_remote_page', { commands: denied.results });

  stage = 'history';
  await probe.job('store', { value: 'a-value' });
  let since = probe.reports.length;
  await probe.job('go', { path: '/a2' }); await probe.hello('/a2', since);
  await until(async () => (await state()).canGoBack, 'BACK_NOT_ENABLED');
  since = probe.reports.length; await action('back'); await probe.hello('/a', since);
  await until(async () => (await state()).canGoForward, 'FORWARD_NOT_ENABLED');
  since = probe.reports.length; await action('forward'); await probe.hello('/a2', since);
  since = probe.reports.length; await action('reload'); await probe.hello('/a2', since);
  pass('actual_preview_history_back_forward_reload');

  stage = 'navigation-guards';
  for (const [job, notice] of [['scheme', 'SCHEME_DENIED'], ['file', 'SCHEME_DENIED'], ['userinfo', 'USERINFO_DENIED'], ['popup', 'POPUP_BLOCKED'], ['download', 'DOWNLOAD_BLOCKED']]) {
    // Reopen the valid page to reset the preceding notice.
    since = probe.reports.length; await open('r05-profile-a', '/a'); await probe.hello('/a', since);
    await until(async () => (await state()).phase === 'ready', 'GUARD_PAGE_NOT_READY');
    report.lastNavigationProbe = job;
    await probe.job(job);
    try {
      await until(async () => { const next = await state(); report.lastNavigationNotice = next.notice; return next.notice === notice; }, `NOTICE_${notice}_MISSING`, 8000);
      pass(`navigation_guard_${job}`);
    } catch { report.errors.push(`NOTICE_${notice}_MISSING`); }
  }
  ensure(!probe.reports.some(row => row.kind === 'hello' && ['/popup','/userinfo'].includes(row.path)), 'BLOCKED_PAGE_LOADED');
  ensure((await readdir(join(report.isolationRoot, 'downloads'))).length === 0, 'PREVIEW_DOWNLOAD_WAS_SAVED');
  pass('blocked_popup_userinfo_pages_never_load_and_no_saved_download');

  stage = 'profile-sessions';
  await action('close');
  const beforeCloseDirs = await readdir(join(report.isolationRoot, 'app-data', 'preview-sessions'));
  ensure(beforeCloseDirs.length === 1, 'PREVIEW_SESSION_NOT_RETAINED');
  since = probe.reports.length; await open('r05-profile-a', '/a');
  const reopened = await probe.hello('/a', since);
  ensure(reopened.local === 'a-value' && reopened.cookie.includes('r05=a-value'), 'CLOSE_LOST_SESSION');
  since = probe.reports.length; await open('r05-profile-b', '/b');
  const b = await probe.hello('/b', since);
  ensure(b.local === null && b.cookie === '' && b.main === null, 'PROFILE_B_INHERITED_A');
  await probe.job('store', { value: 'b-value' });
  await action('close');
  await app.invoke('clear_web_preview_session', { profileId: 'r05-profile-a', requestId: `r05-native-${++request}` });
  since = probe.reports.length; await open('r05-profile-a', '/a');
  const clearedA = await probe.hello('/a', since);
  ensure(clearedA.local === null && clearedA.cookie === '', 'PROFILE_A_NOT_CLEARED');
  since = probe.reports.length; await open('r05-profile-b', '/b');
  const retainedB = await probe.hello('/b', since);
  ensure(retainedB.local === 'b-value' && retainedB.cookie.includes('r05=b-value'), 'CLEAR_A_CHANGED_B');
  ensure(await app.page.evaluate(() => localStorage.getItem('r05-main')) === 'main-only', 'PREVIEW_CHANGED_MAIN_STORAGE');
  pass('close_keeps_session_and_clear_is_scoped_to_selected_profile');

  stage = 'failed-page';
  await app.invoke('open_web_preview', { profileId: 'r05-profile-a', chromeId: 'failed', requestId: `r05-native-${++request}`, url: 'http://127.0.0.1:1/r05-fail' });
  await until(async () => (await state()).phase === 'failed', 'FAILED_PAGE_STATE_MISSING');
  pass('unreachable_page_reports_failure');
  ensure(report.errors.length === 0, 'RECORDED_CHECK_FAILURES'); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failureCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'NATIVE_ASSERTION_OR_ACTION_FAILED';
  process.exitCode = 1;
} finally {
  if (app) {
    await action('close').catch(() => {});
    try { await cleanCredentials(app); report.temporaryCredentialsRemoved = true; } catch { report.temporaryCredentialsRemoved = false; report.status = 'FAIL'; process.exitCode = 1; }
    await app.close();
  }
  if (probe) { report.probePaths = probe.hits; report.loadedProbePages = probe.reports.filter(row => row.kind === 'hello').map(row => row.path); await probe.close(); }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, `native-web-${runId}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failedStage: report.failedStage, failureCode: report.failureCode }));
}
