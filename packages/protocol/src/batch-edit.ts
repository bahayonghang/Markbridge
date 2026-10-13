import validatePreview from './generated/batch-edit-preview.validator.js';
import validateStatus from './generated/batch-edit-status.validator.js';
import type { BatchEditPreview } from './generated/batch-edit-preview';
import type { BatchEditStatus } from './generated/batch-edit-status';
export type { BatchEditPreview } from './generated/batch-edit-preview';
export type { BatchEditStatus } from './generated/batch-edit-status';

export function parseBatchEditPreview(value: unknown): BatchEditPreview {
  if (!validatePreview(value) || new Set(value.items.map((item) => item.chromeId)).size !== value.items.length
    || value.items.length > value.selectedCount || value.items.reduce((sum, item) => sum + item.affected, 0) !== value.affected) throw new Error('INVALID_BATCH_EDIT_PREVIEW');
  return value;
}

export function parseBatchEditStatus(value: unknown): BatchEditStatus {
  if (!validateStatus(value) || new Set(value.items.map((item) => item.chromeId)).size !== value.items.length) throw new Error('INVALID_BATCH_EDIT_STATUS');
  return value;
}
