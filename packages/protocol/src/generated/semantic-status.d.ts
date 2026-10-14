/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = SemanticIndex | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Id | null;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = SemanticFailure | null;
export type SemanticFailure =
  | 'DISABLED'
  | 'ENDPOINT_DENIED'
  | 'MISSING_MODEL'
  | 'REMOTE_MODEL'
  | 'DIMENSION_MISMATCH'
  | 'INVALID_VECTOR'
  | 'MODEL_CHANGED'
  | 'STALE_INDEX'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'UNREACHABLE'
  | 'INVALID_RESPONSE'
  | 'LIMIT_EXCEEDED'
  | 'STORAGE_ERROR';
export type Counter = number;
export type SemanticPhase = 'running' | 'paused' | 'ready' | 'failed' | 'stale';
export type SourceEpoch = number;

export interface SemanticStatus {
  index: RequiredNullable;
  settings: SemanticSettings;
}
export interface SemanticIndex {
  digest: RequiredNullable2;
  dimension: number | null;
  failure: RequiredNullable3;
  failureMessage: string | null;
  generation: Counter;
  indexId: Id;
  model: string;
  pending: number;
  phase: SemanticPhase;
  profileId: Id;
  ready: number;
  sourceEpoch: SourceEpoch;
  storedBytes: Counter;
  total: number;
}
export interface SemanticSettings {
  enabled: boolean;
  endpointLabel: string | null;
  inputRecipeVersion: number;
  maxInputBytes: number;
  maxInputChars: number;
  model: string | null;
}
