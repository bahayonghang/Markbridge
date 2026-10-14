/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type DiagnosticArchitecture = 'x86_64' | 'aarch64' | 'other';
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
export type Counter = number;
export type Version = number;
export type DiagnosticPlatform = 'windows' | 'macos' | 'linux' | 'other';

export interface DiagnosticReport {
  appVersion: string;
  architecture: DiagnosticArchitecture;
  bridgeErrorCode: RequiredNullable;
  bridgeListening: boolean;
  connections: DiagnosticConnections;
  formatVersion: Version;
  mirrors: DiagnosticMirrors;
  platform: DiagnosticPlatform;
  protocolVersion: Version;
  schemaVersion: Counter;
}
export interface DiagnosticConnections {
  cachedReadOnly: Counter;
  connecting: Counter;
  error: Counter;
  live: Counter;
  reconciling: Counter;
  unpaired: Counter;
}
export interface DiagnosticMirrors {
  current: Counter;
  stale: Counter;
  unavailable: Counter;
}
