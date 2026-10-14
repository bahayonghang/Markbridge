// Exact failed 7acc fixture only. Revoke through Rust; preserve the original FAIL and data.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectNativeArtifact, nativeReleaseContext } from '../../../../scripts/native-build.mjs';
import { repo, evidence, assertRoot, assertSubdir, cleanCredentials, ensure, launchInstalled, safeErrorCode, system, until } from './current-native-driver.mjs';

const runId = '7accfee5-259b-4733-8d77-60c71b7dda75';
const attemptId = 'de4114d5-d8fc-4d7f-be8c-76e46cee781b';
const restoreId = 'd785c2d6-bdf9-4b60-88ba-087c2bdd7fd9';
const namespace = `Markbridge.Task06.mb13-${runId}`;
const names = {
  plan: `current-installer-${runId}-plan.json`,
  original: `current-installer-${runId}-${attemptId}-receipt.json`,
  restore: `current-installer-${runId}-${restoreId}-registry-restore.json`,
};
const recoveryNames = {
  failedReader: `current-fixture-credential-cleanup-${runId}-fd93ab4d-3297-4e69-88e4-476cedc49f9f-receipt.json`,
  readerAudit: 'current-fixture-reader-fd93-audit.json',
};
const pinned = {
  plan: 'c7d5d1eef6976e83f0f995cc8e405385ef3a4c5baf1e2558cb0ac4d7ca0f6d6a',
  original: '47a561a9b3e8be8dc82f7a092547880856a905c2f9c52078434204950cc2184b',
  restore: '06967879a47ec33daf4c03d259e6e67e5cac0d6983ace1fa7b06019013aab24d',
  executable: '4f5833328131a7cd629ca10fa2953a88202fb343585072944e6e592709908f6f',
  failedReader: '1607d3e69368abd96d453a3ebb32bcfaebcb13e0dc1c9d251557019cad7285c9',
  readerAudit: 'edb47f3bfbb15481319c15bd3484ac38b5a3d6389eb25462060ea485285b1e8e',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const fileFacts = async path => { const bytes = await readFile(path); return { bytes: bytes.length, sha256: hash(bytes) }; };

export function validateEvidenceInputs(plan, original, restore, facts) {
  ensure(Object.keys(names).every(key => facts[key]?.sha256 === pinned[key]), 'CLEANUP_EVIDENCE_HASH_MISMATCH');
  ensure(plan.runId === runId && plan.namespace === namespace && plan.formatVersion === 1
    && original.runId === runId && original.attemptId === attemptId && original.plan === names.plan
    && original.root === plan.root && original.status === 'FAIL'
    && original.normalCloseEvidence?.exitCode === 0 && original.normalCloseEvidence.signal === null
    && original.uninstall?.exitCode === 0 && original.uninstall.signal === null
    && original.finalProcesses?.processes?.length === 0 && original.finalProcesses.listeners?.length === 0,
  'CLEANUP_REQUIRES_EXACT_COMPLETED_FAILED_FIXTURE');
  ensure(plan.executableFacts?.sha256 === pinned.executable && original.executableFacts?.sha256 === pinned.executable
    && restore.runId === runId && restore.cleanupId === restoreId && restore.plan === names.plan
    && restore.completedRunReceipt === names.original && restore.root === plan.root && restore.status === 'PASS'
    && restore.planFacts?.sha256 === pinned.plan && restore.completedRunFacts?.sha256 === pinned.original
    && restore.registry?.status === 'restored' && restore.finalRegistration?.registration === null
    && restore.finalRegistration.keys?.length === 0 && restore.finalRegistration.shortcutCount === 0
    && restore.finalRegistration.runPresent === false
    && JSON.stringify(restore.data) === JSON.stringify(original.retainedAfterUninstall)
    && JSON.stringify(original.retainedBeforeUninstall) === JSON.stringify(original.retainedAfterUninstall),
  'CLEANUP_REQUIRES_EXACT_UNINSTALL_AND_RESTORE_PROOF');
}

export function validateCredentialRows(rows, suppliedNamespace) {
  ensure(suppliedNamespace === namespace && Array.isArray(rows) && rows.length === 2
    && rows.every(row => Array.isArray(row) && row.length === 3 && /^p:[a-f0-9]{64}$/.test(row[0])
      && row[1] === 'paired' && /^credential:[a-f0-9]{64}$/.test(row[2])
      && Buffer.byteLength(`Markbridge/${suppliedNamespace}/${row[2]}`) <= 180)
    && new Set(rows.map(row => row[0])).size === rows.length
    && new Set(rows.map(row => row[2])).size === rows.length, 'CLEANUP_CREDENTIAL_SCOPE_INVALID');
}

export function validateRecoveryBaseline(plan, failed, audit, facts, manifest) {
  const sameManifest = (left, right) => left?.files === right?.files && left?.bytes === right?.bytes
    && left?.manifestSha256 === right?.manifestSha256;
  ensure(facts.failedReader?.sha256 === pinned.failedReader && facts.readerAudit?.sha256 === pinned.readerAudit,
    'CLEANUP_READER_RECOVERY_HASH_MISMATCH');
  ensure(failed.kind === 'exact_failed_fixture_credential_revocation' && failed.runId === runId
    && failed.root === plan.root && failed.namespace === namespace && failed.status === 'FAIL'
    && failed.originalNativeAcceptanceStatus === 'FAIL' && failed.failedStage === 'readonly-database-baseline'
    && failed.errors?.length === 1 && failed.errors[0].code === 'READONLY_SQLITE_INSPECTION_CHANGED_FILES'
    && failed.copiedExecutableFacts === undefined && failed.mainDataEvidence === undefined
    && failed.credentialPresenceBefore === undefined && failed.credentialPresenceAfter === undefined
    && failed.finalProcesses?.processes?.length === 0 && failed.finalProcesses.listeners?.length === 0,
  'CLEANUP_READER_RECOVERY_ATTEMPT_INVALID');
  ensure(audit.kind === 'exact_stopped_fixture_reader_auxiliary_audit' && audit.runId === runId
    && audit.originalReaderReceiptSha256 === pinned.failedReader && audit.originalNativeStatus === 'FAIL'
    && audit.readerAttemptStatus === 'FAIL' && audit.nativeApplication === 'NOT_RUN' && audit.credentialRevocation === 'NOT_RUN'
    && audit.processes?.processes?.length === 0 && audit.processes.listeners?.length === 0
    && audit.onlyAuxiliaryAdditions === true && audit.originalDatabaseUnchanged === true
    && audit.auxiliary?.length === 2 && audit.auxiliary.some(row => row.name === 'markbridge.sqlite-wal' && row.bytes === 0
      && row.sha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    && audit.auxiliary.some(row => row.name === 'markbridge.sqlite-shm' && row.bytes === 32768
      && row.sha256 === 'fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb')
    && sameManifest(audit.withoutAuxiliary, failed.retainedManifestBefore)
    && sameManifest(manifest, audit.currentManifest) && sameManifest(manifest.withoutSqliteWalShm, audit.withoutAuxiliary),
  'CLEANUP_READER_AUXILIARY_BASELINE_MISMATCH');
}

export function validateDatabaseCopyFacts(source, sourceAfter, copy) {
  ensure(JSON.stringify(source) === JSON.stringify(sourceAfter) && JSON.stringify(source) === JSON.stringify(copy),
    'CLEANUP_SQLITE_COPY_NOT_CONSISTENT');
}

async function plain(path, directory = false) {
  const info = await lstat(path);
  ensure(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile())
    && await realpath(path) === resolve(path), 'CLEANUP_PATH_REDIRECTED_OR_WRONG_KIND');
  return info;
}
async function retainedManifest(plan) {
  await assertSubdir(plan.root, plan.appData, 'app-data');
  const pending = [plan.appData], files = [];
  while (pending.length) {
    const directory = pending.pop(); await plain(directory, true);
    for (const name of await readdir(directory)) {
      const path = join(directory, name), info = await lstat(path);
      ensure(!info.isSymbolicLink() && await realpath(path) === path, 'CLEANUP_DATA_TREE_REDIRECTED');
      if (info.isDirectory()) pending.push(path);
      else { ensure(info.isFile(), 'CLEANUP_DATA_TREE_SPECIAL_FILE'); files.push(path); }
    }
  }
  const rows = [];
  for (const path of files.sort()) { const facts = await fileFacts(path); rows.push([path.slice(plan.appData.length + 1), facts.bytes, facts.sha256]); }
  const summarize = selected => ({ files: selected.length, bytes: selected.reduce((sum, row) => sum + row[1], 0),
    manifestSha256: hash(JSON.stringify(selected)) });
  return { ...summarize(rows), withoutSqliteWalShm: summarize(rows.filter(row => !['markbridge.sqlite-wal', 'markbridge.sqlite-shm'].includes(row[0]))) };
}
async function databaseFiles(plan, directory = plan.appData, name = 'app-data') {
  const facts = {};
  await assertSubdir(plan.root, directory, name);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const path = join(directory, `markbridge.sqlite${suffix}`);
    try { await plain(path); facts[suffix || 'database'] = await fileFacts(path); }
    catch (error) { if (error.code !== 'ENOENT' || suffix === '') throw error; facts[suffix] = null; }
  }
  return facts;
}
// Only fixed SQL. Raw bookmarks, metadata and operation payloads are hashed inside the reader.
// mode=ro honors copied WAL. The original database is never opened by SQLite.
// Reader bookkeeping may change copied SHM; no immutable shortcut or write statement.
const sqliteReader = `import hashlib,json,pathlib,sqlite3,sys
p=pathlib.Path(sys.argv[1])
c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
c.execute('PRAGMA query_only=ON')
tables={'profile_identity':'SELECT id,instance_id,source_epoch,display_name,paired_origin,last_synced_at FROM profiles ORDER BY id',
'bookmarks_cache':'SELECT * FROM bookmarks_cache ORDER BY bookmark_id',
'bookmark_metadata':'SELECT * FROM bookmark_metadata ORDER BY bookmark_id',
'tags':'SELECT * FROM tags ORDER BY id',
'bookmark_tags':'SELECT * FROM bookmark_tags ORDER BY bookmark_id,tag_id',
'operations':'SELECT * FROM operations ORDER BY operation_id',
'operation_steps':'SELECT * FROM operation_steps ORDER BY operation_id,ordinal',
'snapshots':'SELECT * FROM snapshots ORDER BY operation_id',
'tag_journal':'SELECT * FROM tag_journal ORDER BY journal_id'}
digests={}
for name,query in tables.items():
 rows=c.execute(query).fetchall()
 digests[name]={'rows':len(rows),'sha256':hashlib.sha256(json.dumps(rows,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()}
result={'profiles':c.execute('SELECT id,pairing_state,credential_reference FROM profiles ORDER BY id').fetchall(),
'mirrorSources':c.execute('SELECT count(*) FROM mirror_sources').fetchone()[0],'digests':digests}
c.close()
print(json.dumps(result,separators=(',',':')))
`;
async function inspectDatabase(plan, cleanupId, label) {
  const name = `credential-inspection-${cleanupId}-${label}`, directory = join(plan.root, name);
  const inspection = { kind: 'stopped_fixture_private_sqlite_copy', directory: name, sourceBefore: null, sourceAfterCopy: null,
    sourceAfterRead: null, copyBeforeRead: null, copyAfterRead: null };
  try {
    inspection.beforeProcesses = await noOwnedProcesses(plan);
    inspection.sourceBefore = await databaseFiles(plan);
    await assertSubdir(plan.root, directory, name); await mkdir(directory); await plain(directory, true);
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (inspection.sourceBefore[suffix || 'database'] === null) continue;
      await copyFile(join(plan.appData, `markbridge.sqlite${suffix}`), join(directory, `markbridge.sqlite${suffix}`), constants.COPYFILE_EXCL);
    }
    inspection.sourceAfterCopy = await databaseFiles(plan);
    inspection.copyBeforeRead = await databaseFiles(plan, directory, name);
    validateDatabaseCopyFacts(inspection.sourceBefore, inspection.sourceAfterCopy, inspection.copyBeforeRead);
    inspection.afterCopyProcesses = await noOwnedProcesses(plan);
    const { stdout } = await run('python', ['-c', sqliteReader, join(directory, 'markbridge.sqlite')],
      { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
    inspection.sourceAfterRead = await databaseFiles(plan);
    inspection.copyAfterRead = await databaseFiles(plan, directory, name);
    inspection.afterReadProcesses = await noOwnedProcesses(plan);
    ensure(JSON.stringify(inspection.sourceBefore) === JSON.stringify(inspection.sourceAfterRead), 'CLEANUP_ORIGINAL_SQLITE_FILES_CHANGED');
    const snapshot = JSON.parse(stdout);
    ensure(snapshot.mirrorSources === 0, 'CLEANUP_FIXTURE_HAS_FILE_MIRRORS');
    return { ...snapshot, databaseFiles: inspection.sourceAfterRead, inspection };
  } catch (error) {
    try { inspection.sourceAfterFailure = await databaseFiles(plan); }
    catch (inspectionError) { inspection.sourceInspectionErrorCode = safeErrorCode(inspectionError, 'CLEANUP_SOURCE_FACTS_UNAVAILABLE'); }
    try { inspection.copyAfterFailure = await databaseFiles(plan, directory, name); }
    catch (inspectionError) { inspection.copyInspectionErrorCode = safeErrorCode(inspectionError, 'CLEANUP_COPY_FACTS_UNAVAILABLE'); }
    error.details = inspection; throw error;
  }
}
async function credentialPresence(plan, references) {
  const facts = [];
  for (const reference of references) {
    const observed = await system('credential', plan.root, ['-Namespace', namespace, '-Reference', reference]);
    ensure(typeof observed.present === 'boolean', 'EXACT_CREDENTIAL_PRESENCE_INVALID');
    facts.push({ referenceSha256: hash(reference), present: observed.present });
  }
  return facts;
}
async function noOwnedProcesses(plan) {
  return until(async () => { const observed = await system('processes', plan.root);
    return observed.processes.length === 0 && observed.listeners.length === 0 ? observed : null;
  }, 'CLEANUP_OWNED_PROCESS_OR_LISTENER_REMAINED');
}

async function main() {
  ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
  ensure(process.argv.length === 4 && resolve(process.argv[2]) === join(evidence, names.plan)
    && resolve(process.argv[3]) === join(evidence, names.original), 'EXACT_7ACC_PLAN_AND_RECEIPT_REQUIRED');
  const cleanupId = randomUUID(), receiptPath = join(evidence, `current-fixture-credential-cleanup-${runId}-${cleanupId}-receipt.json`);
  const report = { kind: 'exact_failed_fixture_credential_revocation', runId, originalAttemptId: attemptId, cleanupId,
    startedAt: new Date().toISOString(), status: 'RUNNING', originalNativeAcceptanceStatus: 'FAIL', namespace,
    originalReaderAttemptStatus: 'FAIL', measurementMethodVersion: 2,
    installation: 'NOT_RUN', chrome: 'NOT_RUN', model: 'NOT_RUN', registry: 'NOT_ACCESSED', forcedTermination: false,
    policy: 'exact namespaced presence only; revoke through trusted Rust API; retain data and executable; no recursive deletion', errors: [] };
  let app, plan, before, stage = 'evidence-guards';
  try {
    const inputs = {}, facts = {};
    for (const [key, name] of Object.entries({ ...names, ...recoveryNames })) { const path = join(evidence, name); await plain(path);
      const bytes = await readFile(path); inputs[key] = JSON.parse(bytes); facts[key] = { bytes: bytes.length, sha256: hash(bytes) }; }
    validateEvidenceInputs(inputs.plan, inputs.original, inputs.restore, facts); plan = inputs.plan;
    report.inputFacts = facts; report.root = plan.root;
    report.helperFacts = await fileFacts(fileURLToPath(import.meta.url));
    report.driverFacts = await fileFacts(join(evidence, 'current-native-driver.mjs'));
    report.systemHelperFacts = await fileFacts(join(evidence, 'current-native-system.ps1'));
    await assertRoot(plan.root); await assertSubdir(plan.root, plan.appData, 'app-data'); await plain(plan.appData, true);
    await assertSubdir(plan.root, plan.installDirectory, 'install');
    ensure(plan.installDirectory === join(plan.root, 'install') && plan.executable === join(plan.installDirectory, 'markbridge-desktop.exe')
      && plan.appData === join(plan.root, 'app-data'), 'CLEANUP_PLAN_PATHS_INVALID');
    const marker = join(plan.root, 'task13-plan.json'); await plain(marker);
    ensure(JSON.stringify(JSON.parse(await readFile(marker, 'utf8'))) === JSON.stringify({ runId }), 'CLEANUP_ROOT_MARKER_MISMATCH');
    report.rootMarkerFacts = await fileFacts(marker); report.beforeProcesses = await noOwnedProcesses(plan);
    const manifest = await retainedManifest(plan);
    validateRecoveryBaseline(plan, inputs.failedReader, inputs.readerAudit, facts, manifest);
    report.retainedManifestBefore = manifest;
    report.readerRecoveryProof = { originalReaderAttemptStatus: 'FAIL', originalReaderReceipt: recoveryNames.failedReader,
      readerAudit: recoveryNames.readerAudit, onlyAuditedWalShmAdditionsAccepted: true };
    stage = 'readonly-database-baseline'; before = await inspectDatabase(plan, cleanupId, 'before');
    validateCredentialRows(before.profiles, plan.namespace);
    const references = before.profiles.map(row => row[2]);
    report.beforeDatabase = { databaseFiles: before.databaseFiles, digests: before.digests, profileCount: before.profiles.length, inspection: before.inspection };
    report.credentialPresenceBefore = await credentialPresence(plan, references);
    stage = 'copy-exact-release';
    const native = nativeReleaseContext(repo);
    ensure(native.artifact === plan.releaseExecutable, 'CLEANUP_CURRENT_RELEASE_PATH_CHANGED');
    await plain(native.artifact); const bytes = await readFile(native.artifact); inspectNativeArtifact(bytes);
    ensure(hash(bytes) === pinned.executable && bytes.length === plan.executableFacts.bytes, 'CLEANUP_CURRENT_RELEASE_HASH_MISMATCH');
    try { await plain(plan.installDirectory, true); ensure((await readdir(plan.installDirectory)).length === 0, 'CLEANUP_INSTALL_DIRECTORY_NOT_EMPTY'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(plan.installDirectory); }
    await assertSubdir(plan.root, plan.installDirectory, 'install');
    await copyFile(native.artifact, plan.executable, constants.COPYFILE_EXCL);
    await plain(plan.executable); report.copiedExecutableFacts = await fileFacts(plan.executable);
    ensure(report.copiedExecutableFacts.sha256 === pinned.executable, 'CLEANUP_COPIED_EXECUTABLE_HASH_MISMATCH');
    stage = 'main-os-isolation-guard'; app = await launchInstalled(plan);
    ensure(app.mainDataEvidence?.observations?.length > 0 && app.mainDataEvidence.observations.every(row => row.expectedMain
      && row.insideFixture && row.observedDirectoryExists && /^[1-9][0-9]{0,18}$/.test(row.creationUtcTicks)),
    'CLEANUP_CREATION_BOUND_MAIN_OS_PROOF_REQUIRED');
    report.mainDataEvidence = app.mainDataEvidence;
    stage = 'trusted-profile-scope';
    const state = await app.invoke('get_bridge_state');
    ensure(state.pending.length === 0 && state.profiles.length === before.profiles.length
      && JSON.stringify(state.profiles.map(profile => profile.profileId).sort()) === JSON.stringify(before.profiles.map(row => row[0]).sort()),
    'CLEANUP_TRUSTED_PROFILE_SET_MISMATCH');
    stage = 'trusted-credential-revocation'; await cleanCredentials(app);
    report.credentialPresenceAfter = await credentialPresence(plan, references);
    ensure(report.credentialPresenceAfter.every(row => !row.present), 'CLEANUP_EXACT_CREDENTIAL_REMAINED');
    stage = 'normal-close'; report.normalClose = await app.close(); app = null;
    ensure(report.normalClose.knownWebviewIdentities?.length > 0
      && report.normalClose.knownWebviewAbsence?.presentPids?.length === 0, 'CLEANUP_CREATION_BOUND_WEBVIEW_ABSENCE_REQUIRED');
    report.finalProcesses = await noOwnedProcesses(plan);
    stage = 'retained-data-verification'; const after = await inspectDatabase(plan, cleanupId, 'after');
    ensure(JSON.stringify(before.digests) === JSON.stringify(after.digests), 'CLEANUP_OTHER_LOCAL_DATA_CHANGED');
    ensure(after.profiles.length === before.profiles.length && after.profiles.every((row, index) => row[0] === before.profiles[index][0]
      && row[1] === 'revoked' && row[2] === null), 'CLEANUP_DATABASE_REVOCATION_NOT_RECORDED');
    report.afterDatabase = { databaseFiles: after.databaseFiles, digests: after.digests, profileCount: after.profiles.length, inspection: after.inspection,
      allReferencesNullAndProfilesRevoked: true, retainedLocalDataUnchanged: true };
    report.status = 'PASS';
  } catch (error) {
    app ??= error.fixtureApp; report.status = 'FAIL'; report.failedStage = stage;
    report.errors.push({ phase: stage, code: safeErrorCode(error, 'FIXTURE_CREDENTIAL_CLEANUP_FAILED') });
    if (error.details ?? app?.lastCloseEvidence) report.failureEvidence = error.details ?? app.lastCloseEvidence;
  } finally {
    if (app) { try { report.finalClose = await app.close(); }
      catch (error) { report.status = 'FAIL'; report.errors.push({ phase: 'final-normal-close', code: safeErrorCode(error, 'FIXTURE_NORMAL_CLOSE_FAILED') }); report.finalClose = error.details ?? app.lastCloseEvidence; } }
    if (plan?.root) { try { report.finalProcesses = await noOwnedProcesses(plan); }
      catch (error) { report.status = 'FAIL'; report.errors.push({ phase: 'final-process-check', code: safeErrorCode(error, 'FIXTURE_PROCESS_CHECK_FAILED') }); } }
    for (const [key, name] of Object.entries({ ...names, ...recoveryNames })) { try { const observed = await fileFacts(join(evidence, name));
      ensure(observed.sha256 === pinned[key], 'ORIGINAL_FIXTURE_EVIDENCE_CHANGED'); }
      catch (error) { report.status = 'FAIL'; report.errors.push({ phase: 'immutable-original-evidence', code: safeErrorCode(error, 'ORIGINAL_EVIDENCE_CHECK_FAILED') }); } }
    report.finishedAt = new Date().toISOString();
    await writeFile(receiptPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, originalNativeAcceptanceStatus: 'FAIL', runId, cleanupId,
      receipt: receiptPath, receiptFacts: await fileFacts(receiptPath), errors: report.errors }));
    if (report.status !== 'PASS') process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
