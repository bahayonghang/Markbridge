/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = string | null;
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
export type Id = string;

export interface EditPreview {
  affected: Counter;
  /**
   * @maxItems 50
   */
  changes: EditFieldChange[];
  errorCode: RequiredNullable;
  expectedRevision: Counter;
  profileId: Id;
  requiresSecondConfirm: boolean;
  writable: boolean;
}
export interface EditFieldChange {
  after: RequiredNullable2;
  before: RequiredNullable2;
  field: EditField;
}
