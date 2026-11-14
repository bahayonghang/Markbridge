// Copied current release, synthetic preview identities only. No Chrome, installer or model.
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, evidence, ensure, launchInstalled, safeErrorCode, system, until, startProbe } from './current-native-driver.mjs';

ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
ensure(process.argv.slice(2).every(arg => ['--production-length', '--legacy-roundtrip'].includes(arg)) && process.argv.length <= 4, 'USE_OPTIONAL_PRODUCTION_LENGTH_OR_LEGACY_ROUNDTRIP_ONLY');
const productionLength = process.argv.includes('--production-length');
const legacyRoundtrip = process.argv.includes('--legacy-roundtrip');
const run = promisify(execFile);
const profileA = productionLength ? `p:${'a'.repeat(64)}` : 'task13-preview-A';
const profileB = productionLength ? `p:${'b'.repeat(64)}` : 'task13-preview-B';
const bytes = await readFile(nativeReleaseContext(repo).artifact); inspectNativeArtifact(bytes);
const runId = randomUUID(), root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
await mkdir(join(root, 'install')); await mkdir(join(root, 'app-data'));
const executable = join(root, 'install/markbridge-desktop.exe');
await copyFile(nativeReleaseContext(repo).artifact, executable);
const plan = { root, executable, installDirectory: join(root, 'install'), appData: join(root, 'app-data'),
  namespace: `Markbridge.Task06.preview-${runId}` };
const report = { kind: 'copied_release_synthetic_preview_persistence_probe', runId, root,
  executableSha256: createHash('sha256').update(bytes).digest('hex'), startedAt: new Date().toISOString(),
  installation: 'NOT_RUN', chrome: 'NOT_RUN', model: 'NOT_RUN', diagnosticLifetimeObserver: false,
  identityVariant: productionLength ? 'production-length-synthetic' : 'short-synthetic', profileIdLength: profileA.length,
  legacyRoundtrip,
  snapshots: [], openings: [], closures: [], errors: [], status: 'RUNNING' };
