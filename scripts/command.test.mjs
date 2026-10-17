import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runCi } from './ci.mjs';
import { runVisible } from './run-command.mjs';

function capture() {
  const chunks = [];
  return { chunks, write: (chunk) => { chunks.push(Buffer.from(chunk).toString('utf8')); } };
}

test('runVisible copies stdout and stderr onto one stream', async () => {
  const output = capture();
  const result = await runVisible(process.execPath, ['-e', 'process.stdout.write("OUT\\n"); process.stderr.write("ERR\\n");'], {
    write: output.write, idleNoticeMs: 0,
  });
  assert.equal(result.status, 0);
  const text = output.chunks.join('');
  assert.match(text, /OUT/);
  assert.match(text, /ERR/);
});

test('runVisible reports a quiet child and then resolves', async () => {
  const output = capture();
  const result = await runVisible(process.execPath, ['-e', 'setTimeout(() => {}, 180)'], {
    write: output.write,
    idleNoticeMs: 40,
    idleMessage: (seconds) => `quiet ${seconds}\n`,
  });
  assert.equal(result.status, 0);
  assert.match(output.chunks.join(''), /quiet /);
});

test('runVisible preserves a nonzero child status', async () => {
  const output = capture();
  const result = await runVisible(process.execPath, ['-e', 'process.stderr.write("FAIL\\n"); process.exit(3)'], {
    write: output.write, idleNoticeMs: 0,
  });
  assert.equal(result.status, 3);
  assert.match(output.chunks.join(''), /FAIL/);
});

test('runVisible captures machine stdout separately while forwarding diagnostics', async () => {
  const output = capture();
  const stdout = capture();
  const result = await runVisible(process.execPath, ['-e', 'process.stdout.write("{\\"executable\\":\\"schema\\"}\\n"); process.stderr.write("building\\n");'], {
    write: output.write, onStdout: stdout.write, idleNoticeMs: 0,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(stdout.chunks.join('')), { executable: 'schema' });
  assert.equal(output.chunks.join(''), 'building\n');
});

test('local CI preserves the commands and order of the Windows workflow', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const justfile = await readFile(new URL('../justfile', import.meta.url), 'utf8');
  const expected = [...workflow.split('  native-platforms:')[0].matchAll(/^ {6}- run: (.+)\r?$/gm)].map(match => match[1]);
  const commands = [];
  const output = capture();
  const status = await runCi(async (command, [recipe]) => {
    assert.equal(command, 'just');
    const match = justfile.match(new RegExp(`^${recipe}:\\r?\\n    (.+)\\r?$`, 'm'));
    assert.ok(match, `Missing just recipe: ${recipe}`);
    commands.push(match[1]);
    return { status: 0, signal: null };
  }, output.write);
  assert.equal(status, 0);
  assert.equal(expected.length, 12);
  assert.deepEqual(commands, expected);
  assert.match(output.chunks.join(''), /\[ci 12\/12\] test-e2e: PASS/);
  assert.match(output.chunks.join(''), /All 12 stages passed/);
});

test('local CI stops at the failing stage and preserves its exit status', async () => {
  const calls = [];
  const output = capture();
  const status = await runCi(async (_command, [recipe]) => {
    calls.push(recipe);
    return { status: recipe === 'lint' ? 17 : 0, signal: null };
  }, output.write);
  assert.equal(status, 17);
  assert.deepEqual(calls, ['install', 'lint']);
  assert.match(output.chunks.join(''), /\[ci 2\/12\] lint: FAIL.*exit 17/);
  assert.doesNotMatch(output.chunks.join(''), /All 12 stages passed/);
});

test('local CI reports a terminated stage as failure', async () => {
  const output = capture();
  const status = await runCi(async () => ({ status: null, signal: 'SIGTERM' }), output.write);
  assert.equal(status, 1);
  assert.match(output.chunks.join(''), /install: FAIL.*SIGTERM/);
  assert.doesNotMatch(output.chunks.join(''), /\[ci 2\/12\]/);
});
