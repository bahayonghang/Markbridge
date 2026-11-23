/* Generated from crates/protocol. Run pnpm protocol:generate. */

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
      | 'PROFILE_IGNORED'
      | 'WRITE_PAUSED'
      | 'PORT_EXHAUSTED'
    )
  | 'PATH_UNAVAILABLE';
export type MirrorAssociation = 'independent' | 'confirmed';
export type DisplayName = string;
export type MirrorFileStatus = 'current' | 'stale' | 'unavailable';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = Counter | null;
export type Counter = number;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable4 = Id | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = number | null;
export type BridgeConnection =
  'ignored' | 'connecting' | 'reconciling' | 'live' | 'cached_read_only' | 'local' | 'error';
export type Version = number;

export interface BridgeState {
  errorCode: RequiredNullable2;
  mirrors: MirrorSourceState[];
  port: RequiredNullable;
  profiles: BridgeProfile[];
  protocolVersion: Version;
  revision: Counter;
}
/**
 * File-mirror status. `can_write_browser` is always false: a file source is not a write path.
 */
export interface MirrorSourceState {
  association: MirrorAssociation;
  canWriteBrowser: false;
  displayName: DisplayName;
  errorCode: RequiredNullable2;
  fileStatus: MirrorFileStatus;
  lastSyncedAt: RequiredNullable3;
  mirrorSourceId: Id;
  nodeCount: Counter;
  pairedProfileId: RequiredNullable4;
  revision: Counter;
  watching: boolean;
}
export interface BridgeProfile {
  connection: BridgeConnection;
  displayName: DisplayName;
  errorCode: RequiredNullable2;
  ignored: boolean;
  instanceId: Id;
  lastSyncedAt: RequiredNullable3;
  nodeCount: Counter;
  profileId: Id;
  revision: Counter;
  writePaused: boolean;
}
