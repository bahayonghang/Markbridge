// Chrome-only close ordering comparison; no installer, app, pairing or bookmark writes.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRoot, evidence, ensure, extensionHash, launchChrome, safeErrorCode, system, until } from './current-native-driver.mjs';

const [mode, chromeExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe'] = process.argv.slice(2);
ensure(process.platform === 'win32' && ['baseline', 'after-ack'].includes(mode) && process.argv.length <= 4, 'USE_WINDOWS_CHROME_CLOSE_PROBE_BASELINE_OR_AFTER_ACK');
const runId = randomUUID(), root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
await assertRoot(root);
await writeFile(join(root, 'task13-chrome-close-probe.json'), JSON.stringify({ runId, mode }) + '\n', { flag: 'wx' });
const report = { kind: 'disposable_chrome_close_order_probe_only', runId, mode, root, startedAt: new Date().toISOString(),
  installation: 'NOT_RUN', noApplicationOrPairingOrBookmarkWrites: true, extensionSha256: await extensionHash(), errors: [] };
let chrome;
try {
  chrome = await launchChrome(root, 'chrome-a', chromeExecutable);
  report.chromeVersion = chrome.version;
  report.beforeCloseProcesses = await system('processes', root);
  ensure(report.beforeCloseProcesses.processes.some(row => row.pid === chrome.child.pid), 'PROBE_OWNED_CHROME_PID_NOT_OBSERVED');
  report.normalExit = await chrome.close({ pipeEof: mode === 'after-ack' ? 'after-ack' : 'immediate', observationBudgetMs: 45000 });
  report.status = 'PASS';
} catch (error) {
  chrome ??= error.fixtureChrome;
  report.closeErrorCode = safeErrorCode(error, 'CHROME_CLOSE_PROBE_FAILED');
  report.closeEvidence = error.details ?? chrome?.lastCloseEvidence ?? null;
  report.status = 'FAIL'; report.errors.push(report.closeErrorCode); process.exitCode = 1;
} finally {
  if (chrome && !chrome.lastCloseEvidence) {
    try { report.startupFailureTeardown = await chrome.close({ pipeEof: mode === 'after-ack' ? 'after-ack' : 'immediate', observationBudgetMs: 45000 }); }
    catch (error) { report.closeEvidence = error.details ?? chrome.lastCloseEvidence ?? null; report.errors.push(safeErrorCode(error, 'CHROME_STARTUP_FAILURE_TEARDOWN_FAILED')); }
  }
  // A late exit can establish stopped fixtures, but cannot upgrade a failed close assertion.
  try {
    report.finalProcesses = await until(async () => {
      const observed = await system('processes', root); report.lastProcesses = observed;
      return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null;
    }, 'CHROME_PROBE_OWNED_PROCESS_OR_LISTENER_REMAINED', 30000);
  } catch (error) {
    report.status = 'FAIL'; report.errors.push(safeErrorCode(error, 'CHROME_PROBE_PROCESS_CHECK_FAILED')); process.exitCode = 1;
  }
  report.lastObservedChild = chrome ? { pid: chrome.child.pid, exitCode: chrome.child.exitCode, signal: chrome.child.signalCode } : null;
  report.closeEvidence ??= chrome?.lastCloseEvidence ?? null;
  report.finishedAt = new Date().toISOString();
  const receipt = join(evidence, `current-chrome-close-${mode}-${runId}-receipt.json`);
  await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt, mode, closeErrorCode: report.closeErrorCode,
    closeEvidence: report.closeEvidence, lastObservedChild: report.lastObservedChild, errors: report.errors }));
}
