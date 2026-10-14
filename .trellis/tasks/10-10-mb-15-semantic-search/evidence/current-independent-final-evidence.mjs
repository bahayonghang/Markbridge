// Read-only cross-receipt verification; never launches native apps, models or installers.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { nativeReleaseContext, inspectNativeArtifact } from '../../../../scripts/native-build.mjs';
import { repo, assertSubdir } from '../../10-10-mb-13-windows-acceptance/evidence/current-native-driver.mjs';

const e13 = resolve(import.meta.dirname, '../../10-10-mb-13-windows-acceptance/evidence');
const run = '3ee4f8c0-0010-4ecf-a83c-627a3397746d', attempt = 'eee73eda-be7a-4238-a2be-18def7195915';
const restoreId = '2f88d68b-7221-4cad-86ca-9e8ad73983a1', perfId = '6c7edb60-a8b9-42fa-ac40-0144aba261f8';
const sha = data => createHash('sha256').update(data).digest('hex');
const read = async name => { const bytes = await readFile(resolve(e13, name)); return { value: JSON.parse(bytes), sha256: sha(bytes) }; };
const plan = await read(`current-installer-${run}-plan.json`);
const raw = await read(`current-installer-${run}-${attempt}-receipt.json`);
const completion = await read(`current-installer-${run}-${attempt}-completion.json`);
const restore = await read(`current-installer-${run}-${restoreId}-registry-restore.json`);
const perf = await read(`current-performance-${perfId}-receipt.json`);
const r = raw.value, p = perf.value, exeHash = '4fcf7fcd506ad60eac1798c2a4c0ed9f80888648f7a5050ec41e6d47c67ff707';
const absent = facts => assert.deepEqual(facts, { processes: [], listeners: [] });
const closed = facts => {
  assert.equal(facts.exitCode, 0); assert.equal(facts.signal, null);
  assert.deepEqual(facts.knownWebviewAbsence.presentPids, []); assert.deepEqual(facts.knownWebviewAbsence.reusedPids, []);
  assert.equal(facts.knownWebviewAbsence.observations.length, facts.knownWebviewIdentities.length);
  for (const identity of facts.knownWebviewIdentities) assert(facts.knownWebviewAbsence.observations.some(row => row.pid === identity.pid && row.creationUtcTicks === identity.creationUtcTicks && row.state === 'absent'));
};

