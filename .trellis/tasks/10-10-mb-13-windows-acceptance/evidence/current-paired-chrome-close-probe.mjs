// Compare copied-app/paired-Chrome shutdown order; no installer or bookmark-write commands.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { assertRoot, assertSubdir, cleanCredentials, evidence, ensure, extensionHash, launchChrome, launchInstalled,
  pair, repo, safeErrorCode, system, until } from './current-native-driver.mjs';

const [mode, chromeExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe'] = process.argv.slice(2);
ensure(process.platform === 'win32' && process.arch === 'x64' && ['bridge-open', 'app-first', 'live-paired', 'live-get-tree', 'live-aged', 'live-aged-concurrent', 'live-aged-headful', 'live-aged-observation'].includes(mode) && process.argv.length <= 4, 'USE_WINDOWS_PAIRED_CLOSE_MODE');
const keepCredentialsLive = mode.startsWith('live-');
const headful = mode === 'live-aged-headful';
const observationBudgetMs = mode === 'live-aged-observation' ? 180000 : 45000;
const bytes = await readFile(nativeReleaseContext(repo).artifact); inspectNativeArtifact(bytes);
const runId = randomUUID(), root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
await assertRoot(root); await mkdir(join(root, 'install')); await mkdir(join(root, 'app-data'));
const executable = join(root, 'install/markbridge-desktop.exe'); await writeFile(executable, bytes, { flag: 'wx' });
const plan = { root, executable, installDirectory: join(root, 'install'), appData: join(root, 'app-data'), namespace: `Markbridge.Task06.close-${runId}` };
await writeFile(join(root, 'task13-paired-close-probe.json'), JSON.stringify({ runId, mode }) + '\n', { flag: 'wx' });
const report = { kind: 'paired_disposable_chrome_socket_order_probe_only', runId, mode, root, startedAt: new Date().toISOString(),
  executableSha256: createHash('sha256').update(bytes).digest('hex'), extensionSha256: await extensionHash(),
  installation: 'NOT_RUN', noBookmarkWriteCommands: true, chromeMode: headful ? 'headful_offscreen' : 'headless',
  chromeCloseMethodVersion: observationBudgetMs === 45000 ? 1 : 2, chromeCloseObservationBudgetMs: observationBudgetMs,
  errors: [], chromeCloseResults: [] };
let app, credentialsRevoked = false;
const chromes = [];
const profileIds = [];
const fail = (error, phase) => { report.status = 'FAIL'; report.errors.push({ phase, code: safeErrorCode(error, 'PAIRED_CLOSE_PROBE_FAILED') }); process.exitCode = 1; };
const bridgeFacts = value => ({ listening: value.port !== null, profileCount: value.profiles.length,
  liveProfileCount: value.profiles.filter(profile => profile.connection === 'live').length, pendingPairCount: value.pending.length });
async function revokeFixtureCredentials() {
  await assertSubdir(root, plan.appData, 'app-data');
  const code = "import json,sqlite3,sys,pathlib; p=pathlib.Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); print(json.dumps([r[0] for r in c.execute('SELECT credential_reference FROM profiles WHERE credential_reference IS NOT NULL')])); c.close()";
  let references;
  try { const { stdout } = await promisify(execFile)('python', ['-c', code, join(plan.appData, 'markbridge.sqlite')], { windowsHide: true }); references = JSON.parse(stdout); }
  catch { throw new Error('FIXTURE_CREDENTIAL_REFERENCE_READ_FAILED'); }
  await cleanCredentials(app);
  for (const reference of references) ensure(!(await system('credential', root, ['-Namespace', plan.namespace, '-Reference', reference])).present, 'EXACT_TEST_CREDENTIAL_REMAINED');
  credentialsRevoked = true; report.credentialRevocation = { count: references.length, allExactTargetsAbsent: true };
}
async function closeChrome(chrome, index, concurrentSnapshot) {
  const startedAt = Date.now();
  const result = { index, appAliveBeforeClose: app.child.exitCode === null };
  if (result.appAliveBeforeClose && app.invoke) {
    try {
      if (concurrentSnapshot) {
        result.bridgeBeforeClose = concurrentSnapshot.bridge;
        result.targetProfileLiveBeforeClose = concurrentSnapshot.targetProfilesLive[index];
        result.liveEvidenceSource = 'actual_shared_snapshot_before_dispatch';
      } else {
        const state = await app.invoke('get_bridge_state'); result.bridgeBeforeClose = bridgeFacts(state);
        result.targetProfileLiveBeforeClose = state.profiles.some(profile => profile.profileId === profileIds[index] && profile.connection === 'live');
        result.liveEvidenceSource = 'actual_fresh_state_before_single_close';
      }
      if (keepCredentialsLive && !credentialsRevoked) {
        ensure(result.targetProfileLiveBeforeClose && (index !== 0 || result.bridgeBeforeClose.liveProfileCount === 2), 'LIVE_PAIR_NOT_OBSERVED_BEFORE_CLOSE');
      }
    }
    catch (error) { result.bridgeObservationErrorCode = safeErrorCode(error, 'PAIRED_BRIDGE_OBSERVATION_FAILED'); fail(error, `chrome-${index}-bridge-observation`); }
  }
  try { result.normalExit = await chrome.close({ observationBudgetMs }); }
  catch (error) { result.closeEvidence = error.details ?? chrome.lastCloseEvidence ?? null; fail(error, `chrome-${index}-close`); }
  result.elapsedMs = Date.now() - startedAt; report.chromeCloseResults.push(result);
}
try {
  app = await launchInstalled(plan); report.mainDataEvidence = app.mainDataEvidence;
  chromes.push(await launchChrome(root, 'chrome-a', chromeExecutable, { headful }));
  chromes.push(await launchChrome(root, 'chrome-b', chromeExecutable, { headful }));
  profileIds.push(await pair(app, chromes[0], 'MB13-close-probe-A')); profileIds.push(await pair(app, chromes[1], 'MB13-close-probe-B'));
  report.pairedBridge = bridgeFacts(await app.invoke('get_bridge_state'));
  ensure(report.pairedBridge.listening && report.pairedBridge.liveProfileCount === 2, 'TWO_DISPOSABLE_PAIRS_NOT_LIVE');
  report.credentialRevocationOrder = keepCredentialsLive ? 'after_chrome_close_attempts' : 'before_chrome_close_attempts';
  if (!keepCredentialsLive) {
    await revokeFixtureCredentials(); report.afterRevocationBridge = bridgeFacts(await app.invoke('get_bridge_state'));
    ensure(report.credentialRevocation.count === 2, 'PAIRED_TEST_CREDENTIAL_COUNT_MISMATCH');
    if (mode === 'bridge-open') ensure(report.afterRevocationBridge.listening, 'REVOKED_FIXTURE_LISTENER_NOT_OPEN');
    else report.normalAppExit = await app.close();
  }
  if (mode === 'live-get-tree') {
    const treeA = await chromes[0].evaluate('chrome.bookmarks.getTree()');
    const treeB = await chromes[1].evaluate('chrome.bookmarks.getTree()');
    report.preCloseTreeReads = { count: 2, sha256: [treeA, treeB].map(tree => createHash('sha256').update(JSON.stringify(tree)).digest('hex')) };
  }
  if (mode.startsWith('live-aged')) {
    const began = performance.now();
    for (let tick = 1; tick <= 40; tick++) {
      await new Promise(done => setTimeout(done, 1000));
      if (tick % 10 === 0) console.log(JSON.stringify({ phase: 'live-aged-wait', ticks: tick, elapsedMs: performance.now() - began }));
    }
    report.liveAgeDelta = { targetWaitMs: 40000, timerTickMs: 1000, observedWaitMs: performance.now() - began };
  }
  if (mode === 'live-aged-concurrent') {
    const state = await app.invoke('get_bridge_state');
    const concurrentSnapshot = Object.freeze({ bridge: Object.freeze(bridgeFacts(state)),
      targetProfilesLive: Object.freeze(profileIds.map(id => state.profiles.some(profile => profile.profileId === id && profile.connection === 'live'))) });
    report.concurrentBeforeClose = { ...concurrentSnapshot.bridge, targetProfilesLive: [...concurrentSnapshot.targetProfilesLive] };
    ensure(report.concurrentBeforeClose.listening && report.concurrentBeforeClose.liveProfileCount === 2 &&
      concurrentSnapshot.targetProfilesLive.length === 2 && concurrentSnapshot.targetProfilesLive.every(Boolean), 'CONCURRENT_TWO_LIVE_PAIRS_NOT_OBSERVED');
    await Promise.all(chromes.map((chrome, index) => closeChrome(chrome, index, concurrentSnapshot)));
  } else for (const [index, chrome] of chromes.entries()) await closeChrome(chrome, index);
  report.status ??= 'PASS';
} catch (error) {
  app ??= error.fixtureApp;
  if (error.fixtureChrome && !chromes.includes(error.fixtureChrome)) chromes.push(error.fixtureChrome);
  if (error.details) report.failureEvidence = error.details;
  fail(error, 'paired-close-probe');
} finally {
  if (app?.invoke && app.child.exitCode === null && !credentialsRevoked) {
    try { await revokeFixtureCredentials(); if (report.pairedBridge?.liveProfileCount === 2) ensure(report.credentialRevocation.count === 2, 'PAIRED_TEST_CREDENTIAL_COUNT_MISMATCH'); }
    catch (error) { fail(error, 'credential-revocation'); }
  }
  for (const [index, chrome] of chromes.entries()) if (!chrome.lastCloseEvidence) await closeChrome(chrome, index);
  if (app && !report.normalAppExit) {
    try { report.normalAppExit = await app.close(); } catch (error) { report.normalAppCloseEvidence = error.details ?? app.lastCloseEvidence ?? null; fail(error, 'normal-app-close'); }
  }
  try {
    report.finalProcesses = await until(async () => {
      const observed = await system('processes', root); report.lastProcesses = observed;
      return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null;
    }, 'PAIRED_PROBE_OWNED_PROCESS_OR_LISTENER_REMAINED', 30000);
  } catch (error) { fail(error, 'final-process-check'); }
  report.lastObservedChromeChildren = chromes.map(chrome => ({ pid: chrome.child.pid, exitCode: chrome.child.exitCode, signal: chrome.child.signalCode }));
  report.status ??= 'FAIL'; report.finishedAt = new Date().toISOString();
  const receipt = join(evidence, `current-paired-chrome-close-${mode}-${runId}-receipt.json`);
  await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt, mode, credentialRevocation: report.credentialRevocation,
    chromeCloseResults: report.chromeCloseResults, lastObservedChromeChildren: report.lastObservedChromeChildren, errors: report.errors }));
}
