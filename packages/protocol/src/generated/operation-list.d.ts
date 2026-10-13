/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Id | null;
export type Id = string;
export type EditField = 'title' | 'url' | 'parent' | 'position' | 'order' | 'existence';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = ErrorCode | null;
export type ErrorCode =
  | (
      | 'INVALID_MESSAGE'
      | 'UNSUPPORTED_VERSION'
      | 'FRAME_TOO_LARGE'
      | 'LIMIT_EXCEEDED'
      | 'INVALID_TREE'
      | 'UNPAIRED'
      | 'READ_ONLY'
      | 'WRONG_PROFILE'
      | 'STALE_PROPOSAL'
      | 'PROTECTED_NODE'
      | 'UNCERTAIN_WRITE'
      | 'FETCH_DENIED'
      | 'INVALID_AI_OUTPUT'
      | 'STORAGE_ERROR'
      | 'STORAGE_NEWER_SCHEMA'
      | 'MIGRATION_FAILED'
      | 'CONFLICT'
      | 'CANCELLED'
    )
  | 'PATH_UNAVAILABLE';
export type HistoryKind = 'create' | 'update' | 'move' | 'delete' | 'reorder' | 'mixed' | 'undo';
export type OperationState =
  | 'planned'
  | 'applying'
  | 'applied'
  | 'uncertain'
  | 'partial'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_conflict';

export interface OperationList {
  /**
   * @maxItems 200
   */
  operations: OperationSummary[];
}
export interface OperationSummary {
  affected: Counter;
  /**
   * @maxItems 50
   */
  conflicts: OperationConflict[];
  createdAt?: Counter | null;
  errorCode: RequiredNullable;
  isBatch?: boolean;
  kind?: HistoryKind | null;
  operationId: Id;
  reviewed?: boolean;
  state: OperationState;
}
export interface OperationConflict {
  chromeId: RequiredNullable2;
  field: EditField;
  requestId: Id;
}
