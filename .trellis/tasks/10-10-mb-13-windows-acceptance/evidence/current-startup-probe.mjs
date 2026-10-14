// Isolated copied-release startup only: no installer, pairing, UI actions, model or preview.
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, evidence, ensure, launchInstalled, safeErrorCode, system, until } from './current-native-driver.mjs';

ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
const releaseExecutable = nativeReleaseContext(repo).artifact;
const args = process.argv.slice(2), nativeProbe = args.includes('--stages');
const requestedExecutable = args.filter(value => value !== '--stages');
ensure(requestedExecutable.length <= 1 && args.length === requestedExecutable.length + Number(nativeProbe), 'USE_OPTIONAL_STAGES_AND_ONLY_CURRENT_RELEASE_EXECUTABLE');
ensure(resolve(requestedExecutable[0] ?? releaseExecutable) === releaseExecutable, 'ONLY_CURRENT_RELEASE_EXECUTABLE_ACCEPTED');
const bytes = await readFile(releaseExecutable); inspectNativeArtifact(bytes);
const runId = randomUUID(), root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
await mkdir(join(root, 'install')); await mkdir(join(root, 'app-data'));
const executable = join(root, 'install/markbridge-desktop.exe'); await copyFile(releaseExecutable, executable);
const plan = { root, executable, installDirectory: join(root, 'install'), appData: join(root, 'app-data'), namespace: `Markbridge.Task06.startup-${runId}`, nativeProbe };
const report = { kind: 'copied_release_startup_os_isolation_probe_only', runId, root, startedAt: new Date().toISOString(),
  executableSha256: createHash('sha256').update(bytes).digest('hex'), noPairingOrUiActions: true, stageProbeEnabled: nativeProbe, installation: 'NOT_RUN', errors: [] };
let app;
try {
  app = await launchInstalled(plan); report.osDataEvidence = app.mainDataEvidence;
  ensure(report.osDataEvidence.mainDirectoryExists && report.osDataEvidence.observations.every(row => row.expectedMain && row.insideFixture && row.observedDirectoryExists), 'STARTUP_OS_MAIN_DIRECTORY_MISMATCH');
  report.status = 'PASS';
} catch (error) { app = error.fixtureApp; report.osDataEvidence = app?.lastDataEvidence ?? null; report.status = 'FAIL';
  report.startupErrorCode = safeErrorCode(error, 'STARTUP_PROBE_FAILED'); report.errors.push(report.startupErrorCode); process.exitCode = 1; }
finally {
  if (app) { try { report.normalExit = await app.close(); } catch (error) {
    report.normalCloseErrorCode = safeErrorCode(error, 'STARTUP_NORMAL_CLOSE_FAILED'); report.normalCloseEvidence = error.details ?? app.lastCloseEvidence ?? null;
    report.status = 'FAIL'; report.errors.push(report.normalCloseErrorCode); process.exitCode = 1; } }
  try { report.finalProcesses = await until(async () => { const observed = await system('processes', root); report.lastProcesses = observed; return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null; }, 'STARTUP_PROCESS_OR_LISTENER_REMAINED'); }
  catch { report.status = 'FAIL'; report.errors.push('STARTUP_PROCESS_OR_LISTENER_REMAINED'); process.exitCode = 1; }
  report.nativeStageOrder = [...(app?.nativeStages ?? [])];
  report.finishedAt = new Date().toISOString();
  const path = join(evidence, `current-startup-${runId}-receipt.json`); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt: path, osDataEvidence: report.osDataEvidence, normalExit: report.normalExit,
    startupErrorCode: report.startupErrorCode, normalCloseErrorCode: report.normalCloseErrorCode, normalCloseEvidence: report.normalCloseEvidence,
    nativeStageOrder: report.nativeStageOrder, errors: report.errors }));
}
