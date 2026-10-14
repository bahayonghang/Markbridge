// Two-step approval boundary: prepare is read/extract only; run installs the pinned plan.
import { expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, version, release } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import validateDiagnostic from '../../../../packages/protocol/src/generated/diagnostic-report.validator.js';
import { repo, evidence, assertRoot, assertSubdir, system, dialog, waitDialog, launchInstalled, launchChrome,
  extensionHash, pair, cleanCredentials, until, ensure, startProbe } from './current-native-driver.mjs';

const runFile = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = path => access(path).then(() => true, () => false);
const fileFacts = async path => { const bytes = await readFile(path); return { bytes: bytes.length, sha256: hash(bytes) }; };
const registryScope = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Markbridge', 'HKCU\\Software\\markbridge\\Markbridge'];
const scope = {
  installMode: 'currentUser', installerArguments: '/S /NS /D=<fresh root>\\install (last, unquoted)',
  registryWrites: registryScope, shortcuts: 'Suppressed with /NS; existing named shortcuts block preflight',
  credentials: 'Only generated Markbridge.Task06.<runId> targets; revoke via trusted app; exact-target existence check only',
  uninstall: 'Normal installed uninstall.exe /S; retain app-data; remove test registration; restore only this run-created default install-location value and now-empty product key',
  nativeShellCleanup: 'Standard NSIS uninstall may clear com.markbridge.desktop jump-list destinations and Markbridge Run value (preflight requires Run value absent)',
  runtime: 'Requires existing WebView2; no bootstrapper installation authorized',
  browser: 'Two fresh temporary Chrome profiles; unpacked extension loaded only into them',
  externalNetwork: 'One selected synthetic public bookmark at https://example.com/ for actual installed content preview; no model calls',
  data: 'MARKBRIDGE_APP_DATA/app-data with main-webview and independent preview-sessions; no global WebView data override',
  cleanup: 'No recursive removal; retain isolated data, extraction, exports and screenshots; exact guarded registry residue restored from completed-run proof only',
};

function rawTreeRows(tree) {
  ensure(Array.isArray(tree), 'RESTART_COMPARISON_TREE_INVALID');
  const pending = [...tree], rows = [];
  while (pending.length > 0) {
    ensure(rows.length < 1000 && pending.length <= 1000, 'RESTART_COMPARISON_LIMIT_EXCEEDED');
    const row = pending.pop();
    ensure(row && typeof row === 'object' && !Array.isArray(row), 'RESTART_COMPARISON_TREE_INVALID');
    rows.push(row);
    if (Object.hasOwn(row, 'children')) {
      ensure(Array.isArray(row.children), 'RESTART_COMPARISON_TREE_INVALID');
      pending.push(...row.children);
    }
  }
  return rows;
}

function changedFieldCounts(before, after, identityField, fields, limit) {
  ensure(Array.isArray(before) && Array.isArray(after) && before.length <= limit && after.length <= limit, 'RESTART_COMPARISON_LIMIT_EXCEEDED');
  const indexed = rows => new Map(rows.map(row => {
    ensure(row && typeof row === 'object' && typeof row[identityField] === 'string' && row[identityField].length > 0 && row[identityField].length <= 128 && Object.keys(row).length <= 32, 'RESTART_COMPARISON_ROW_INVALID');
    return [row[identityField], row];
  }));
  const oldRows = indexed(before), newRows = indexed(after);
  ensure(oldRows.size === before.length && newRows.size === after.length, 'RESTART_COMPARISON_ID_DUPLICATED');
  const result = { addedRows: 0, removedRows: 0, keyOrderChangedRows: 0,
    rowOrderChanged: JSON.stringify(before.map(row => row[identityField])) !== JSON.stringify(after.map(row => row[identityField])),
    changedFields: Object.fromEntries([...fields, 'other'].map(field => [field, 0])) };
  for (const id of oldRows.keys()) if (!newRows.has(id)) result.removedRows += 1;
  for (const [id, next] of newRows) {
    const prior = oldRows.get(id);
    if (!prior) { result.addedRows += 1; continue; }
    if (JSON.stringify(Object.keys(prior)) !== JSON.stringify(Object.keys(next))) result.keyOrderChangedRows += 1;
    const value = (row, field) => field === 'children' && Array.isArray(row.children) ? row.children.map(child => child.id) : row[field];
    for (const field of new Set([...Object.keys(prior), ...Object.keys(next)])) {
      if (Object.hasOwn(prior, field) !== Object.hasOwn(next, field) || JSON.stringify(value(prior, field)) !== JSON.stringify(value(next, field))) {
        result.changedFields[fields.includes(field) ? field : 'other'] += 1;
      }
    }
  }
  return result;
}

function rawTreeFacts(tree) {
  return { sha256: hash(JSON.stringify(tree)), rootCount: tree.length, nodeCount: rawTreeRows(tree).length };
}

function rawTreeDifference(before, after) {
  // Child-ID projection identifies direct ordering changes only for diagnosis.
  // Acceptance still compares the original complete raw JSON hash, without dropping fields.
  const prior = rawTreeRows(before), next = rawTreeRows(after);
  const fields = ['id', 'parentId', 'index', 'title', 'url', 'dateAdded', 'dateGroupModified', 'dateLastUsed', 'folderType', 'unmodifiable', 'syncing', 'children'];
  return { allNodes: changedFieldCounts(prior, next, 'id', fields, 1000),
    syntheticRoot: changedFieldCounts(prior.filter(row => row.id === '0'), next.filter(row => row.id === '0'), 'id', fields, 1),
    remainingNodes: changedFieldCounts(prior.filter(row => row.id !== '0'), next.filter(row => row.id !== '0'), 'id', fields, 1000) };
}

function operationFacts(operations) {
  ensure(Array.isArray(operations) && operations.length <= 200, 'RESTART_COMPARISON_LIMIT_EXCEEDED');
  return { sha256: hash(JSON.stringify(operations)), count: operations.length };
}

function operationDifference(before, after) {
  return changedFieldCounts(before, after, 'operationId',
    ['operationId', 'createdAt', 'kind', 'reviewed', 'isBatch', 'state', 'affected', 'errorCode', 'conflicts'], 200);
}

function syntheticRootDateAddedProof(before, after) {
  const shape = tree => Array.isArray(tree) && tree.length === 1 && tree[0] && typeof tree[0] === 'object' && !Array.isArray(tree[0]) &&
    Object.hasOwn(tree[0], 'id') && tree[0].id === '0' && Object.hasOwn(tree[0], 'children') && Array.isArray(tree[0].children) &&
    !Object.hasOwn(tree[0], 'url') && !Object.hasOwn(tree[0], 'parentId');
  const validRootShape = Boolean(shape(before) && shape(after));
  const ownFiniteDateAdded = validRootShape && Object.hasOwn(before[0], 'dateAdded') && Object.hasOwn(after[0], 'dateAdded') &&
    Number.isFinite(before[0].dateAdded) && Number.isFinite(after[0].dateAdded);
  const dateAddedChanged = ownFiniteDateAdded && before[0].dateAdded !== after[0].dateAdded;
  let exactFullJsonAfterOnlyRootDateAddedReplacement = false;
  if (dateAddedChanged) {
    const candidate = structuredClone(after);
    candidate[0].dateAdded = before[0].dateAdded;
    exactFullJsonAfterOnlyRootDateAddedReplacement = JSON.stringify(candidate) === JSON.stringify(before);
  }
  return { validRootShape, ownFiniteDateAdded, dateAddedChanged, exactFullJsonAfterOnlyRootDateAddedReplacement,
    onlySyntheticRootDateAddedChanged: Boolean(dateAddedChanged && exactFullJsonAfterOnlyRootDateAddedReplacement) };
}

