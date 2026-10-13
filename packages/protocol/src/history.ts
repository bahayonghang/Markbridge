import validateDetail from './generated/operation-detail.validator.js';
import validateUndo from './generated/undo-preview.validator.js';
import validateExport from './generated/export-save-result.validator.js';
import type { OperationDetail } from './generated/operation-detail';
import type { UndoPreview } from './generated/undo-preview';
import type { ExportSaveResult } from './generated/export-save-result';
export type { OperationDetail, HistoryStep, HistoryKind } from './generated/operation-detail';
export type { UndoPreview } from './generated/undo-preview';
export type { ExportSaveResult, ExportSource, ExportMetadata } from './generated/export-save-result';

export function parseOperationDetail(value: unknown): OperationDetail {
  if (!validateDetail(value)) throw new Error('INVALID_OPERATION_DETAIL');
  return value;
}
export function parseUndoPreview(value: unknown): UndoPreview {
  if (!validateUndo(value) || value.affected !== value.steps.length) throw new Error('INVALID_UNDO_PREVIEW');
  return value;
}
export function parseExportSaveResult(value: unknown): ExportSaveResult {
  if (!validateExport(value) || (value.status === 'saved' && (!value.metadata || value.errorCode))
    || (value.status === 'cancelled' && value.errorCode) || (value.status === 'failed' && !value.errorCode)) throw new Error('INVALID_EXPORT_SAVE_RESULT');
  return value;
}
