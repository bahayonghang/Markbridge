import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFICIAL_EXTENSION_ID = 'caimbneegiphplhknaokehleclahckoa';
export function extensionIdFromKey(base64Key) {
  assert.equal(typeof base64Key, 'string', 'manifest.key must be a base64 string');
  const der = Buffer.from(base64Key, 'base64');
  assert.ok(der.length > 0 && der.toString('base64') === base64Key, 'manifest.key must be canonical base64');
  const digest = createHash('sha256').update(der).digest().subarray(0, 16);
  return [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))).join('');
}

const FORBIDDEN_DIST_PATTERN = /[A-Z]:[\\/](?:Users|Documents)[\\/]|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}\b/i;

export async function inspectDistFiles(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { await inspectDistFiles(path); continue; }
    assert.ok(!item.name.endsWith('.map'), `Unexpected source map: ${path}`);
    const content = await readFile(path, 'utf8');
    assert.doesNotMatch(content, FORBIDDEN_DIST_PATTERN, path);
  }
}

export async function inspectExtensionDist(extensionDir, expectedExtensionId = OFFICIAL_EXTENSION_ID) {
  await inspectDistFiles(extensionDir);
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(extensionIdFromKey(manifest.key), expectedExtensionId);
  assert.deepEqual(manifest.permissions, ['bookmarks', 'storage', 'alarms', 'scripting', 'activeTab']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.background, { service_worker: 'worker.js', type: 'module' });
  await readFile(join(extensionDir, manifest.action.default_popup));
  await readFile(join(extensionDir, manifest.options_ui.page));
  const worker = await readFile(join(extensionDir, manifest.background.service_worker), 'utf8');
  assert.doesNotMatch(worker, /\beval\s*\(|\bFunction\s*\(/);
  return manifest;
}

async function runCheck() {
  const roots = ['apps/desktop/dist', 'apps/extension/dist'];
  await inspectDistFiles(fileURLToPath(new URL(`../${roots[0]}`, import.meta.url)));
  const desktopAssets = fileURLToPath(new URL('../apps/desktop/dist/assets/', import.meta.url));
  for (const name of await readdir(desktopAssets)) {
    if (!name.endsWith('.js')) continue;
    const bytes = (await stat(join(desktopAssets, name))).size;
    assert.ok(bytes <= 500_000, `Desktop chunk ${name} is ${bytes} bytes. Split that module below 500 kB.`);
  }
  await inspectExtensionDist(fileURLToPath(new URL(`../${roots[1]}`, import.meta.url)));
  console.log('Production assets: MV3 fixed identity, popup/options/worker present; permissions are bookmarks, storage, alarms, scripting, and activeTab; no source maps, dynamic code, known secret patterns, or absolute machine paths.');
}

const isEntry = process.argv[1]
  && (process.platform === 'win32'
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isEntry) {
  await runCheck();
}
