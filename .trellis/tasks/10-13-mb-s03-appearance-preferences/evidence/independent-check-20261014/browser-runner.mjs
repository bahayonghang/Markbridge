import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chooseDevPort } from '../../../../../scripts/dev-port.mjs';

let repo = resolve(import.meta.dirname);
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) repo = resolve(repo, '..');
const port = await chooseDevPort();
const baseURL = `http://127.0.0.1:${port}`;
const env = { ...process.env, MARKBRIDGE_DEV_PORT: String(port), PLAYWRIGHT_TEST_BASE_URL: baseURL };
const server = spawn(process.execPath, [join(repo, 'apps/desktop/node_modules/vite/bin/vite.js')], { cwd: join(repo, 'apps/desktop'), env, stdio: 'ignore', windowsHide: true });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    try { ready = (await fetch(baseURL)).ok; } catch { /* Wait for the owned server. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('OWNED_SERVER_NOT_READY');
  const child = spawn(process.execPath, [join(repo, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(import.meta.dirname, 'playwright.config.ts'), ...process.argv.slice(2)], { cwd: repo, env, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  process.exitCode = code ?? 1;
  console.log(`PLAYWRIGHT_EXIT=${process.exitCode}`);
} finally {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else server.kill();
  console.log(`OWNED_VITE_CLOSED=${server.pid}`);
}
