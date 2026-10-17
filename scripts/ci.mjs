import { fileURLToPath } from 'node:url';
import { runVisible } from './run-command.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const recipes = ['install', 'lint', 'typecheck', 'build', 'protocol-check', 'test', 'fmt', 'clippy', 'test-rust', 'build-native', 'playwright-install', 'test-e2e'];

export async function runCi(run = runVisible, write = (chunk) => { process.stdout.write(chunk); }) {
  const started = Date.now();
  for (const [index, recipe] of recipes.entries()) {
    const label = `[ci ${index + 1}/${recipes.length}] ${recipe}`;
    const stepStarted = Date.now();
    write(`\n${label}: START\n`);
    const result = await run('just', [recipe], {
      cwd: root,
      write,
      idleMessage: (seconds) => `${label}: still running (${seconds}s); waiting for more output.\n`,
    });
    const duration = ((Date.now() - stepStarted) / 1000).toFixed(1);
    if (result.status !== 0) {
      write(`${label}: FAIL after ${duration}s (${result.signal ?? `exit ${result.status ?? 1}`})\n`);
      return result.status ?? 1;
    }
    write(`${label}: PASS in ${duration}s\n`);
  }
  write(`\n[ci] All ${recipes.length} stages passed in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCi();
}