function reconnectComparison(beforeA, afterA, beforeB, afterB, beforeHistory, afterHistory) {
  const rawAEqual = hash(JSON.stringify(afterA)) === hash(JSON.stringify(beforeA)), rawBEqual = hash(JSON.stringify(afterB)) === hash(JSON.stringify(beforeB));
  const fullHistoryEqual = JSON.stringify(afterHistory) === JSON.stringify(beforeHistory);
  const rootDateAddedProof = syntheticRootDateAddedProof(beforeA, afterA);
  const semanticAEqual = rawAEqual || rootDateAddedProof.onlySyntheticRootDateAddedChanged;
  return { rawA: rawTreeFacts(afterA), rawB: rawTreeFacts(afterB), fullHistory: operationFacts(afterHistory),
    rawAEqual, rawBEqual, fullHistoryEqual, rootDateAddedProof, semanticAEqual,
    noReplayEqual: semanticAEqual && rawBEqual && fullHistoryEqual,
    differences: { rawA: rawTreeDifference(beforeA, afterA), rawB: rawTreeDifference(beforeB, afterB), fullHistory: operationDifference(beforeHistory, afterHistory) } };
}

function testReconnectComparison() {
  const before = [{ id: '0', title: '', dateAdded: 10, children: [{ id: '1', parentId: '0', index: 0, title: 'PRIVATE_FOLDER', dateAdded: 20,
    dateGroupModified: 21, children: [{ id: '2', parentId: '1', index: 0, title: 'PRIVATE_BOOKMARK', url: 'https://fixture.invalid/private', dateAdded: 30, dateLastUsed: 31 },
      { id: '3', parentId: '1', index: 1, title: 'PRIVATE_SECOND', url: 'https://fixture.invalid/second', dateAdded: 40 }] }] }];
  const history = [{ operationId: 'op1', createdAt: 1, kind: 'create', reviewed: false, isBatch: false, state: 'applied', affected: 1, errorCode: null, conflicts: [] },
    { operationId: 'op2', createdAt: 2, kind: 'update', reviewed: false, isBatch: false, state: 'applied', affected: 1, errorCode: null, conflicts: [] }];
  const compare = (after, afterB = before, afterHistory = history) => reconnectComparison(before, after, before, afterB, history, afterHistory);
  ensure(compare(structuredClone(before)).noReplayEqual, 'COMPARISON_TEST_EXACT_TREE_REJECTED');
  const rootOnly = structuredClone(before); rootOnly[0].dateAdded += 1;
  const proof = compare(rootOnly);
  ensure(proof.noReplayEqual && !proof.rawAEqual && proof.rawBEqual && proof.fullHistoryEqual && proof.rootDateAddedProof.onlySyntheticRootDateAddedChanged &&
    proof.differences.rawA.syntheticRoot.changedFields.dateAdded === 1 && Object.values(proof.differences.rawA.remainingNodes.changedFields).every(count => count === 0), 'COMPARISON_TEST_SOLE_ROOT_DATE_REJECTED');
  const mutations = [
    tree => { tree[0].id = 'ordinary-root'; }, tree => { tree[0].url = 'https://fixture.invalid/root'; }, tree => { tree[0].parentId = 'unexpected-parent'; },
    tree => { delete tree[0].dateAdded; }, tree => { tree[0].dateAdded = Infinity; }, tree => { tree[0].dateAdded = '11'; },
    tree => { tree[0].extra = 'PRIVATE_EXTRA_KEY'; }, tree => { delete tree[0].title; }, tree => { delete tree[0].children; }, tree => { tree[0].title = 'PRIVATE_ROOT_CHANGE'; },
    tree => { tree[0].children[0].dateAdded += 1; }, tree => { tree[0].children[0].dateGroupModified += 1; },
    tree => { tree[0].children[0].children[0].dateAdded += 1; }, tree => { tree[0].children[0].children[0].dateLastUsed += 1; },
    tree => { tree[0].children[0].children[0].title = 'PRIVATE_TITLE_CHANGE'; }, tree => { tree[0].children[0].children[0].url += '/changed'; },
    tree => { tree[0].children[0].children[0].id = 'replacement-id'; }, tree => { tree[0].children[0].children.reverse(); },
    tree => { tree[0].children[0].children[0].index += 1; }, tree => { tree[0].children[0].syncing = true; },
    tree => { tree[0].children[0].children.pop(); },
    tree => { tree[0] = Object.fromEntries(Object.entries(tree[0]).reverse()); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(rootOnly); mutate(changed);
    ensure(!compare(changed).noReplayEqual, 'COMPARISON_TEST_OTHER_CHANGE_ACCEPTED');
  }
  const secondRoot = structuredClone(rootOnly); secondRoot.push({ id: 'another-root', title: '', dateAdded: 11, children: [] });
  ensure(!compare(secondRoot).noReplayEqual, 'COMPARISON_TEST_MULTIPLE_ROOTS_ACCEPTED');
  const bChanged = structuredClone(before); bChanged[0].dateAdded += 1;
  ensure(!compare(rootOnly, bChanged).noReplayEqual, 'COMPARISON_TEST_B_ROOT_DATE_ACCEPTED');
  const historyChanged = structuredClone(history); historyChanged[0].state = 'uncertain';
  ensure(!compare(rootOnly, before, historyChanged).noReplayEqual && !compare(rootOnly, before, [...history].reverse()).noReplayEqual, 'COMPARISON_TEST_HISTORY_CHANGE_ACCEPTED');
  const historyExtra = structuredClone(history); historyExtra[0].extra = 'PRIVATE_HISTORY_KEY';
  const historyDate = structuredClone(history); historyDate[0].createdAt += 1;
  ensure(!compare(rootOnly, before, historyExtra).noReplayEqual && !compare(rootOnly, before, historyDate).noReplayEqual, 'COMPARISON_TEST_HISTORY_FIELD_IGNORED');
  const noOwnDate = structuredClone(before); delete noOwnDate[0].dateAdded;
  ensure(!syntheticRootDateAddedProof(noOwnDate, rootOnly).onlySyntheticRootDateAddedChanged &&
    !syntheticRootDateAddedProof([], rootOnly).onlySyntheticRootDateAddedChanged, 'COMPARISON_TEST_INVALID_BASELINE_ACCEPTED');
  const encoded = JSON.stringify(proof);
  ensure(!encoded.includes('PRIVATE_') && !encoded.includes('fixture.invalid') && !encoded.includes('op1'), 'COMPARISON_TEST_PRIVATE_VALUES_EXPOSED');
  console.log(JSON.stringify({ status: 'PASS', kind: 'pure_reconnect_comparison_contract', comparisonMethodVersion: 2, otherTreeMutationsRejected: mutations.length,
    installation: 'NOT_RUN', native: 'NOT_RUN', acceptedOnlyAOwnFiniteSyntheticRootDateAdded: true }));
}

async function sevenZip() {
  for (const path of ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe', '7z']) {
    try { await runFile(path, ['i'], { windowsHide: true }); return path; } catch { /* Try the next fixed executable location. */ }
  }
  throw new Error('SEVEN_ZIP_REQUIRED_FOR_CURRENT_PACKAGE_EVIDENCE');
}

async function prepare() {
  ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
  const runId = randomUUID();
  const root = await mkdtemp(join(tmpdir(), 'markbridge-task13-native-'));
  try {
  await assertRoot(root);
  const native = nativeReleaseContext(repo);
  const config = JSON.parse(await readFile(join(repo, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  const storageSourcePath = join(repo, 'crates/core/src/storage/mod.rs');
  const storageSource = await readFile(storageSourcePath, 'utf8');
  const migrationBlock = storageSource.match(/const MIGRATIONS: &[\s\S]*?= &\[([\s\S]*?)\];/)?.[1];
  const migrations = [...(migrationBlock ?? '').matchAll(/include_str!\("migrations\/([0-9]{3})_[a-z_]+\.sql"\)/g)].map(match => Number(match[1]));
  ensure(migrations.length > 0 && migrations.every((value, index) => value === index + 1), 'CURRENT_SCHEMA_SOURCE_INVALID');
  const nsiPath = join(native.releaseDirectory, 'nsis/x64/installer.nsi');
  const nsi = await readFile(nsiPath, 'utf8');
  ensure(nsi.includes('!define INSTALLMODE "currentUser"') && nsi.includes('!define PRODUCTNAME "Markbridge"') && nsi.includes('!define MAINBINARYNAME "markbridge-desktop"') && nsi.includes('!define STARTMENUFOLDER ""') && nsi.includes('"/NS"'), 'NSIS_SCOPE_CHANGED_REVIEW_REQUIRED');
  const installer = join(native.releaseDirectory, 'bundle/nsis', `Markbridge_${config.version}_x64-setup.exe`);
  const chromeExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await access(chromeExecutable);
  const preflight = await system('preflight', root);
  await mkdir(join(root, 'packed')); await mkdir(join(root, 'app-data')); await mkdir(join(root, 'exports'));
  const zip = await sevenZip();
  const listing = await runFile(zip, ['l', installer], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(evidence, `current-package-${runId}-listing.txt`), listing.stdout, { flag: 'wx' });
  await runFile(zip, ['e', installer, `-o${join(root, 'packed')}`, 'markbridge-desktop.exe', '-y'], { windowsHide: true });
  const packedExecutable = join(root, 'packed/markbridge-desktop.exe');
  const packed = await readFile(packedExecutable), releaseBytes = await readFile(native.artifact);
  inspectNativeArtifact(packed); inspectNativeArtifact(releaseBytes);
  ensure(packed.equals(releaseBytes), 'PACKED_EXECUTABLE_RELEASE_HASH_MISMATCH');
  ensure(packed.includes(Buffer.from('main-webview')), 'ISOLATED_MAIN_SUPPORT_MISSING');
  const versions = await system('file-version', root, ['-TargetFile', packedExecutable]);
  ensure(versions.productVersion === config.version && versions.fileVersion === config.version, 'PACKED_VERSION_MISMATCH');
  const plan = { formatVersion: 1, runId, preparedAt: new Date().toISOString(), state: 'PREPARED', installation: 'NOT_RUN', scope,
    root, installDirectory: join(root, 'install'), appData: join(root, 'app-data'), executable: join(root, 'install/markbridge-desktop.exe'),
    namespace: `Markbridge.Task06.mb13-${runId}`, installer, releaseExecutable: native.artifact, packedExecutable, chromeExecutable,
    appVersion: config.version, schemaVersion: migrations.length, storageSourcePath, storageSourceFacts: await fileFacts(storageSourcePath),
    installerFacts: await fileFacts(installer), executableFacts: await fileFacts(packedExecutable),
    nsiPath, nsiFacts: await fileFacts(nsiPath), extensionSha256: await extensionHash(), packedVersions: versions, preflight };
  await writeFile(join(root, 'task13-plan.json'), JSON.stringify({ runId }), { flag: 'wx' });
  const path = join(evidence, `current-installer-${runId}-plan.json`);
  await writeFile(path, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ state: 'PREPARED', installation: 'NOT_RUN', runId, plan: path, root, installDirectory: plan.installDirectory,
    installerSha256: plan.installerFacts.sha256, executableSha256: plan.executableFacts.sha256, scope,
    authorizedCommand: `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-installer.mjs run "${path}" ${runId}` }, null, 2));
  } catch (error) {
    const failed = { runId, finishedAt: new Date().toISOString(), root, state: 'PREPARE_FAILED', installation: 'NOT_RUN', scope,
      code: /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'PACKAGE_OR_SYSTEM_PREFLIGHT_FAILED',
      followUp: 'Inspect exact current installer registrations with current-native-system.ps1 install-state if preflight failed; do not install or remove prior registration automatically' };
    const receipt = join(evidence, `current-installer-${runId}-prepare-failure.json`);
    await writeFile(receipt, JSON.stringify(failed, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ ...failed, receipt })); process.exitCode = 1;
  }
}

async function nsis(file, args, root) {
  await assertRoot(root);
  return new Promise((done, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
    const timeout = setTimeout(() => reject(new Error('NSIS_PROCESS_TIMEOUT_DO_NOT_DELETE_FIXTURE')), 120000);
    child.on('error', () => { clearTimeout(timeout); reject(new Error('NSIS_START_FAILED')); });
    child.on('exit', (exitCode, signal) => { clearTimeout(timeout); done({ pid: child.pid, exitCode, signal }); });
  });
}

async function credentialReferences(plan) {
  const code = "import json,sqlite3,sys,pathlib; p=pathlib.Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); print(json.dumps([r[0] for r in c.execute('SELECT credential_reference FROM profiles WHERE credential_reference IS NOT NULL')])); c.close()";
  const { stdout } = await runFile('python', ['-c', code, join(plan.appData, 'markbridge.sqlite')], { windowsHide: true });
  return JSON.parse(stdout);
}

async function portClosed(port) {
  const server = createServer();
  return new Promise(done => {
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

async function retainedData(plan) {
  const entries = await readdir(plan.appData, { recursive: true, withFileTypes: true });
  ensure(!entries.some(entry => entry.isSymbolicLink()), 'ISOLATED_APP_DATA_REDIRECTED');
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
  const manifest = [];
  for (const path of files) manifest.push([path.slice(plan.appData.length + 1), (await stat(path)).size, hash(await readFile(path))]);
  return { files: manifest.length, bytes: manifest.reduce((sum, row) => sum + row[1], 0), manifestSha256: hash(JSON.stringify(manifest)),
    sqlite: await fileFacts(join(plan.appData, 'markbridge.sqlite')), mainWebviewPresent: await exists(join(plan.appData, 'main-webview')),
    previewDirectoryCount: (await readdir(join(plan.appData, 'preview-sessions'), { withFileTypes: true })).filter(entry => entry.isDirectory()).length };
}

async function restoreInstallationLocation(planPath, receiptPath) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  await assertSubdir(plan.root, plan.installDirectory, 'install');
  const cleanupId = randomUUID();
  const cleanup = { runId: plan.runId, cleanupId, startedAt: new Date().toISOString(), operation: 'restore_only_run_created_install_location',
    plan: basename(planPath), completedRunReceipt: basename(receiptPath), planFacts: await fileFacts(planPath), completedRunFacts: await fileFacts(receiptPath), root: plan.root };
  try {
    const before = await retainedData(plan);
    cleanup.registry = await system('restore-install-location', plan.root, ['-PlanPath', resolve(planPath), '-ReceiptPath', resolve(receiptPath)]);
    cleanup.finalRegistration = await system('install-state', plan.root);
    ensure(cleanup.finalRegistration.keys.length === 0, 'APP_REGISTRATION_REMAINS_AFTER_RESTORE');
    cleanup.data = await retainedData(plan);
    ensure(JSON.stringify(before) === JSON.stringify(cleanup.data), 'INSTALL_LOCATION_RESTORE_CHANGED_ISOLATED_DATA');
    cleanup.status = 'PASS';
  } catch (error) {
    cleanup.status = 'FAIL'; cleanup.code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'INSTALL_LOCATION_RESTORE_PREFLIGHT_OR_CONFLICT'; process.exitCode = 1;
  }
  cleanup.finishedAt = new Date().toISOString();
  const path = join(evidence, `current-installer-${plan.runId}-${cleanupId}-registry-restore.json`);
  await writeFile(path, JSON.stringify(cleanup, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ operation: cleanup.operation, status: cleanup.status, receipt: path, code: cleanup.code }));
  return { status: cleanup.status, receipt: path };
}

async function recoverInstalledFixture(planPath, failedReceiptPath, lateCloseProofPath) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  await assertSubdir(plan.root, plan.installDirectory, 'install'); await assertSubdir(plan.root, plan.appData, 'app-data');
  const source = JSON.parse(await readFile(failedReceiptPath, 'utf8'));
  const attemptId = randomUUID();
  const recovery = { kind: 'authorized_failed_fixture_cleanup', runId: plan.runId, attemptId, startedAt: new Date().toISOString(),
    root: plan.root, plan: basename(planPath), sourceRunReceipt: basename(failedReceiptPath), sourceRunFacts: await fileFacts(failedReceiptPath),
    originalRunStatus: source.status, originalMainExitStatus: source.finalExit?.exitCode === 0 ? 'PASS' : 'UNVERIFIED',
    outsideFixtureMainStore: { status: 'UNVERIFIED', reason: 'Prior main-store isolation was not established for this raw run. Recovery hashes only guarded temporary app-data; no outside files are inspected or removed, and no absence of prior main-page writes is claimed.' },
    install: source.install, preflight: source.preflight, registration: source.registration,
    finalExit: source.finalExit, controls: source.controls?.filter(item => item.control === 'exact_test_os_credentials_revoked') ?? [], ports: source.ports ?? [] };
  try {
    if (lateCloseProofPath) recovery.lateCloseProof = { file: basename(lateCloseProofPath), facts: await fileFacts(lateCloseProofPath) };
    recovery.ownership = await system('recovery-proof', plan.root, ['-PlanPath', resolve(planPath), '-ReceiptPath', resolve(failedReceiptPath), ...(lateCloseProofPath ? ['-LateCloseProofPath', resolve(lateCloseProofPath)] : [])]);
    ensure(JSON.stringify(await fileFacts(plan.executable)) === JSON.stringify(plan.executableFacts), 'RECOVERY_INSTALLED_EXECUTABLE_CHANGED');
    ensure(JSON.stringify(await fileFacts(plan.installer)) === JSON.stringify(plan.installerFacts), 'RECOVERY_APPROVED_INSTALLER_CHANGED');
    const registration = await system('install-state', plan.root);
    ensure(registration.registration?.installLocation.replaceAll('"', '') === plan.installDirectory && registration.registration.mainBinaryName === 'markbridge-desktop.exe' && registration.registration.displayVersion === plan.appVersion, 'RECOVERY_CURRENT_REGISTRATION_NOT_OWNED');
    recovery.stoppedProcesses = await until(async () => { const current = await system('processes', plan.root); return current.processes.length === 0 && current.listeners.length === 0 ? current : null; }, 'RECOVERY_OWNED_PROCESSES_OR_LISTENERS_REMAINED', 30000);
    recovery.retainedBeforeUninstall = await retainedData(plan);
    const uninstaller = join(plan.installDirectory, 'uninstall.exe');
    ensure(await exists(uninstaller), 'RECOVERY_NORMAL_UNINSTALLER_MISSING');
    recovery.uninstall = await nsis(uninstaller, ['/S'], plan.root);
    ensure(recovery.uninstall.exitCode === 0 && recovery.uninstall.signal === null, 'RECOVERY_UNINSTALL_EXIT_NONZERO');
    await until(async () => !await exists(plan.executable) && !await exists(uninstaller) && !(await system('install-state', plan.root)).registration, 'RECOVERY_UNINSTALL_INCOMPLETE', 30000);
    recovery.retainedAfterUninstall = await retainedData(plan);
    ensure(JSON.stringify(recovery.retainedBeforeUninstall) === JSON.stringify(recovery.retainedAfterUninstall), 'RECOVERY_UNINSTALL_CHANGED_ISOLATED_DATA');
    recovery.finalProcesses = await until(async () => { const current = await system('processes', plan.root); return current.processes.length === 0 && current.listeners.length === 0 ? current : null; }, 'RECOVERY_UNINSTALL_PROCESS_OR_LISTENER_REMAINED', 30000);
    recovery.closedPorts = [];
    for (const port of new Set(recovery.ports)) { ensure(await portClosed(port), 'RECOVERY_KNOWN_TEST_LISTENER_REMAINED'); recovery.closedPorts.push(port); }
    recovery.status = 'PASS';
  } catch (error) { recovery.status = 'FAIL'; recovery.code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'RECOVERY_ACTION_OR_ASSERTION_FAILED'; process.exitCode = 1; }
  recovery.finishedAt = new Date().toISOString();
  const receiptPath = join(evidence, `current-installer-${plan.runId}-${attemptId}-receipt.json`);
  await writeFile(receiptPath, JSON.stringify(recovery, null, 2) + '\n', { flag: 'wx' });
  const restored = recovery.status === 'PASS' ? await restoreInstallationLocation(planPath, receiptPath) : null;
  const completion = { kind: recovery.kind, runId: plan.runId, attemptId, status: recovery.status === 'PASS' && restored?.status === 'PASS' ? 'PASS' : 'FAIL',
    originalRunStatus: source.status, originalRunReceipt: basename(failedReceiptPath), recoveryReceipt: receiptPath, registryRestoreReceipt: restored?.receipt ?? null, finishedAt: new Date().toISOString() };
  const completionPath = join(evidence, `current-installer-${plan.runId}-${attemptId}-recovery-completion.json`);
  await writeFile(completionPath, JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
  if (completion.status !== 'PASS') process.exitCode = 1;
  console.log(JSON.stringify({ operation: recovery.kind, status: completion.status, receipt: receiptPath, completion: completionPath, originalRunStatus: source.status, code: recovery.code }));
}

async function runPlan(path, approvedRunId) {
  ensure(resolve(path, '..') === evidence && /^current-installer-[a-f0-9-]+-plan\.json$/.test(basename(path)), 'WRONG_APPROVED_PLAN_PATH');
  const plan = JSON.parse(await readFile(path, 'utf8'));
  ensure(plan.state === 'PREPARED' && plan.runId === approvedRunId && plan.namespace === `Markbridge.Task06.mb13-${plan.runId}`, 'APPROVED_RUN_ID_MISMATCH');
  await assertSubdir(plan.root, plan.installDirectory, 'install'); await assertSubdir(plan.root, plan.appData, 'app-data');
  ensure((JSON.parse(await readFile(join(plan.root, 'task13-plan.json'), 'utf8'))).runId === plan.runId, 'PLAN_ROOT_MARKER_MISMATCH');
  const attemptId = randomUUID();
  const report = { runId: plan.runId, attemptId, startedAt: new Date().toISOString(), plan: basename(path), installerFacts: plan.installerFacts,
    executableFacts: plan.executableFacts, extensionSha256: plan.extensionSha256, root: plan.root, scope, controls: [], errors: [],
    realModel: { status: 'NOT_RUN', reason: 'No real model is configured by this installer harness; scripted replies are not real-model evidence' },
    floccus: { status: 'UNVERIFIED', reason: 'No dedicated Floccus library or second client in this run' },
    sleep: { acceptance: 'WAIVED', execution: 'NOT_RUN' },
    chromeCloseMethodVersion: 2, chromeCloseObservationBudgetMs: 180000,
    environment: { os: version(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version }, ports: [] };
  let app, a, b, probe, profileA, profileB, seedA, seedB, created, installed = false, references = [], stage = 'preflight';
  const screenshotDir = join(evidence, `current-screenshots-${plan.runId}-${attemptId}`);
  await mkdir(screenshotDir);
  const pass = (control, facts = {}) => { report.controls.push({ control, status: 'PASS', ...facts }); console.log(JSON.stringify({ control, status: 'PASS' })); };
  const fail = (code, phase = stage) => { report.errors.push({ phase, code: /^[A-Z][A-Z0-9_]+$/.test(code ?? '') ? code : 'NATIVE_ACTION_OR_ASSERTION_FAILED' }); report.status = 'FAIL'; process.exitCode = 1; };
  const screenshot = async name => { if (app?.page) await app.page.screenshot({ path: join(screenshotDir, `${name}.png`), mask: [app.page.locator('#pairing-code')] }); };
  const state = () => app.invoke('get_bridge_state');
  const profile = async id => (await state()).profiles.find(row => row.profileId === id);
  const operations = async () => (await app.invoke('list_operations', { profileId: profileA })).operations;
  const detail = () => app.page.locator('.detail-pane');
  const list = () => app.page.getByRole('listbox', { name: /^(书签列表|搜索结果)$/ });
  const row = title => list().getByRole('option').filter({ hasText: title });
  const closeDetail = async () => { const button = app.page.getByRole('button', { name: '关闭详情，返回列表', exact: true }); if (await button.isVisible()) await button.click(); };
  const choose = async id => {
    await app.page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '书签', exact: true }).click(); await closeDetail();
    const source = app.page.locator('#library-source'), value = `profile:${id}`;
    await source.selectOption(value);
    await app.page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const handoff = app.page.getByRole('dialog', { name: '切换书签来源？', exact: true });
    if (await handoff.isVisible()) {
      await handoff.getByRole('button', { name: '清除当前输入并切换', exact: true }).click();
      (report.helperEvents ??= []).push({ event: 'expected_source_switch_discard_confirmed' });
    }
    await expect(handoff).not.toBeVisible(); await expect(source).toHaveValue(value);
  };
  const find = async title => { await closeDetail(); await app.page.locator('#library-search').fill(title); await expect(row(title)).toBeVisible(); };
  const select = async title => { await find(title); await row(title).click(); };
  const seed = (chrome, name, url) => chrome.evaluate(`(async()=>{const tree=await chrome.bookmarks.getTree();const bar=tree[0].children.find(n=>n.folderType==='bookmarks-bar');const folder=await chrome.bookmarks.create({parentId:bar.id,title:'MB13 folder'});const item=await chrome.bookmarks.create({parentId:folder.id,title:${JSON.stringify(name)},url:${JSON.stringify(url)}});return {folder:folder.id,item:item.id};})()`);
  const title = 'MB13 private title canary', editedTitle = 'MB13 reviewed title canary', note = 'MB13 private note canary', tag = 'MB13-local-tag';
  const canaries = [title, editedTitle, note, tag, 'MB13-profile-A', 'MB13-profile-B', 'MB13-query-canary', 'MB13-fragment-canary', plan.root, plan.namespace];
  try {
    ensure(!await exists(plan.installDirectory), 'INSTALL_DIRECTORY_ALREADY_EXISTS_NEW_PLAN_REQUIRED');
    for (const [artifact, expected] of [[plan.installer, plan.installerFacts], [plan.releaseExecutable, plan.executableFacts], [plan.packedExecutable, plan.executableFacts], [plan.nsiPath, plan.nsiFacts]]) {
      ensure(JSON.stringify(await fileFacts(artifact)) === JSON.stringify(expected), 'PREPARED_ARTIFACT_CHANGED');
    }
    ensure(Number.isInteger(plan.schemaVersion) && plan.schemaVersion > 0 && plan.storageSourcePath === join(repo, 'crates/core/src/storage/mod.rs') && JSON.stringify(await fileFacts(plan.storageSourcePath)) === JSON.stringify(plan.storageSourceFacts), 'PREPARED_SCHEMA_SOURCE_CHANGED');
    ensure(await extensionHash() === plan.extensionSha256, 'PREPARED_EXTENSION_CHANGED');
    report.preflight = await system('preflight', plan.root);
    stage = 'install'; report.install = await nsis(plan.installer, ['/S', '/NS', `/D=${plan.installDirectory}`], plan.root);
    ensure(report.install.exitCode === 0 && report.install.signal === null, 'INSTALL_EXIT_NONZERO'); installed = true;
    ensure(JSON.stringify(await fileFacts(plan.executable)) === JSON.stringify(plan.executableFacts), 'INSTALLED_EXECUTABLE_HASH_MISMATCH');
    inspectNativeArtifact(await readFile(plan.executable));
    report.installedVersions = await system('file-version', plan.root, ['-TargetFile', plan.executable]);
    ensure(JSON.stringify(report.installedVersions) === JSON.stringify(plan.packedVersions), 'INSTALLED_VERSION_MISMATCH');
    report.registration = await system('install-state', plan.root);
    ensure(report.registration.registration?.installLocation.replaceAll('"', '') === plan.installDirectory && report.registration.registration.mainBinaryName === 'markbridge-desktop.exe' && report.registration.registration.displayVersion === plan.appVersion && report.registration.shortcutCount === 0 && !report.registration.runPresent, 'INSTALL_REGISTRATION_OR_SHORTCUT_MISMATCH');
    pass('current_installer_installed_exact_release_and_packed_executable', { installedVersions: report.installedVersions });

    stage = 'startup-os-isolation'; app = await launchInstalled(plan); report.webview = app.webview; report.mainDataEvidence = app.mainDataEvidence;
    report.semanticDefault = await app.invoke('semantic_settings');
    ensure(report.semanticDefault.enabled === false && report.semanticDefault.endpointLabel === null && report.semanticDefault.model === null, 'INSTALLED_SEMANTIC_NOT_DEFAULT_OFF');
    pass('actual_main_webview_process_directory_is_exact_isolated_main');
    stage = 'pair-and-sync'; probe = await startProbe();
    report.ports.push(Number(new URL(probe.base).port), app.debugPort);
    app.page.on('pageerror', () => fail('NATIVE_PAGE_ERROR', 'pageerror'));
    a = await launchChrome(plan.root, 'chrome-a', plan.chromeExecutable); b = await launchChrome(plan.root, 'chrome-b', plan.chromeExecutable); report.chrome = a.version;
    ensure(Number(a.version.split('/')[1]?.split('.')[0]) >= 134, 'CHROME_BELOW_SUPPORTED_VERSION');
    seedA = await seed(a, title, `${probe.base}/a?MB13-query-canary#MB13-fragment-canary`); seedB = await seed(b, 'MB13 profile B bookmark', `${probe.base}/b`);
    ensure(seedA.item === seedB.item, 'FIXTURE_CHROME_IDS_DO_NOT_OVERLAP');
    profileA = await pair(app, a, 'MB13-profile-A'); profileB = await pair(app, b, 'MB13-profile-B');
    report.ports.push((await state()).port);
    references = await credentialReferences(plan); ensure(references.length === 2, 'TEST_CREDENTIAL_REFERENCES_MISSING');
    for (const reference of references) ensure((await system('credential', plan.root, ['-Namespace', plan.namespace, '-Reference', reference])).present, 'TEST_OS_CREDENTIAL_NOT_PRESENT');
    await choose(profileA); await select(title); await screenshot('paired-sync');
    pass('two_disposable_chrome_profiles_pair_live_with_equal_ids');

    stage = 'create-edit'; await find('MB13 folder'); await row('MB13 folder').dblclick();
    await app.page.getByRole('button', { name: '新建', exact: true }).click(); await app.page.locator('#edit-title').fill('MB13 newly created'); await app.page.locator('#edit-url').fill(`${probe.base}/created`);
    await app.page.getByRole('button', { name: '预览新书签', exact: true }).click();
    const review = app.page.getByRole('dialog', { name: '确认变更', exact: true });
    await review.getByRole('button', { name: '取消', exact: true }).click();
    ensure((await a.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(seedA.folder)})`)).length === 1, 'CANCEL_CREATE_WROTE_CHROME');
    await app.page.getByRole('button', { name: '预览新书签', exact: true }).click(); await review.getByRole('button', { name: '确认变更', exact: true }).click();
    created = await until(async () => (await a.evaluate(`chrome.bookmarks.getChildren(${JSON.stringify(seedA.folder)})`)).find(item => item.title === 'MB13 newly created'), 'CREATE_NOT_OBSERVED');
    await select('MB13 newly created'); await app.page.getByRole('tab', { name: '信息', exact: true }).click(); await app.page.locator('#edit-title').fill(editedTitle);
    await app.page.getByRole('button', { name: '预览修改', exact: true }).click(); await review.getByRole('button', { name: '确认变更', exact: true }).click();
    await until(async () => (await a.evaluate(`chrome.bookmarks.get(${JSON.stringify(created.id)})`))[0]?.title === editedTitle, 'EDIT_NOT_OBSERVED');
    await until(async () => (await operations()).filter(item => item.state === 'applied').length >= 2, 'APPLIED_RECEIPTS_MISSING');
    await select(editedTitle); await app.page.getByRole('tab', { name: '标签备注', exact: true }).click();
    await detail().locator('#tag-name').fill(tag); await detail().getByRole('button', { name: '添加标签', exact: true }).click();
    await detail().locator('#tag-note').fill(note); await detail().getByRole('button', { name: '保存备注', exact: true }).click();
    await until(async () => { const entry = (await app.invoke('tag_state', { profileId: profileA, chromeIds: [created.id], filterTagId: null })).entries[0]; return entry.note === note && entry.tagIds.length === 1; }, 'LOCAL_TAG_NOTE_NOT_SAVED');
    ensure((await a.evaluate(`chrome.bookmarks.get(${JSON.stringify(created.id)})`))[0].title === editedTitle, 'LOCAL_TAG_CHANGED_CHROME_TITLE');
    await screenshot('created-edited-local-metadata'); pass('real_ui_create_cancel_confirm_edit_receipts_and_local_metadata');

    stage = 'public-content-preview';
    await a.evaluate(`chrome.bookmarks.create({parentId:${JSON.stringify(seedA.folder)},title:'MB13 public content preview',url:'https://example.com/'})`);
    await select('MB13 public content preview'); await app.page.getByRole('tab', { name: '内容预览', exact: true }).click();
    const summary = app.page.getByRole('region', { name: '内容预览', exact: true }).getByLabel('缓存正文', { exact: true });
    await expect(summary).toBeVisible({ timeout: 20000 });
    const summaryText = (await summary.textContent()).trim();
    ensure(summaryText.length > 0 && summaryText !== '没有可显示的摘要', 'PUBLIC_CONTENT_PREVIEW_EMPTY');
    await screenshot('public-content-preview'); pass('installed_public_content_preview_renders_actual_fetch');

    stage = 'preview-isolation'; await app.page.evaluate(() => localStorage.setItem('r08-main', 'MB13-main-only'));
    const openPreview = async (id, bookmarkTitle, path) => {
      await choose(id); await select(bookmarkTitle); await app.page.getByRole('tab', { name: '内容预览', exact: true }).click();
      const since = probe.reports.length;
      await app.page.getByRole('button', { name: '打开应用内网页', exact: true }).click(); await until(async () => (await app.invoke('web_preview_state')).phase === 'ready', 'PREVIEW_NOT_READY');
      const page = await probe.hello(path, since);
      const os = await until(async () => { const observed = await app.inspectData(id); return observed.observations.some(row => row.expectedPreview && row.observedDirectoryExists) && observed.previewDirectoryExists ? observed : null; }, 'PREVIEW_OS_PROFILE_DIRECTORY_NOT_OBSERVED');
      (report.previewOsDirectories ??= []).push(os);
      (report.previewSyntheticSnapshots ??= []).push({ kind: 'fresh_hello', ...page });
      return page;
    };
    const closePreview = async () => { await app.page.getByRole('button', { name: '关闭预览', exact: true }).click(); await until(async () => (await app.invoke('web_preview_state')).phase === 'closed', 'PREVIEW_NOT_CLOSED'); };
    const pageA = await openPreview(profileA, title, '/a');
    const stored = await probe.job(pageA, 'store', { value: 'MB13-preview-A' }); report.previewSyntheticSnapshots.push({ kind: 'A_store', ...stored }); ensure(stored.main === null, 'PREVIEW_READ_MAIN_STORAGE');
    const denied = await probe.job(pageA, 'invoke'); ensure(denied.results.length === probe.commands.length && denied.results.every(item => ['NO_IPC', 'DENIED'].includes(item.outcome)), 'REMOTE_PREVIEW_ACCEPTED_IPC'); report.previewCommandDenials = denied.results;
    await screenshot('independent-preview-A'); await closePreview();
    const bHello = await openPreview(profileB, 'MB13 profile B bookmark', '/b');
    ensure(bHello.local === null && !bHello.cookie.includes('MB13-preview-A') && bHello.main === null, 'PREVIEW_PROFILES_SHARE_SESSION');
    report.previewSyntheticSnapshots.push({ kind: 'B_store', ...await probe.job(bHello, 'store', { value: 'MB13-preview-B' }) }); await closePreview();
    const reopenedA = await openPreview(profileA, title, '/a'); const restored = await probe.job(reopenedA, 'read'); report.previewSyntheticSnapshots.push({ kind: 'A_reopened_read', ...restored });
    ensure(restored.path === '/a' && restored.pageId === reopenedA.pageId, 'PREVIEW_READ_WRONG_PAGE_INSTANCE');
    ensure(restored.local === 'MB13-preview-A' && restored.cookie.includes('MB13-preview-A') && !restored.cookie.includes('MB13-preview-B'), 'PROFILE_A_PREVIEW_SESSION_NOT_RESTORED');
    ensure(await app.page.evaluate(() => localStorage.getItem('r08') === null), 'PREVIEW_CHANGED_MAIN_STORAGE');
    await screenshot('preview-A-session-restored'); await closePreview(); pass('actual_independent_preview_profile_sessions_and_all_command_denials');

    stage = 'diagnostic-dialog'; await app.page.getByRole('button', { name: '设置', exact: true }).click(); await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    const diagnostic = app.page.getByRole('region', { name: '诊断导出', exact: true });
    const beforeFiles = await readdir(join(plan.root, 'exports'));
    await diagnostic.getByRole('button', { name: '导出诊断 JSON', exact: true }).click(); await waitDialog(app); await dialog(app, 'cancel');
    await expect(diagnostic.getByText('已取消保存，没有生成诊断文件。', { exact: true })).toBeVisible();
    ensure(JSON.stringify(await readdir(join(plan.root, 'exports'))) === JSON.stringify(beforeFiles), 'CANCEL_DIAGNOSTIC_CREATED_FILE'); await screenshot('diagnostics-cancelled');
    await diagnostic.getByRole('button', { name: '导出诊断 JSON', exact: true }).click(); await waitDialog(app); await dialog(app, 'save', join(plan.root, 'exports/markbridge-diagnostics.json'));
    await expect(diagnostic.getByText('诊断文件已保存到所选位置。', { exact: true })).toBeVisible({ timeout: 15000 });
    const diagnosticText = await readFile(join(plan.root, 'exports/markbridge-diagnostics.json'), 'utf8'), diagnosticReport = JSON.parse(diagnosticText);
    ensure(validateDiagnostic(diagnosticReport), 'DIAGNOSTIC_ALLOWLIST_INVALID');
    ensure(canaries.every(value => !diagnosticText.includes(value)) && !diagnosticText.includes(profileA) && !diagnosticText.includes(profileB) && !diagnosticText.includes(a.extensionId) && references.every(value => !diagnosticText.includes(value)), 'DIAGNOSTIC_LEAKED_PRIVATE_CANARY');
    ensure(diagnosticReport.appVersion === plan.appVersion && diagnosticReport.schemaVersion === plan.schemaVersion && diagnosticReport.platform === 'windows' && diagnosticReport.architecture === 'x86_64' && diagnosticReport.connections.live === 2 && diagnosticReport.bridgeListening, 'DIAGNOSTIC_RUNTIME_FACTS_MISMATCH');
    report.diagnostics = diagnosticReport; await screenshot('diagnostics-saved'); pass('native_diagnostic_cancel_and_save_with_private_canary_exclusion');

    stage = 'offline-restart'; await choose(profileA); await select(editedTitle); await app.page.getByRole('tab', { name: '标签备注', exact: true }).click();
    const bridgePort = (await state()).port, operationsBefore = await operations();
    report.ports.push(bridgePort);
    const rawABefore = await a.evaluate('chrome.bookmarks.getTree()'), rawBBefore = await b.evaluate('chrome.bookmarks.getTree()');
    report.restartComparison = { comparisonMethodVersion: 2, criterion: 'restarted_A_exact_or_proven_sole_synthetic_root_dateAdded; B_raw_and_full_history_exact',
      before: { rawA: rawTreeFacts(rawABefore), rawB: rawTreeFacts(rawBBefore), fullHistory: operationFacts(operationsBefore) } };
    report.chromeClose = await a.close(); a = null; await until(async () => (await profile(profileA)).connection !== 'live', 'CHROME_DISCONNECT_NOT_OBSERVED');
    await closeDetail(); report.offlineUiCheckStep = 'selected-write-actions';
    for (const name of ['移动所选', '删除所选']) {
      const action = app.page.getByRole('button', { name, exact: true });
      await expect(action).toBeVisible(); await expect(action).toBeDisabled();
    }
    report.offlineUiCheckStep = 'restore-fixture-folder';
    await app.page.getByRole('button', { name: '取消选择', exact: true }).click();
    await app.page.getByRole('button', { name: '清空筛选', exact: true }).click();
    const searchScope = app.page.locator('#library-scope'), filters = app.page.getByRole('button', { name: '筛选', exact: true });
    if (!await searchScope.isVisible()) await filters.click();
    await expect(searchScope).toBeVisible(); await searchScope.selectOption('all'); await filters.click();
    await find('MB13 folder'); await row('MB13 folder').dblclick();
    await expect(app.page.locator('#library-search')).toHaveValue('');
    await expect(app.page.getByRole('listbox', { name: '书签列表', exact: true })).toBeVisible();
    await expect(app.page.getByRole('navigation', { name: '当前目录', exact: true }).getByRole('button', { name: 'MB13 folder', exact: true })).toHaveAttribute('aria-current', 'location');
    report.offlineUiCheckStep = 'visible-folder-new-action';
    const newAction = app.page.getByRole('button', { name: '新建', exact: true });
    await expect(newAction).toBeVisible(); await expect(newAction).toBeDisabled();
    report.offlineUiCheckStep = 'verified';
    await screenshot('nonlive-write-disabled'); pass('actual_nonlive_visible_selection_and_folder_write_actions_disabled');
    report.firstExit = await app.close(); app = null;
    const closed = await system('processes', plan.root); ensure(closed.listeners.every(item => item.port !== bridgePort) && await portClosed(bridgePort), 'BRIDGE_LISTENER_REMAINED_AFTER_NORMAL_CLOSE');
    app = await launchInstalled(plan); app.page.on('pageerror', () => fail('NATIVE_PAGE_ERROR', 'pageerror'));
    report.ports.push(app.debugPort);
    const operationsAfterRestart = await operations();
    report.restartComparison.afterAppRestart = { fullHistoryEqual: JSON.stringify(operationsAfterRestart) === JSON.stringify(operationsBefore),
      fullHistory: operationFacts(operationsAfterRestart), differences: operationDifference(operationsBefore, operationsAfterRestart) };
    ensure(report.restartComparison.afterAppRestart.fullHistoryEqual, 'RESTART_CHANGED_OPERATION_HISTORY');
    await app.page.getByRole('button', { name: '设置', exact: true }).click(); await app.page.getByRole('tab', { name: 'Chrome 连接', exact: true }).click();
    if (!(await state()).port) { if (!await app.page.locator('#bridge-port').isVisible()) await app.page.locator('details:has(#bridge-port)>summary').click();
      await app.page.locator('#bridge-port').fill(String(bridgePort)); await app.page.getByRole('button', { name: '启动连接', exact: true }).click(); }
    a = await launchChrome(plan.root, 'chrome-a', plan.chromeExecutable);
    await until(async () => (await profile(profileA)).connection === 'live' && (await profile(profileB)).connection === 'live', 'RESTART_PROFILES_NOT_RECONCILED');
    await choose(profileA); await select(editedTitle); await app.page.getByRole('tab', { name: '标签备注', exact: true }).click();
    await expect(detail().locator('#tag-note')).toHaveValue(note);
    ensure((await app.invoke('tag_state', { profileId: profileA, chromeIds: [created.id], filterTagId: null })).entries[0].tagIds.length === 1, 'RESTART_LOST_TAG');
    const rawAAfter = await a.evaluate('chrome.bookmarks.getTree()'), rawBAfter = await b.evaluate('chrome.bookmarks.getTree()'), operationsAfter = await operations();
    report.restartComparison.afterReconnect = reconnectComparison(rawABefore, rawAAfter, rawBBefore, rawBAfter, operationsBefore, operationsAfter);
    const compared = report.restartComparison.afterReconnect;
    ensure(compared.noReplayEqual, 'RECONNECT_REPLAYED_OR_CHANGED_BROWSER_OPERATION');
    await screenshot('restart-reconciled-local-data'); pass('installed_normal_exit_restart_reconnect_retains_metadata_without_replay');
    ensure(report.errors.length === 0, 'NATIVE_PAGE_ERRORS'); report.status = 'PASS';
  } catch (error) { app ??= error.fixtureApp; if (app?.lastDataEvidence) report.lastOsDataEvidence = app.lastDataEvidence;
    if (error.details?.kind === 'owned_chrome_close') (report.chromeCloseFailures ??= []).push(error.details);
    if (error.fixtureChrome) { if (!a) a = error.fixtureChrome; else if (!b) b = error.fixtureChrome; }
    report.failureClassification = 'HARNESS_OR_PRODUCT_FAILURE_REQUIRES_TRIAGE'; report.failedStage = stage; fail(error.message); await screenshot(`first-failure-${stage}`).catch(() => {}); }
  finally {
    // Teardown assertions are part of acceptance. Failures are never hidden by forced kill or deletion.
    if (app?.invoke) { try { await cleanCredentials(app); for (const reference of references) ensure(!(await system('credential', plan.root, ['-Namespace', plan.namespace, '-Reference', reference])).present, 'TEST_CREDENTIAL_NOT_REVOKED'); pass('exact_test_os_credentials_revoked'); } catch (error) { fail(error.message, 'credential-cleanup'); } }
    for (const chrome of [a, b]) if (chrome) { try { (report.finalChromeExits ??= []).push(await chrome.close()); } catch (error) { (report.chromeCloseFailures ??= []).push(error.details ?? chrome.lastCloseEvidence ?? null); fail(error.message, 'chrome-close'); } }
    if (app) { try { report.finalExit = await app.close(); } catch (error) { report.normalCloseEvidence = error.details ?? app.lastCloseEvidence ?? null; fail(error.message, 'app-close'); } }
    if (probe) { try { await probe.close(); } catch { fail('PROBE_CLOSE_FAILED', 'probe-close'); } }
    if (installed) {
      try {
        const stopped = await until(async () => { const value = await system('processes', plan.root); return value.processes.length === 0 && value.listeners.length === 0 ? value : null; }, 'OWNED_PROCESSES_OR_LISTENERS_REMAINED', 30000);
        report.beforeUninstallProcesses = stopped; report.retainedBeforeUninstall = await retainedData(plan);
        if (!report.retainedBeforeUninstall.mainWebviewPresent || report.retainedBeforeUninstall.previewDirectoryCount < 2) fail('APP_SESSION_DIRECTORIES_MISSING', 'session-directory-acceptance');
        const uninstall = join(plan.installDirectory, 'uninstall.exe'); await assertSubdir(plan.root, plan.installDirectory, 'install'); ensure(await exists(uninstall), 'NORMAL_UNINSTALLER_MISSING');
        report.uninstall = await nsis(uninstall, ['/S'], plan.root); ensure(report.uninstall.exitCode === 0 && report.uninstall.signal === null, 'UNINSTALL_EXIT_NONZERO');
        await until(async () => !await exists(plan.executable) && !await exists(uninstall), 'UNINSTALL_DID_NOT_REMOVE_PROGRAM_FILES', 30000);
        report.retainedAfterUninstall = await retainedData(plan);
        ensure(JSON.stringify(report.retainedAfterUninstall) === JSON.stringify(report.retainedBeforeUninstall), 'UNINSTALL_CHANGED_ISOLATED_APP_DATA');
        report.finalRegistration = await system('install-state', plan.root);
        ensure(!report.finalRegistration.registration && report.finalRegistration.keys.every(key => key === 'HKCU:\\Software\\markbridge\\Markbridge') && report.finalRegistration.shortcutCount === 0 && !report.finalRegistration.runPresent, 'UNINSTALL_REGISTRATION_OR_SHORTCUT_REMAINED');
        report.finalProcesses = await until(async () => { const value = await system('processes', plan.root); return value.processes.length === 0 && value.listeners.length === 0 ? value : null; }, 'UNINSTALL_OWNED_PROCESS_OR_LISTENER_REMAINED', 30000);
        report.closedPorts = [];
        for (const port of new Set(report.ports)) { ensure(await portClosed(port), 'KNOWN_TEST_LISTENER_REMAINED'); report.closedPorts.push(port); }
        pass('normal_uninstall_preserves_database_and_all_isolated_data_with_no_owned_process_or_listener');
      } catch (error) { fail(error.message, 'uninstall-retention-cleanup'); }
    }
    report.status ??= 'FAIL'; report.finishedAt = new Date().toISOString();
    const receipt = join(evidence, `current-installer-${plan.runId}-${attemptId}-receipt.json`);
    await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const restored = installed ? await restoreInstallationLocation(path, receipt) : null;
    const completion = { runId: plan.runId, attemptId, status: report.status === 'PASS' && restored?.status === 'PASS' ? 'PASS' : 'FAIL',
      nativeRunReceipt: receipt, registryRestoreReceipt: restored?.receipt ?? null, finishedAt: new Date().toISOString() };
    const completionPath = join(evidence, `current-installer-${plan.runId}-${attemptId}-completion.json`);
    await writeFile(completionPath, JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
    if (completion.status !== 'PASS') process.exitCode = 1;
    console.log(JSON.stringify({ status: completion.status, receipt, completion: completionPath, controls: report.controls.length, failedStage: report.failedStage, errors: report.errors }));
  }
}

const [mode, planPath, approvedRunId, lateCloseProofPath] = process.argv.slice(2);
ensure(['prepare', 'run', 'restore', 'recover', 'comparison-test'].includes(mode), 'USE_PREPARE_RUN_RESTORE_RECOVER_OR_COMPARISON_TEST');
if (mode === 'comparison-test') { ensure(process.argv.length === 3, 'NO_COMPARISON_TEST_ARGUMENTS'); testReconnectComparison(); }
else if (mode === 'prepare') await prepare();
else if (mode === 'run') await runPlan(resolve(planPath ?? ''), approvedRunId);
else if (mode === 'recover') await recoverInstalledFixture(resolve(planPath ?? ''), resolve(approvedRunId ?? ''), lateCloseProofPath ? resolve(lateCloseProofPath) : undefined);
else await restoreInstallationLocation(resolve(planPath ?? ''), resolve(approvedRunId ?? ''));
