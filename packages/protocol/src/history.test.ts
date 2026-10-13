import { expect, it } from 'vitest';
import { parseExportSaveResult, parseUndoPreview } from './history';
it('rejects success without source metadata and arbitrary path-bearing responses', () => {
  expect(() => parseExportSaveResult({ status: 'saved', metadata: null, errorCode: null })).toThrow();
  expect(() => parseExportSaveResult({ status: 'cancelled', metadata: null, errorCode: null, path: 'C:/anything' })).toThrow();
  expect(() => parseExportSaveResult({ status: 'failed', metadata: null, errorCode: null })).toThrow();
  expect(parseExportSaveResult({ status: 'cancelled', metadata: null, errorCode: null }).status).toBe('cancelled');
});
it('requires the full undo step count rather than a truncated success', () => {
  const value = { profileId: 'p', operationId: 'op', sourceEpoch: 1, expectedRevision: 4, writable: true, affected: 61, errorCode: null, conflicts: [], steps: [] };
  expect(() => parseUndoPreview(value)).toThrow();
  expect(parseUndoPreview({ ...value, affected: 0 }).steps).toHaveLength(0);
});
