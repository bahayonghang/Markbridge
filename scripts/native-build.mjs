import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function nativePlatform(platform = process.platform, arch = process.arch) {
  const hosts = { 'win32:x64': ['x86_64-pc-windows-msvc', 'markbridge-desktop.exe', ['nsis']],
    'darwin:arm64': ['aarch64-apple-darwin', 'markbridge-desktop', ['app', 'dmg']],
    'linux:x64': ['x86_64-unknown-linux-gnu', 'markbridge-desktop', ['deb', 'appimage']] };
  const selected = hosts[`${platform}:${arch}`];
  assert.ok(selected, 'Native platform/architecture is outside the configured acceptance targets.');
  return { platform, arch, target: selected[0], binaryName: selected[1], bundles: [...selected[2]] };
}

export function inspectNativeFormat(data, platform, arch) {
  nativePlatform(platform, arch);
  let valid = false;
  if (platform === 'win32' && data.length >= 64 && data.subarray(0, 2).equals(Buffer.from('MZ'))) {
    const offset = data.readUInt32LE(0x3c);
    valid = offset >= 64 && offset + 24 <= data.length && data.subarray(offset, offset + 4).equals(Buffer.from('PE\0\0')) && data.readUInt16LE(offset + 4) === 0x8664;
  } else if (platform === 'linux' && data.length >= 64) {
    valid = data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && data[4] === 2 && data[5] === 1 && [2, 3].includes(data.readUInt16LE(16)) && data.readUInt16LE(18) === 62;
  } else if (platform === 'darwin' && data.length >= 32) {
    valid = data.readUInt32LE(0) === 0xfeedfacf && data.readUInt32LE(4) === 0x0100000c && data.readUInt32LE(12) === 2;
  }
  assert.ok(valid, 'Native executable format/architecture does not match the selected host.');
}

export function inspectNativeArtifact(data, { platform, arch, sourcePrefixes = [] } = {}) {
  if (platform !== undefined) inspectNativeFormat(data, platform, arch);
  const patterns = new Map([
    ['absolute Windows path', /\b[A-Z]:[\\/](?:[^\p{C}\s<>:"|?*\\/]+[\\/])+[^\p{C}\s<>:"|?*\\/]*/iu],
    ['absolute POSIX user path', /\/(?:Users|home)\/[^\p{C}\s<>"'/]+\/(?:[^\p{C}\s<>"'/]+\/)*[^\p{C}\s<>"'/]+/u],
    ['private key header', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
    ['known API key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ]);
  for (const encoding of ['utf8', 'utf16le']) {
    const content = data.toString(encoding);
    for (const [label, pattern] of patterns) {
      assert.ok(!pattern.test(content), `Native artifact contains ${label} (${encoding}).`);
    }
    for (const prefix of sourcePrefixes) {
      for (const value of new Set([prefix, prefix.replaceAll('\\', '/')])) {
        assert.ok(!content.includes(value), `Native artifact contains configured build prefix (${encoding}).`);
      }
    }
  }
}

export function nativeReleaseContext(workspaceRoot, { platform = process.platform, arch = process.arch, env = process.env, userHome = homedir() } = {}) {
  const selected = nativePlatform(platform, arch), paths = platform === 'win32' ? win32 : posix;
  assert.ok(paths.isAbsolute(workspaceRoot) && paths.isAbsolute(userHome), 'Native workspace/home paths must be absolute.');
  const workspace = paths.resolve(workspaceRoot), home = paths.resolve(userHome);
  const cargoHome = paths.resolve(workspace, env.CARGO_HOME ?? paths.join(home, '.cargo'));
  const rustupHome = paths.resolve(workspace, env.RUSTUP_HOME ?? paths.join(home, '.rustup'));
  const targetDirectory = paths.resolve(workspace, env.CARGO_TARGET_DIR ?? 'target');
  const inherited = env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f').filter(Boolean)
    ?? env.RUSTFLAGS?.trim().split(/\s+/).filter(Boolean)
    ?? [];
  const prefixes = [
    [home, '/build-home'], [workspace, '/workspace'], [cargoHome, '/cargo-home'],
    [rustupHome, '/rustup-home'], [targetDirectory, '/build-target'],
  ];
  const flags = [...inherited], sourcePrefixes = new Set();
  for (const [source, destination] of prefixes) {
    const candidates = new Set([source]);
    if (platform === process.platform) {
      try { candidates.add(realpathSync.native(source)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const candidate of candidates) for (const path of new Set([candidate, candidate.replaceAll('\\', '/')])) {
      flags.push(`--remap-path-prefix=${path}=${destination}`);
      sourcePrefixes.add(path);
    }
  }
  const releaseDirectory = paths.join(targetDirectory, selected.target, 'release');
  return {
    ...selected, cli: paths.join(workspace, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'),
    targetDirectory, releaseDirectory, artifact: paths.join(releaseDirectory, selected.binaryName), sourcePrefixes: [...sourcePrefixes],
    env: {
      ...env, CARGO_TARGET_DIR: targetDirectory,
      ...(env.CARGO_HOME === undefined ? {} : { CARGO_HOME: cargoHome }),
      ...(env.RUSTUP_HOME === undefined ? {} : { RUSTUP_HOME: rustupHome }),
      CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f'),
    },
  };
}

export function parseRustHost(output) {
  const hosts = output.split(/\r?\n/).filter(line => line.startsWith('host: '));
  assert.equal(hosts.length, 1, 'Rust toolchain host metadata is missing or ambiguous.');
  const target = hosts[0].slice(6);
  assert.ok(/^[a-z0-9_]+(?:-[a-z0-9_]+)+$/.test(target), 'Rust toolchain host metadata is invalid.');
  return target;
}

export function assertNativeHost(release) {
  const version = spawnSync('rustc', ['--version', '--verbose'], { env: release.env, encoding: 'utf8' });
  if (version.error) throw version.error;
  assert.equal(version.status, 0, 'Rust toolchain host probe failed.');
  assert.equal(parseRustHost(version.stdout), release.target, 'Rust toolchain host does not match the selected native runtime.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = nativeReleaseContext(root);
  assertNativeHost(release);
  const build = spawnSync(process.execPath, [release.cli, 'build', '--target', release.target, '--no-bundle', '--', '--locked'], {
    cwd: resolve(root, 'apps/desktop'),
    env: release.env,
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
  const data = await readFile(release.artifact);
  inspectNativeArtifact(data, release);
  console.log(`Native release artifact: PASS; ${data.length} bytes; SHA256 ${createHash('sha256').update(data).digest('hex')}.`);
}
