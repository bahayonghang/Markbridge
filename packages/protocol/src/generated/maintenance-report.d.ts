/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = CleanupView | null;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = Id | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = OperationState | null;
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
export type RequiredNullable5 = ErrorCode | null;
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
export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = number | null;
export type LinkVerdict = 'unknown' | 'alive' | 'pending' | 'candidate';
export type SourceEpoch = number;

export interface MaintenanceReport {
  cleanup: RequiredNullable2;
  /**
   * @maxItems 1000
   */
  duplicates: DuplicateGroup[];
  failure: RequiredNullable5;
  failureMessage: string | null;
  /**
   * @maxItems 1000
   */
  links: LinkRow[];
  profileId: Id;
  requestId: Id;
  revision: Counter;
  running: boolean;
  sourceEpoch: SourceEpoch;
}
export interface CleanupView {
  keeper: LibraryMember;
  metadata: MetadataHandling;
  operationId: RequiredNullable3;
  operationState: RequiredNullable4;
  /**
   * @maxItems 1000
   */
  removals: LibraryMember[];
}
export interface LibraryMember {
  bookmarkId: Id;
  chromeId: Id;
  note: string;
  /**
   * @maxItems 32
   */
  tags: string[];
  title: string;
  url: string;
}
export interface MetadataHandling {
  handling: string;
  keeperNote: string;
  /**
   * @maxItems 1000
   */
  noteConflicts: NoteConflict[];
  /**
   * @maxItems 64
   */
  tagUnion: string[];
}
export interface NoteConflict {
  bookmarkId: Id;
  chromeId: Id;
  note: string;
}
export interface DuplicateGroup {
  /**
   * @maxItems 1000
   */
  members: LibraryMember[];
  normalizedUrl: string;
}
export interface LinkRow {
  bookmarkId: Id;
  checks: Counter;
  chromeId: Id;
  httpStatus: RequiredNullable;
  url: string;
  verdict: LinkVerdict;
}
