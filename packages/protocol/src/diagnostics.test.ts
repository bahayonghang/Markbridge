import { expect, it } from 'vitest';
import { parseDiagnosticReport, parseDiagnosticSaveResult } from './diagnostics';

const report = {
  formatVersion: 1, appVersion: '0.1.0', protocolVersion: 1, schemaVersion: 7,
  platform: 'windows', architecture: 'x86_64', bridgeListening: false, bridgeErrorCode: null,
  connections: { unpaired: 0, connecting: 0, reconciling: 0, live: 0, cachedReadOnly: 0, error: 0 },
  mirrors: { current: 0, stale: 0, unavailable: 0 },
};
it('accepts only the fixed report, known enums and safe counts', () => {
  expect(parseDiagnosticReport(report)).toEqual(report);
  for (const field of ['profileId', 'displayName', 'url', 'tree', 'path', 'token', 'headers', 'body', 'endpoint', 'logs']) {
    expect(() => parseDiagnosticReport({ ...report, [field]: 'private-canary' })).toThrow('INVALID_DIAGNOSTIC_REPORT');
  }
  for (const invalid of [
    { ...report, formatVersion: 2 }, { ...report, protocolVersion: 2 },
    { ...report, platform: 'private-platform-string' }, { ...report, architecture: 'private-cpu-string' },
    { ...report, bridgeErrorCode: 'raw-server-response' },
    { ...report, connections: { ...report.connections, live: -1 } },
    { ...report, connections: { ...report.connections, live: Number.MAX_SAFE_INTEGER + 1 } },
    { ...report, mirrors: { ...report.mirrors, path: 'C:/private' } },
  ]) expect(() => parseDiagnosticReport(invalid)).toThrow('INVALID_DIAGNOSTIC_REPORT');
});
it('does not accept false success, uncoded failures or a path/body in save results', () => {
  expect(parseDiagnosticSaveResult({ status: 'saved', errorCode: null }).status).toBe('saved');
  expect(parseDiagnosticSaveResult({ status: 'cancelled', errorCode: null }).status).toBe('cancelled');
  expect(parseDiagnosticSaveResult({ status: 'failed', errorCode: 'STORAGE_ERROR' }).status).toBe('failed');
  for (const invalid of [
    { status: 'saved', errorCode: 'STORAGE_ERROR' }, { status: 'cancelled', errorCode: 'STORAGE_ERROR' },
    { status: 'failed', errorCode: null }, { status: 'failed', errorCode: 'C:/private' },
    { status: 'saved', errorCode: null, path: 'C:/private' }, { status: 'saved', errorCode: null, body: 'sk-secret' },
  ]) expect(() => parseDiagnosticSaveResult(invalid)).toThrow('INVALID_DIAGNOSTIC_SAVE_RESULT');
});
