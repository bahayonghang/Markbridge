import assert from 'node:assert/strict';
import test from 'node:test';
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
