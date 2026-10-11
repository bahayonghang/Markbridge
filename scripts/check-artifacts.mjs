import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['apps/desktop/dist', 'apps/extension/dist'];
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { await inspect(path); continue; }
    assert.ok(!item.name.endsWith('.map'), `Unexpected source map: ${path}`);
    const content = await readFile(path, 'utf8');
    assert.doesNotMatch(content, /[A-Z]:[\\/](?:Users|Documents)[\\/]|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}\b/i, path);
  }
}
for (const root of roots) await inspect(fileURLToPath(new URL(`../${root}`, import.meta.url)));
const extension = new URL('../apps/extension/dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', extension), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['bookmarks', 'storage', 'alarms']);
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.background, { service_worker: 'worker.js', type: 'module' });
await readFile(new URL(manifest.action.default_popup, extension));
await readFile(new URL(manifest.options_ui.page, extension));
const worker = await readFile(new URL(manifest.background.service_worker, extension), 'utf8');
assert.doesNotMatch(worker, /\beval\s*\(|\bFunction\s*\(/);
console.log('Production assets: MV3 popup/options/worker present; bookmarks/storage/alarms only; no source maps, dynamic code, known secret patterns, or absolute machine paths.');
