import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const task = resolve(root, '.trellis/tasks/10-25-mb-g03-glass-acceptance');
const output = join(task, 'evidence/automated');
await mkdir(output, { recursive: true });
const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'crates', 'packages', 'scripts', 'assets', 'tests', '.cargo', '.trellis/spec', 'Cargo.toml', 'Cargo.lock', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'justfile', 'tsconfig.base.json', 'tsconfig.tools.json', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.js', 'DESIGN.md'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean);
names.push('.trellis/tasks/10-25-mb-g03-glass-acceptance/automated-run.mjs', '.trellis/tasks/10-25-mb-g03-glass-acceptance/validation.config.mjs');
const files = [];
for (const path of [...new Set(names)].sort()) {
  const bytes = await readFile(join(root, path));
  files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const fingerprint = createHash('sha256').update(files.map(file => `${file.path}\0${file.sha256}\n`).join('')).digest('hex');
await writeFile(join(output, 'source-inputs.json'), JSON.stringify({ createdAt: new Date().toISOString(), fingerprint, files }, null, 2) + '\n');

const steps = [
  ['lint', ['node_modules/eslint/bin/eslint.js', 'apps', 'packages', 'scripts', 'tests', 'eslint.config.js', 'playwright.config.ts', 'vitest.config.ts', '--max-warnings', '0']],
  ...['apps/desktop', 'apps/extension', 'packages/protocol'].map(path => [`typecheck-${path.split('/').at(-1)}`, ['node_modules/typescript/bin/tsc', '-p', `${path}/tsconfig.json`]]),
  ['typecheck-tools', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.tools.json']],
  ['vitest', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${join(output, 'vitest-results.json')}`]],
  ['node-tests', ['--test', '--test-reporter=tap', 'scripts/protocol.test.mjs', 'scripts/foundation.test.mjs', 'scripts/native-artifact.test.mjs', 'scripts/command.test.mjs']],
  ['protocol', ['scripts/protocol.mjs', '--check']],
  ['build-protocol', ['node_modules/typescript/bin/tsc', '-p', 'packages/protocol/tsconfig.json']],
  ['build-desktop', [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], resolve(root, 'apps/desktop')],
  ['build-extension', [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], resolve(root, 'apps/extension')],
  ['artifacts', ['scripts/check-artifacts.mjs']],
];
const result = { startedAt: new Date().toISOString(), node: process.version, fingerprint, steps: [] };
for (const [name, args, cwd = root] of steps) {
  const started = Date.now();
  console.log(`START ${name}`);
  const stdout = await open(join(output, `${name}.stdout.log`), 'w');
  const stderr = await open(join(output, `${name}.stderr.log`), 'w');
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', stdout.fd, stderr.fd] });
  const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolveExit({ code, signal })); });
  await stdout.close(); await stderr.close();
  result.steps.push({ name, executable: 'node', args, cwd: cwd === root ? '.' : cwd.slice(root.length + 1), ...code, elapsedMs: Date.now() - started });
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`END ${name} ${code.code === 0 ? 'PASS' : 'FAIL'} ${Date.now() - started}ms`);
}
result.completedAt = new Date().toISOString();
result.status = result.steps.every(step => step.code === 0) ? 'PASS' : 'FAIL';
await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
process.exitCode = result.status === 'PASS' ? 0 : 1;
