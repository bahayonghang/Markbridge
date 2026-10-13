import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseDevPort } from './dev-port.mjs';

const port = await chooseDevPort();
const config = JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } });
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const cli = fileURLToPath(new URL('../apps/desktop/node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'dev', '--config', config], {
  cwd: desktop,
  stdio: 'inherit',
  env: { ...process.env, MARKBRIDGE_DEV_PORT: String(port) },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
