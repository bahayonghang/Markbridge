/* Generated from crates/protocol. Run pnpm protocol:generate. */

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
export type Id = string;
export type BatchItemState = 'applied' | 'not_executed' | 'in_flight' | 'conflict' | 'uncertain';
export type Title = string;
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

export interface BatchEditStatus {
  errorCode: RequiredNullable;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  items: [BatchItemResult, ...BatchItemResult[]];
  operationId: Id;
  profileId: Id;
  state: OperationState;
  stopped: boolean;
}
export interface BatchItemResult {
  chromeId: Id;
  errorCode: RequiredNullable;
  state: BatchItemState;
  title: Title;
}
