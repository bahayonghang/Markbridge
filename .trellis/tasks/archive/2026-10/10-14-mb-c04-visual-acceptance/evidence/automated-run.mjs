import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';

const repo = resolve(import.meta.dirname, '../../../..');
const runId = `run-${Date.now()}`;
const output = join(import.meta.dirname, `automated-${runId}`);
const browserOutput = join(import.meta.dirname, `browser-${runId}`);
await mkdir(output, { recursive: true });
await mkdir(browserOutput, { recursive: true });
const source = JSON.parse(await readFile(join(import.meta.dirname, '../../10-14-mb-c03-workspace-layout/evidence/current-source.json'), 'utf8'));
async function verifySource() {
  const changed = [];
  for (const file of source.files) {
    const actual = createHash('sha256').update(await readFile(join(repo, file.path))).digest('hex');
    if (actual !== file.sha256) changed.push(file.path);
  }
  if (changed.length) throw new Error(`SOURCE_CHANGED: ${changed.join(', ')}`);
}
await verifySource();
const testPaths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tests/e2e'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).sort();
const browserFiles = await Promise.all(testPaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(join(repo, path))).digest('hex') })));
const result = {
  startedAt: new Date().toISOString(),
  productionFingerprint: source.productionFingerprint,
  sourceReference: '../../../10-14-mb-c03-workspace-layout/evidence/current-source.json',
  browserFiles,
  environment: { platform: os.platform(), release: os.release(), architecture: os.arch(), node: process.version, pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() },
  browserEvidenceDirectory: browserOutput,
  commands: [],
};
async function save() { await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`); }
await save();
console.log(`AUTOMATED_OUTPUT=${output}\nBROWSER_OUTPUT=${browserOutput}`);
const commands = [
  ['lint', ['lint']], ['typecheck', ['typecheck']], ['test', ['test']],
  ['protocol', ['protocol:check']], ['build', ['build']],
  ['browser', ['test:e2e', '--workers=2', '--reporter=line,json', '--output', join(browserOutput, 'test-artifacts')]],
];
for (const [name, args] of commands) {
  await verifySource();
  const command = { name, command: ['pnpm', ...args], startedAt: new Date().toISOString(), log: `${name}.log` };
  result.commands.push(command); await save();
  console.log(`START ${name}`);
  const log = createWriteStream(join(output, command.log));
  const child = spawn('pnpm', args, {
    cwd: repo, windowsHide: true,
    env: { ...process.env, MARKBRIDGE_EVIDENCE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: join(browserOutput, 'playwright-report.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  await new Promise(done => log.end(done));
  command.exitCode = code; command.finishedAt = new Date().toISOString();
  await verifySource(); await save();
  console.log(`END ${name}: exit ${code}`);
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
result.finishedAt = new Date().toISOString();
result.status = result.commands.length === commands.length && result.commands.every(command => command.exitCode === 0) ? 'PASS' : 'FAIL';
await save();
console.log(`RESULT ${result.status}`);
