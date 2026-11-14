import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnedDebugEndpoint } from './current-native-driver.mjs';

const endpoint = 'ws://127.0.0.1:12345/devtools/browser/01234567-89ab-cdef-0123-456789abcdef';

test('readonly startup pins the browser endpoint to its exact loopback listener', () => {
  assert.equal(isOwnedDebugEndpoint(endpoint, 12345), true);
  assert.equal(isOwnedDebugEndpoint(endpoint.replace(':12345/', ':65535/'), 65535), true);
});

test('readonly startup rejects alternate authorities, schemes and browser paths', () => {
  for (const value of [
    endpoint.replace('127.0.0.1', 'localhost'),
    endpoint.replace('127.0.0.1', '127.0.0.2'),
    endpoint.replace('127.0.0.1', '[::1]'),
    endpoint.replace('127.0.0.1', 'example.com'),
    endpoint.replace(':12345/', ':12346/'),
    endpoint.replace('ws:', 'wss:'),
    endpoint.replace('ws:', 'http:'),
    endpoint.replace('127.0.0.1', 'user:fixture@127.0.0.1'),
    endpoint.replace('/browser/', '/page/'),
    endpoint.replace('/browser/', '/browser/../browser/'),
    endpoint.replace('/browser/', '/browser/%2e%2e/'),
    `${endpoint}?fixture=1`,
    `${endpoint}#fixture`,
    `${endpoint}/`,
    `${endpoint}\n`,
    `${endpoint}\r\n`,
  ]) assert.equal(isOwnedDebugEndpoint(value, 12345), false, value);
});

test('readonly startup rejects malformed endpoint or port inputs', () => {
  for (const port of [0, -1, 65536, 1.5, NaN, '12345', null]) {
    assert.equal(isOwnedDebugEndpoint(endpoint, port), false);
  }
  for (const value of [undefined, null, {}, '', 'ws://127.0.0.1:12345/devtools/browser/']) {
    assert.equal(isOwnedDebugEndpoint(value, 12345), false);
  }
});
