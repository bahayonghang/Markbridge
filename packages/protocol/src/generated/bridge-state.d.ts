/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = ErrorCode | null;
export type ErrorCode =
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
  | 'CANCELLED';
export type DisplayName = string;
export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = Id | null;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable5 = string | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = number | null;
export type BridgeConnection = 'unpaired' | 'connecting' | 'reconciling' | 'live' | 'cached_read_only' | 'error';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = Counter | null;
export type Version = number;

export interface BridgeState {
  errorCode: RequiredNullable2;
  pending: PendingPairing[];
  port: RequiredNullable;
  profiles: BridgeProfile[];
  protocolVersion: Version;
  revision: Counter;
}
export interface PendingPairing {
  displayName: DisplayName;
  expiresAt: Counter;
  instanceId: RequiredNullable4;
  origin: RequiredNullable5;
  profileId: Id;
}
export interface BridgeProfile {
  connection: BridgeConnection;
  displayName: DisplayName;
  errorCode: RequiredNullable2;
  instanceId: Id;
  lastSyncedAt: RequiredNullable3;
  nodeCount: Counter;
  profileId: Id;
  revision: Counter;
}
