import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('MV3 read-only bridge has bounded permissions and local worker', async () => {
  const manifest = await readJson('apps/extension/public/manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '134');
  assert.equal(manifest.action.default_popup, 'index.html');
  assert.deepEqual(manifest.permissions, ['bookmarks', 'storage', 'alarms', 'scripting', 'activeTab']);
  assert.deepEqual(manifest.background, { service_worker: 'worker.js', type: 'module' });
  assert.deepEqual(manifest.options_ui, { page: 'options.html', open_in_tab: true });
  assert.match(manifest.content_security_policy.extension_pages, /connect-src ws:\/\/127\.0\.0\.1:\*/);
  for (const key of ['host_permissions', 'content_scripts', 'externally_connectable']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('capability is limited to local main window', async () => {
  const capability = await readJson('apps/desktop/src-tauri/capabilities/main.json');
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.remote, undefined);
  const config = await readJson('apps/desktop/src-tauri/tauri.conf.json');
  assert.deepEqual(config.app.security.capabilities, ['main']);
  assert.match(config.app.security.csp, /frame-src 'none'/);
  assert.equal(config.app.windows.length, 1);
});
