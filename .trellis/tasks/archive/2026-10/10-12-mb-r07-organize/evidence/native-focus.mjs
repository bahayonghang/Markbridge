// Observe the application's focus transfer immediately; never focus the preview.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { evidence, until, ensure } from './native-driver.mjs';

export async function watchFocus(app, runId) {
  await mkdir(join(evidence, 'native-screenshots'), { recursive: true });
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(evidence, 'native-print-window.ps1'), '-ProcessId', String(app.child.pid), '-TitleLike', '签桥', '-OutPath', join(evidence, 'native-screenshots', `${runId}-focus-main.png`), '-Activate', '-WatchPreview', '-PreviewTitle', '网页预览'], { windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.resume();
  try {
    await until(() => output.includes('FG_SAME='), 'FOCUS_MONITOR_NOT_READY', 20000);
    ensure(output.includes('FG_SAME=True'), 'TEST_MAIN_WINDOW_NOT_ACTIVE');
  } catch (error) { child.kill(); throw error; }
  return {
    mainWindow: { hwnd: output.match(/HWND=(\d+)/)?.[1], foreground: true },
    async result() {
      await until(() => child.exitCode !== null, 'FOCUS_MONITOR_TIMEOUT', 20000).catch(error => { child.kill(); throw error; });
      return { observed: output.includes('PREVIEW_FOCUS=True'), elapsedMs: Number(output.match(/ELAPSED_MS=(\d+)/)?.[1] ?? 0) };
    },
  };
}
