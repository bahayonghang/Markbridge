/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = ApplyResult | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = Id | null;
export type Id = string;
export type EditField = 'title' | 'url' | 'parent' | 'position' | 'order' | 'existence';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = ErrorCode | null;
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
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = AiFailure | null;
export type AiFailure =
  | 'DISABLED'
  | 'ENDPOINT_DENIED'
  | 'MISSING_MODEL'
  | 'INVALID_OUTPUT'
  | 'TIMED_OUT'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'STALE_TARGET'
  | 'UNREACHABLE';

export interface AiApplyResult {
  browser: RequiredNullable;
  failure: RequiredNullable4;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  failureMessage: string | null;
  jobId: Id;
  summaryApplied: boolean;
  tagsApplied: boolean;
}
export interface ApplyResult {
  /**
   * @maxItems 50
   */
  conflicts: OperationConflict[];
  errorCode: RequiredNullable2;
  operationId: Id;
  state: OperationState;
}
export interface OperationConflict {
  chromeId: RequiredNullable3;
  field: EditField;
  requestId: Id;
}
