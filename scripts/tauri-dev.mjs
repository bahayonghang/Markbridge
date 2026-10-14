import { fileURLToPath } from 'node:url';
import { chooseDevPort } from './dev-port.mjs';
import { runVisible } from './run-command.mjs';

const port = await chooseDevPort();
const config = JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } });
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const cli = fileURLToPath(new URL('../apps/desktop/node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
const child = await runVisible(process.execPath, [cli, 'dev', '--config', config], {
  cwd: desktop,
  env: { ...process.env, MARKBRIDGE_DEV_PORT: String(port) },
  idleNoticeMs: 0,
});
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status ?? 1);
