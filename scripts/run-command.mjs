import { spawn } from 'node:child_process';

export function runVisible(command, args, options = {}) {
  const {
    write = (chunk) => { process.stdout.write(chunk); },
    idleNoticeMs = 15_000,
    idleMessage = (seconds) => `Still running (${seconds}s). Output resumes when the current step prints again.\n`,
    ...spawnOptions
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: ['inherit', 'pipe', 'pipe'] });
    const started = Date.now();
    let lastOutput = started;
    let settled = false;
    const forward = (chunk) => {
      lastOutput = Date.now();
      write(chunk);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    const timer = idleNoticeMs > 0 ? setInterval(() => {
      if (Date.now() - lastOutput < idleNoticeMs) return;
      lastOutput = Date.now();
      write(idleMessage(Math.floor((Date.now() - started) / 1000)));
    }, idleNoticeMs) : null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      callback();
    };
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (status, signal) => finish(() => resolve({ status, signal })));
  });
}
