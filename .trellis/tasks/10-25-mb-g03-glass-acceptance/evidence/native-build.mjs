// Task-local native entry; reuses the production host, remapping and artifact guards.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nativeReleaseContext, assertNativeHost, inspectNativeArtifact } from '../../../../scripts/native-build.mjs';
import { runVisible } from '../../../../scripts/run-command.mjs';
let repo = resolve(import.meta.dirname);
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) { const parent = resolve(repo, '..'); if (parent === repo) throw new Error('WORKSPACE_ROOT_NOT_FOUND'); repo = parent; }
const targetDirectory = resolve(repo, 'runs/airy-glass-native-target');
await mkdir(targetDirectory, { recursive: true });
const release = nativeReleaseContext(repo, { env: { ...process.env, CARGO_TARGET_DIR: targetDirectory } });
assertNativeHost(release);
const cli = join(repo, 'node_modules/@tauri-apps/cli/tauri.js');
const args = [cli, 'build', '--target', release.target, '--no-bundle', '--config', join(import.meta.dirname, 'native-build.config.json'), '--', '--locked'];
const receipt = { startedAt: new Date().toISOString(), kind: 'current_g03_release', target: release.target, targetDirectory, artifact: release.artifact, command: ['node', ...args], environmentAdaptation: 'ordinary frozen-lock root node_modules and raw Rust1.99 PATH; task-only beforeBuild command invokes Vite directly; production config/source unchanged', installation: 'NOT_RUN', signing: 'NOT_RUN', bundling: 'NOT_RUN' };
try {
 const build = await runVisible(process.execPath, args, { cwd: join(repo, 'apps/desktop'), env: release.env });
 receipt.buildExitCode = build.status;
 if (build.status !== 0) throw new Error('NATIVE_BUILD_FAILED');
 const data = await readFile(release.artifact); inspectNativeArtifact(data, release);
 receipt.artifactScan = 'PASS'; receipt.exeBytes = data.length; receipt.exeSha256 = createHash('sha256').update(data).digest('hex');
 const seed = await runVisible('cargo', ['build', '--locked', '-p', 'markbridge-core', '--example', 'seed_profile_cache'], { cwd: repo, env: release.env });
 receipt.seederBuildExitCode = seed.status;
 if (seed.status !== 0) throw new Error('SEEDER_BUILD_FAILED');
 receipt.seeder = join(targetDirectory, 'debug/examples/seed_profile_cache.exe');
 receipt.seederSha256 = createHash('sha256').update(await readFile(receipt.seeder)).digest('hex');
 receipt.status = 'PASS';
} catch (error) { receipt.status = 'FAIL'; receipt.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_BUILD_OR_SCAN_FAILED'; process.exitCode = 1; }
receipt.finishedAt = new Date().toISOString();
await writeFile(join(import.meta.dirname, 'native-build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, error: receipt.error, exeSha256: receipt.exeSha256, artifact: receipt.artifact }));
