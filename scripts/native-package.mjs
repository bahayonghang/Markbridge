import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNativeArtifact, nativeReleaseContext } from './native-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sevenZipCandidates = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sevenZipRuns(command) {
  const probe = spawnSync(command, ['i'], { stdio: 'ignore' });
  return probe.error == null && probe.status === 0;
}

async function resolveSevenZip() {
  for (const candidate of sevenZipCandidates) {
    try {
      await access(candidate);
    } catch {
      continue;
    }
    if (sevenZipRuns(candidate)) return candidate;
  }
  if (sevenZipRuns('7z')) return '7z';
  return null;
}

async function listAndScanInstaller(installer, releaseBytes) {
  const sevenZip = await resolveSevenZip();
  if (sevenZip === null) {
    console.log('NSIS content list: NOT_RUN; 7-Zip is absent.');
    return;
  }
  const listed = spawnSync(sevenZip, ['l', installer], { encoding: 'utf8' });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) process.exit(listed.status ?? 1);
  console.log(listed.stdout);
  const extractDir = await mkdtemp(join(tmpdir(), 'mb13-nsis-'));
  try {
    const extracted = spawnSync(sevenZip, ['e', installer, `-o${extractDir}`, 'markbridge-desktop.exe', '-y'], {
      encoding: 'utf8',
    });
    if (extracted.error) throw extracted.error;
    if (extracted.status !== 0) process.exit(extracted.status ?? 1);
    const packed = await readFile(join(extractDir, 'markbridge-desktop.exe'));
    inspectNativeArtifact(packed);
    const same = packed.equals(releaseBytes);
    console.log(`Packaged executable: PASS; ${packed.length} bytes; SHA256 ${sha256(packed)}; matches release exe ${same}.`);
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'win32', 'Native package build targets Windows only.');
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('./native-build.mjs', import.meta.url))], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status ?? 1);

  const release = nativeReleaseContext(root);
  const bundle = spawnSync(process.execPath, [
    release.cli,
    'bundle',
    '--bundles', 'nsis',
    '--no-sign',
    '--no-binary-patching',
    '--ci',
    '--config', JSON.stringify({ bundle: { active: true, targets: ['nsis'] } }),
  ], {
    cwd: resolve(root, 'apps/desktop'),
    env: release.env,
    stdio: 'inherit',
  });
  if (bundle.error) throw bundle.error;
  if (bundle.status !== 0) process.exit(bundle.status ?? 1);

  const releaseBytes = await readFile(release.artifact);
  inspectNativeArtifact(releaseBytes);
  console.log(`Post-bundle release executable: PASS; ${releaseBytes.length} bytes; SHA256 ${sha256(releaseBytes)}.`);

  const bundleDir = resolve(release.targetDirectory, 'release/bundle/nsis');
  const installers = (await readdir(bundleDir)).filter((name) => name.endsWith('.exe')).sort();
  assert.ok(installers.length > 0, 'NSIS bundle did not produce an installer.');
  for (const name of installers) {
    const installer = resolve(bundleDir, name);
    const bytes = await readFile(installer);
    console.log(`Local NSIS package: unsigned; unpublished; ${name}; ${bytes.length} bytes; SHA256 ${sha256(bytes)}.`);
    await listAndScanInstaller(installer, releaseBytes);
  }
}
