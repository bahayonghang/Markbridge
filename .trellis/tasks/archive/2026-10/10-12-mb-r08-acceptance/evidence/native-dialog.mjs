// The dialog helper operates only on windows owned by this fixture's application.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { evidence, until, ensure } from './native-driver.mjs';
const run = promisify(execFile);

export async function dialog(app, action = 'inspect', path) {
  const { stdout } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'native-save-dialog.ps1'), '-TargetProcessId', String(app.child.pid), '-Action', action, ...(path ? ['-TargetPath', path, '-IsolationRoot', app.root] : [])], { windowsHide: true, timeout: 20000 }).catch(error => {
    const failure = new Error('DIALOG_HELPER_FAILED');
    failure.helperDiagnostic = String(error.stderr ?? '').slice(0, 1600);
    throw failure;
  });
  return JSON.parse(stdout.trim());
}

export async function waitDialog(app) {
  return until(async () => {
    const result = await dialog(app);
    return result.found ? result : null;
  }, 'SAVE_DIALOG_NOT_FOUND');
}

export async function lockOutput(app, path) {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'native-file-lock.ps1'), '-TargetPath', path, '-IsolationRoot', app.root], { windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.resume();
  await until(() => output.includes('LOCKED') || child.exitCode !== null, 'FILE_LOCK_START_TIMEOUT', 15000).catch(error => { child.kill(); throw error; });
  ensure(output.includes('LOCKED'), 'FILE_LOCK_FAILED');
  return async () => {
    child.stdin.end('release\n');
    await until(() => child.exitCode !== null, 'FILE_LOCK_RELEASE_TIMEOUT', 10000).catch(error => { child.kill(); throw error; });
    ensure(output.includes('RELEASED'), 'FILE_LOCK_NOT_RELEASED');
  };
}
