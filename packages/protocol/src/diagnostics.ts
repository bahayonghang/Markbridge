import validateReport from './generated/diagnostic-report.validator.js';
import validateSave from './generated/diagnostic-save-result.validator.js';
import type { DiagnosticReport } from './generated/diagnostic-report';
import type { DiagnosticSaveResult } from './generated/diagnostic-save-result';
export type { DiagnosticReport } from './generated/diagnostic-report';
export type { DiagnosticSaveResult } from './generated/diagnostic-save-result';

export function parseDiagnosticReport(value: unknown): DiagnosticReport {
  if (!validateReport(value)) throw new Error('INVALID_DIAGNOSTIC_REPORT');
  return value;
}
export function parseDiagnosticSaveResult(value: unknown): DiagnosticSaveResult {
  if (!validateSave(value) || (value.status === 'failed' ? !value.errorCode : value.errorCode !== null)) throw new Error('INVALID_DIAGNOSTIC_SAVE_RESULT');
  return value;
}
