/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = ErrorCode | null;
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
export type RequiredNullable = ExportMetadata | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = Counter | null;
export type Counter = number;
export type DisplayName = string;
export type EditDocumentKind = 'html' | 'sidecar';
export type ExportSource =
  | {
      id: Id;
      kind: 'profile';
    }
  | {
      id: Id;
      kind: 'mirror';
    };
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = SourceEpoch | null;
export type SourceEpoch = number;
export type ExportSaveStatus = 'saved' | 'cancelled' | 'failed';

export interface ExportSaveResult {
  errorCode: RequiredNullable4;
  metadata: RequiredNullable;
  status: ExportSaveStatus;
}
export interface ExportMetadata {
  cachedAt: RequiredNullable3;
  displayName: DisplayName;
  exportedAt: Counter;
  format: EditDocumentKind;
  nodeCount: Counter;
  revision: Counter;
  source: ExportSource;
  sourceEpoch: RequiredNullable2;
}