assert.equal(r.status, 'PASS'); assert.deepEqual(r.errors, []);
assert.equal(r.controls.length, 11); assert(r.controls.every(item => item.status === 'PASS'));
assert.equal(r.runId, run); assert.equal(r.attemptId, attempt); assert.equal(r.plan, `current-installer-${run}-plan.json`);
assert.equal(completion.value.status, 'PASS'); assert.equal(restore.value.status, 'PASS');
assert.equal(restore.value.planFacts.sha256, plan.sha256); assert.equal(restore.value.completedRunFacts.sha256, raw.sha256);
assert.equal(basename(completion.value.nativeRunReceipt), `current-installer-${run}-${attempt}-receipt.json`);
assert.equal(basename(completion.value.registryRestoreReceipt), `current-installer-${run}-${restoreId}-registry-restore.json`);
assert.equal(r.executableFacts.sha256, exeHash); assert.deepEqual(r.executableFacts, plan.value.executableFacts);
assert.deepEqual(r.installerFacts, plan.value.installerFacts);
assert.equal(r.install.exitCode, 0); assert.equal(r.uninstall.exitCode, 0);
assert.equal(r.preflight.registration, null); assert.deepEqual(r.preflight.keys, []); assert.equal(r.preflight.runPresent, false);
assert.deepEqual(r.semanticDefault, { enabled: false, endpointLabel: null, model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 });
assert.equal(r.diagnostics.schemaVersion, 8); assert.equal(r.diagnostics.formatVersion, 1); assert.equal(r.diagnostics.connections.live, 2);
const main = await readFile(resolve(repo, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
const commands = main.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)[1].split(',').map(name => name.trim()).filter(Boolean);
assert.equal(commands.length, 80); assert.equal(r.previewCommandDenials.length, 80);
assert.deepEqual(r.previewCommandDenials.map(item => item.name).sort(), [...commands].sort()); assert(r.previewCommandDenials.every(item => item.outcome === 'DENIED'));
assert.equal(r.previewOsDirectories.length, 3);
for (const evidence of [r.mainDataEvidence, ...r.previewOsDirectories]) assert(evidence.mainDirectoryExists && evidence.observations.every(row => row.insideFixture && row.observedDirectoryExists && row.parent === evidence.owner && (row.expectedMain || row.expectedPreview)));
const snapshots = r.previewSyntheticSnapshots;
assert(snapshots.every(item => item.main === null)); assert.equal(new Set(snapshots.filter(item => item.kind === 'hello').map(item => item.pageId)).size, 3);
assert.equal(snapshots.at(-1).local, 'MB13-preview-A'); assert.equal(snapshots.at(-1).cookie, 'r08=MB13-preview-A');
const comparison = r.restartComparison;
assert.equal(comparison.comparisonMethodVersion, 2); assert.equal(comparison.afterAppRestart.fullHistoryEqual, true);
assert(comparison.afterReconnect.rawBEqual && comparison.afterReconnect.fullHistoryEqual && comparison.afterReconnect.noReplayEqual);
assert(comparison.afterReconnect.rawAEqual || (comparison.afterReconnect.rootDateAddedProof.onlySyntheticRootDateAddedChanged && comparison.afterReconnect.rootDateAddedProof.exactFullJsonAfterOnlyRootDateAddedReplacement));
closed(r.firstExit); closed(r.finalExit);
for (const chrome of [r.chromeClose, ...r.finalChromeExits]) assert(chrome.exitCode === 0 && chrome.signal === null && chrome.childExitObserved && chrome.observationBudgetMs === 180000 && chrome.elapsedMs <= 180000);
absent(r.beforeUninstallProcesses); absent(r.finalProcesses);
assert.deepEqual(r.retainedBeforeUninstall, r.retainedAfterUninstall); assert.deepEqual(restore.value.data, r.retainedAfterUninstall);
assert.equal(restore.value.finalRegistration.registration, null); assert.deepEqual(restore.value.finalRegistration.keys, []); assert.equal(restore.value.finalRegistration.runPresent, false);
assert.equal(r.realModel.status, 'NOT_RUN'); assert.equal(r.floccus.status, 'UNVERIFIED'); assert.deepEqual(r.sleep, { acceptance: 'WAIVED', execution: 'NOT_RUN' });

assert.equal(p.status, 'PASS'); assert.deepEqual(p.errors, []); assert.equal(p.pageErrorCount, 0); assert.equal(p.executableSha256, exeHash);
assert.equal(p.measurementMethodVersion, 2); assert.equal(p.coldMs.length, 3); assert.equal(p.searchMs.length, 30); assert.equal(p.launches.length, 4); assert.equal(p.closes.length, 4);
assert(p.coldMs.every(value => Number.isFinite(value) && value <= 3000 && value >= 0)); assert(p.searchMs.every(value => Number.isFinite(value) && value >= 0));
assert.deepEqual(p.fixture, { seed: 20261010, bookmarks: 10000, folders: 1000, maxDepth: 20, nodes: 11004, initialFolderId: '0', rootChildren: 3 });
const milestones = ['cdpTargetSeen', 'cdpConnectStarted', 'cdpConnected', 'headingSeen', 'domReady'];
for (let i = 0; i < 4; i++) {
  const launch = p.launches[i], close = p.closes[i], owner = launch.readonlyStartupOwnershipProof;
  assert.equal(close.normalExit.pid, launch.pid); closed(close.normalExit); absent(close.processes);
  assert.equal(owner.appPid, launch.pid); assert(owner.listenerOwned && owner.appExecutableMatched && owner.directWebviewChild && owner.pageOriginTrusted && owner.exactMainDirectoryVerified);
  assert(launch.mainDataEvidence.observations.some(row => row.pid === owner.webviewPid && row.parent === launch.pid && row.expectedMain && row.insideFixture && row.observedDirectoryExists));
  assert.equal(launch.startupMilestonesMonotonicMs.domReady, launch.readonlyStartupCandidateMonotonicMs);
  assert(Math.abs(launch.observedOperableMs - (launch.readonlyStartupCandidateMonotonicMs - launch.preSpawnMonotonicMs)) < 1e-7);
  assert(launch.mainOsGuardVerifiedMs >= launch.observedOperableMs && launch.allStartupChecksReturnedMs >= launch.mainOsGuardVerifiedMs);
  let previous = launch.preSpawnMonotonicMs;
  for (const name of milestones) { const clock = launch.startupMilestonesMonotonicMs[name]; assert(Number.isFinite(clock) && clock >= previous); assert(Math.abs(launch.startupMilestonesElapsedMs[name] - (clock - launch.preSpawnMonotonicMs)) < 1e-7); previous = clock; }
  if (i < 3) assert.equal(p.coldMs[i], launch.observedOperableMs);
}
for (const [values, stored] of [[p.coldMs, p.cold], [p.searchMs, p.warm]]) { const sorted = [...values].sort((a, b) => a - b); assert.equal(stored.p50, sorted[Math.ceil(values.length * 0.5) - 1]); assert.equal(stored.p95, sorted[Math.ceil(values.length * 0.95) - 1]); assert.equal(stored.max, sorted.at(-1)); }
assert(p.warm.p95 <= 200 && Number.isFinite(p.warmupMs)); assert.equal(p.model, 'NOT_RUN');

const release = nativeReleaseContext(repo);
assert.equal(plan.value.releaseExecutable, release.artifact); assert.equal(plan.value.packedExecutable, resolve(plan.value.root, 'packed/markbridge-desktop.exe'));
await assertSubdir(plan.value.root, dirname(plan.value.packedExecutable), 'packed');
const releaseBytes = await readFile(release.artifact), packedBytes = await readFile(plan.value.packedExecutable), installerBytes = await readFile(plan.value.installer);
inspectNativeArtifact(releaseBytes, release); inspectNativeArtifact(packedBytes, release);
assert.equal(sha(releaseBytes), exeHash); assert(releaseBytes.equals(packedBytes)); assert.equal(sha(installerBytes), r.installerFacts.sha256);
const summary = { status: 'PASS', executableSha256: exeHash, installerSha256: sha(installerBytes), rawSha256: raw.sha256, completionSha256: completion.sha256, restoreSha256: restore.sha256, performanceSha256: perf.sha256, remoteDeniedCommands: 80, coldMs: p.coldMs, warm: p.warm, modelQuality: 'NOT_RUN', platforms: 'macOS/Linux NOT_RUN' };
await writeFile(resolve(import.meta.dirname, 'current-independent-final-evidence.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
