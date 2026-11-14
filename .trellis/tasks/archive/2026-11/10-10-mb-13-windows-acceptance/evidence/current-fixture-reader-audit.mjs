// Read only the exact stopped 7acc fixture; never open SQLite or alter its files.
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertRoot, assertSubdir, ensure, evidence, system } from './current-native-driver.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = '7accfee5-259b-4733-8d77-60c71b7dda75';
const planBytes = await readFile(join(evidence, `current-installer-${id}-plan.json`));
ensure(hash(planBytes) === 'c7d5d1eef6976e83f0f995cc8e405385ef3a4c5baf1e2558cb0ac4d7ca0f6d6a', 'EXACT_PLAN_REQUIRED');
const plan = JSON.parse(planBytes);
const original = JSON.parse(await readFile(join(evidence, `current-installer-${id}-de4114d5-d8fc-4d7f-be8c-76e46cee781b-receipt.json`)));
const failedBytes = await readFile(join(evidence, `current-fixture-credential-cleanup-${id}-fd93ab4d-3297-4e69-88e4-476cedc49f9f-receipt.json`));
ensure(hash(failedBytes) === '1607d3e69368abd96d453a3ebb32bcfaebcb13e0dc1c9d251557019cad7285c9', 'EXACT_READER_FAILURE_REQUIRED');
await assertRoot(plan.root); await assertSubdir(plan.root, plan.appData, 'app-data');
const stopped = await system('processes', plan.root);
ensure(stopped.processes.length === 0 && stopped.listeners.length === 0, 'FIXTURE_NOT_STOPPED');
const files = [], pending = [plan.appData];
while (pending.length) {
  const directory = pending.pop();
  ensure(!((await lstat(directory)).isSymbolicLink()) && await realpath(directory) === directory, 'REDIRECTED_DIRECTORY');
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await lstat(path);
    ensure(!info.isSymbolicLink() && await realpath(path) === path, 'REDIRECTED_FILE');
    if (info.isDirectory()) pending.push(path);
    else { ensure(info.isFile(), 'SPECIAL_FILE'); files.push(path); }
  }
}
const rows = [];
for (const path of files.sort()) {
  const bytes = await readFile(path);
  rows.push([path.slice(plan.appData.length + 1), bytes.length, hash(bytes)]);
}
const facts = values => ({ files: values.length, bytes: values.reduce((sum, row) => sum + row[1], 0), manifestSha256: hash(JSON.stringify(values)) });
const auxiliary = rows.filter(row => ['markbridge.sqlite-wal', 'markbridge.sqlite-shm'].includes(row[0]));
const withoutAuxiliary = facts(rows.filter(row => !['markbridge.sqlite-wal', 'markbridge.sqlite-shm'].includes(row[0])));
const originalData = original.retainedAfterUninstall;
const onlyAuxiliaryAdditions = withoutAuxiliary.files === originalData.files && withoutAuxiliary.bytes === originalData.bytes
  && withoutAuxiliary.manifestSha256 === originalData.manifestSha256;
const report = { kind: 'exact_stopped_fixture_reader_auxiliary_audit', runId: id, observedAtUtc: new Date().toISOString(),
  originalNativeStatus: 'FAIL', readerAttemptStatus: 'FAIL', nativeApplication: 'NOT_RUN', credentialRevocation: 'NOT_RUN',
  originalReaderReceiptSha256: hash(failedBytes), processes: stopped, currentManifest: facts(rows), withoutAuxiliary,
  auxiliary: auxiliary.map(([name, bytes, sha256]) => ({ name, bytes, sha256 })), onlyAuxiliaryAdditions,
  originalDatabaseUnchanged: rows.some(row => row[0] === 'markbridge.sqlite' && row[1] === 221184
    && row[2] === 'b3d6e14b3fd49aba66941cb50b7a23388173c92bf6576611db07cb93cffc85a8'),
  policy: 'metadata/hash reads only; no SQLite connection, copy, launch, deletion, credential or registry action' };
const path = join(evidence, 'current-fixture-reader-fd93-audit.json');
await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ audit: path, auditSha256: hash(await readFile(path)), ...report }));
