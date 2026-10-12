import { spawn } from 'node:child_process';
import { chooseDevPort } from './dev-port.mjs';

const port = await chooseDevPort();
const config = JSON.stringify({ build: { devUrl: `http://127.0.0.1:${port}` } });
const child = spawn('pnpm', ['--filter', '@markbridge/desktop', 'exec', 'tauri', 'dev', '--config', config], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, MARKBRIDGE_DEV_PORT: String(port) },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