let app, probe, stage = 'launch-main';
try {
  app = await launchInstalled(plan); report.mainDataEvidence = app.mainDataEvidence;
  probe = await startProbe();
  const open = async (profileId, path) => {
    const since = probe.reports.length;
    await app.invoke('open_web_preview', { profileId, chromeId: 'synthetic-bookmark', requestId: `probe-${randomUUID()}`, url: `${probe.base}${path}` });
    await until(async () => (await app.invoke('web_preview_state')).phase === 'ready', 'PREVIEW_NOT_READY');
    const page = await probe.hello(path, since);
    const os = await until(async () => {
      const result = await app.inspectData(profileId);
      return result.observations.some(row => row.expectedPreview && row.observedDirectoryExists) ? result : null;
    }, 'PREVIEW_OS_PROFILE_DIRECTORY_NOT_OBSERVED');
    report.openings.push({ profile: profileId, page, os });
    return page;
  };
  const snapshot = async (page, action, value) => {
    const reply = await probe.job(page, action, value ? { value } : {});
    report.snapshots.push({ stage, ...reply }); return reply;
  };
  const close = async profileId => {
    const before = await app.inspectData(profileId);
    const known = before.observations.filter(row => row.expectedPreview).map(row => ({ pid: row.pid, creationUtcTicks: row.creationUtcTicks }));
    ensure(known.length === 1, 'PREVIEW_BROWSER_OWNER_AMBIGUOUS');
    await app.invoke('web_preview_action', { action: 'close' });
    await until(async () => (await app.invoke('web_preview_state')).phase === 'closed', 'PREVIEW_NOT_CLOSED');
    const absence = await until(async () => {
      const observed = await system('known-webview-presence', root, ['-KnownProcessIdentities', JSON.stringify(known)]);
      return observed.presentPids.length === 0 ? observed : null;
    }, 'CLOSED_PREVIEW_BROWSER_PROCESS_REMAINED');
    report.closures.push({ profile: profileId, knownBrowserPids: known.map(identity => identity.pid), knownBrowserIdentities: known, absence });
  };
  stage = 'A-store'; let pageA = await open(profileA, '/a');
  const first = await snapshot(pageA, 'store', 'MB13-preview-A');
  ensure(first.local === 'MB13-preview-A' && first.cookie.includes('MB13-preview-A'), 'PREVIEW_STORE_NOT_OBSERVED');
  stage = 'A-same-window-reload';
  const since = probe.reports.length;
  await app.invoke('web_preview_action', { action: 'reload' });
  pageA = await probe.hello('/a', since);
  const reload = await snapshot(pageA, 'read');
  ensure(reload.local === 'MB13-preview-A' && reload.cookie.includes('MB13-preview-A'), 'SAME_WINDOW_RELOAD_LOST_SESSION');
  stage = 'A-close'; await close(profileA);
  stage = 'A-immediate-reopen'; pageA = await open(profileA, '/a');
  const immediate = await snapshot(pageA, 'read');
  report.immediateReopenRestored = immediate.local === 'MB13-preview-A' && immediate.cookie.includes('MB13-preview-A');
  stage = 'A-close-again'; await close(profileA);
  stage = 'B-store'; const pageB = await open(profileB, '/b');
  ensure(pageB.local === null && !pageB.cookie.includes('MB13-preview-A'), 'PREVIEW_PROFILES_SHARE_SESSION');
  await snapshot(pageB, 'store', 'MB13-preview-B');
  stage = 'B-close'; await close(profileB);
  stage = 'A-after-B-reopen'; pageA = await open(profileA, '/a');
  const afterB = await snapshot(pageA, 'read');
  report.afterBRestored = afterB.local === 'MB13-preview-A' && afterB.cookie.includes('MB13-preview-A') && !afterB.cookie.includes('MB13-preview-B');
  stage = 'last-preview-close'; await close(profileA);
  if (legacyRoundtrip) {
    stage = 'closed-A-legacy-seed';
    const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      join(evidence, 'current-preview-legacy-seed.ps1'), '-IsolationRoot', root, '-ProfileId', profileA,
      '-AppProcessId', String(app.child.pid)],
      { windowsHide: true, timeout: 30000 });
    report.legacySeed = JSON.parse(stdout.trim());
    ensure(report.legacySeed.seeded && report.legacySeed.sourceAbsent && report.legacySeed.legacyPresent, 'LEGACY_SEED_NOT_CONFIRMED');
    stage = 'A-legacy-migration-reopen'; pageA = await open(profileA, '/a');
    const migrated = await snapshot(pageA, 'read');
    report.legacyMigrationRestored = migrated.local === 'MB13-preview-A' && migrated.cookie.includes('MB13-preview-A') && !migrated.cookie.includes('MB13-preview-B');
    stage = 'migrated-preview-close'; await close(profileA);
    ensure(report.legacyMigrationRestored, 'LEGACY_PREVIEW_SESSION_NOT_RESTORED');
  }
  ensure(report.immediateReopenRestored && report.afterBRestored, 'PROFILE_A_PREVIEW_SESSION_NOT_RESTORED');
  report.status = 'PASS';
} catch (error) {
  app ??= error.fixtureApp; report.status = 'FAIL'; report.failedStage = stage;
  report.errors.push(safeErrorCode(error, 'PREVIEW_PERSISTENCE_PROBE_FAILED')); process.exitCode = 1;
} finally {
  if (app) {
    try { report.normalExit = await app.close(); }
    catch (error) { report.status = 'FAIL'; report.errors.push(safeErrorCode(error, 'NORMAL_APP_CLOSE_FAILED')); report.closeEvidence = error.details ?? app.lastCloseEvidence ?? null; process.exitCode = 1; }
    report.previewProbeEvents = [...(app.previewProbeEvents ?? [])];
  }
  if (probe) await probe.close();
  try { report.finalProcesses = await until(async () => {
    const observed = await system('processes', root); report.lastProcesses = observed;
    return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null;
  }, 'PREVIEW_PROBE_PROCESS_OR_LISTENER_REMAINED'); }
  catch { report.status = 'FAIL'; report.errors.push('PREVIEW_PROBE_PROCESS_OR_LISTENER_REMAINED'); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  const path = join(evidence, `current-preview-persistence-${runId}-receipt.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt: path, errors: report.errors,
    immediateReopenRestored: report.immediateReopenRestored, afterBRestored: report.afterBRestored, previewProbeEvents: report.previewProbeEvents }));
}
