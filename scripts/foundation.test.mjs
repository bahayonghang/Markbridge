import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('native dev preserves JSON arguments, desktop cwd, port and CLI exit status', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'markbridge dev & '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = join(root, 'apps/desktop');
  const cliDirectory = join(desktop, 'node_modules/@tauri-apps/cli');
  await mkdir(cliDirectory, { recursive: true });
  await mkdir(join(root, 'scripts'));
  for (const name of ['tauri-dev.mjs', 'dev-port.mjs']) {
    await copyFile(new URL(name, import.meta.url), join(root, 'scripts', name));
  }
  for (const exitCode of [0, 23]) {
    await writeFile(join(cliDirectory, 'tauri.js'), `
      console.log(JSON.stringify({
        args: process.argv.slice(2), cwd: process.cwd(), port: process.env.MARKBRIDGE_DEV_PORT,
      }));
      process.exit(${exitCode});
    `);
    const result = spawnSync(process.execPath, [join(root, 'scripts/tauri-dev.mjs')], {
      cwd: tmpdir(),
      env: { ...process.env, MARKBRIDGE_DEV_PORT: '' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, exitCode, result.stderr);
    const received = JSON.parse(result.stdout);
    assert.equal(await realpath(received.cwd), await realpath(desktop));
    assert.deepEqual(received.args.slice(0, 2), ['dev', '--config']);
    assert.equal(received.args.length, 3);
    assert.deepEqual(JSON.parse(received.args[2]), {
      build: { devUrl: `http://127.0.0.1:${received.port}` },
    });
    assert.ok(Number(received.port) > 0);
    assert.equal(result.stderr, '');
  }
});

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
