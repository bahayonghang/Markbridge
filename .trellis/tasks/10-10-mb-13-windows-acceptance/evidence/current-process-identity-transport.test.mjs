import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Node execFile preserves identity JSON and exact ticks through Windows PowerShell5 File arguments', { skip: process.platform !== 'win32' }, async () => {
  const identities = [{ pid: 1234, creationUtcTicks: '639275172461613410' },
    { pid: 0xffffffff, creationUtcTicks: '3155378975999999999' }];
  const { stdout, stderr } = await promisify(execFile)('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('current-process-identity.test.ps1', import.meta.url)), '-TransportIdentities', JSON.stringify(identities)],
  { windowsHide: true, timeout: 15000 });
  assert.equal(stderr, '');
  assert.match(stdout, /^IDENTITY_ARGUMENT_TRANSPORT_PASS\r?$/m);
});

test('identity File argument transport rejects noncanonical whitespace ticks', { skip: process.platform !== 'win32' }, async () => {
  for (const whitespace of ['\n', '\r', '\r\n', ' ', '\t']) {
    const identities = [{ pid: 1234, creationUtcTicks: `639275172461613410${whitespace}` },
      { pid: 0xffffffff, creationUtcTicks: '3155378975999999999' }];
    await assert.rejects(promisify(execFile)('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('current-process-identity.test.ps1', import.meta.url)), '-TransportIdentities', JSON.stringify(identities)],
    { windowsHide: true, timeout: 15000 }), error => /WEBVIEW_PROCESS_IDENTITY_INVALID/.test(error.stderr ?? ''));
  }
});
