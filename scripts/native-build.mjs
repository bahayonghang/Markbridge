import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function inspectNativeArtifact(data) {
  const patterns = new Map([
    ['absolute Windows path', /\b[A-Z]:[\\/](?:[^\p{C}\s<>:"|?*\\/]+[\\/])+[^\p{C}\s<>:"|?*\\/]*/iu],
    ['private key header', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
    ['known API key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ]);
  for (const encoding of ['utf8', 'utf16le']) {
    const content = data.toString(encoding);
    for (const [label, pattern] of patterns) {
      assert.ok(!pattern.test(content), `Native artifact contains ${label} (${encoding}).`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'win32', 'Native foundation build targets Windows only.');
  const inherited = process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f')
    ?? process.env.RUSTFLAGS?.trim().split(/\s+/).filter(Boolean)
    ?? [];
  const prefixes = [
    [root, '/workspace'],
    [resolve(process.env.CARGO_HOME ?? resolve(homedir(), '.cargo')), '/cargo-home'],
    [resolve(process.env.RUSTUP_HOME ?? resolve(homedir(), '.rustup')), '/rustup-home'],
    [homedir(), '/build-home'],
  ];
  const flags = [...inherited];
  for (const [source, destination] of prefixes) {
    for (const path of new Set([source, source.replaceAll('\\', '/')])) {
      flags.push(`--remap-path-prefix=${path}=${destination}`);
    }
  }
  const cli = resolve(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js');
  const targetDirectory = resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
  const build = spawnSync(process.execPath, [cli, 'build', '--no-bundle', '--', '--locked'], {
    cwd: resolve(root, 'apps/desktop'),
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') },
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
  const artifact = resolve(targetDirectory, 'release/markbridge-desktop.exe');
  const data = await readFile(artifact);
  inspectNativeArtifact(data);
  console.log(`Native release artifact: PASS; ${data.length} bytes; SHA256 ${createHash('sha256').update(data).digest('hex')}.`);
}
