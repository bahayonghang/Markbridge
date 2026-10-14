import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeReleaseContext } from './native-build.mjs';
import { runVisible } from './run-command.mjs';
import { currentBundleFiles } from './native-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function localInstallCommand(bundles) {
  const selected = bundles.filter(entry => entry.kind === 'nsis');
  assert.equal(selected.length, 1, 'Local install requires exactly one current Windows NSIS package.');
  // Silent current-user install into the installer's default directory, with its normal shortcuts.
  // Isolated acceptance uses /NS and a fresh /D path; this command does not.
  return { file: selected[0].path, args: ['/S'] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = nativeReleaseContext(root);
  assert.equal(release.platform, 'win32', 'just install-app installs the Windows current-user NSIS package.');
  const config = JSON.parse(await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  const command = localInstallCommand(await currentBundleFiles(release, config));
  console.log('Installing unsigned local NSIS package for the current user: ' + command.file);
  const installed = await runVisible(command.file, command.args, {
    idleMessage: (seconds) => `Installer is still running (${seconds}s).\n`,
  });
  process.exit(installed.status ?? 1);
}
