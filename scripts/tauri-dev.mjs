import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chooseDevPort } from './dev-port.mjs';
import { runVisible } from './run-command.mjs';

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const candidates = [
  fileURLToPath(new URL('../apps/desktop/node_modules/@tauri-apps/cli/tauri.js', import.meta.url)),
  fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url)),
];
const cli = candidates.find((candidate) => existsSync(candidate));
if (!cli) {
  process.stderr.write(
    'Missing @tauri-apps/cli (apps/desktop/node_modules/@tauri-apps/cli/tauri.js). Run `just install` or `pnpm install --frozen-lockfile` first.\n',
  );
  process.exit(1);
}

const port = await chooseDevPort();
const config = JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } });
const child = await runVisible(process.execPath, [cli, 'dev', '--config', config], {
  cwd: desktop,
  env: { ...process.env, MARKBRIDGE_DEV_PORT: String(port) },
  idleNoticeMs: 0,
});
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status ?? 1);
