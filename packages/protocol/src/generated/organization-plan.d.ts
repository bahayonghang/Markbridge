/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;
export type Counter = number;
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
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type OrganizationPhase =
  | 'folders'
  | 'reviewed'
  | 'assigning'
  | 'ready'
  | 'invalid'
  | 'applying'
  | 'paused'
  | 'partial'
  | 'applied'
  | 'cancelled'
  | 'failed';
export type SourceEpoch = number;

export interface OrganizationPlan {
  anchorId: Id;
  /**
   * @maxItems 1000
   */
  applied: OrganizationRange[];
  /**
   * @maxItems 900
   */
  assignments: OrganizationAssignment[];
  backupVerified: boolean;
  /**
   * @maxItems 1000
   */
  failed: OrganizationRange[];
  failure: RequiredNullable2;
  failureMessage: string | null;
  /**
   * @maxItems 12
   */
  folders: OrganizationFolder[];
  impact: Counter;
  inputFingerprint: Id;
  jobId: Id;
  operationId: RequiredNullable;
  /**
   * @maxItems 1000
   */
  pending: OrganizationRange[];
  phase: OrganizationPhase;
  planHash: Id;
  profileId: Id;
  sampled: Counter;
  /**
   * @maxItems 900
   */
  scope: OrganizationScopeItem[];
  scopeCount: Counter;
  sourceEpoch: SourceEpoch;
  sourceRevision: Counter;
  /**
   * @maxItems 1000
   */
  uncertain: OrganizationRange[];
}
export interface OrganizationRange {
  end: Counter;
  start: Counter;
}
export interface OrganizationAssignment {
  bookmarkId: Id;
  chromeId: Id;
  citedFolderId: Id;
  citedInputId: Id;
  rejected: boolean;
  sourceLabel: string;
  sourceParentId: Id;
  targetFolderId: Id;
}
export interface OrganizationFolder {
  folderId: Id;
  name: string;
  parentFolderId: RequiredNullable;
  reviewed: boolean;
}
export interface OrganizationScopeItem {
  bookmarkId: Id;
  chromeId: Id;
  sourceLabel: string;
  sourceParentId: Id;
}
