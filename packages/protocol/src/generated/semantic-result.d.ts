/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = SemanticFailure | null;
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
export type Id = string;
export type SourceEpoch = number;

export interface SemanticQueryResult {
  failure: RequiredNullable;
  failureMessage: string | null;
  generation: Counter;
  /**
   * @maxItems 50
   */
  hits: SemanticHit[];
  indexId: Id;
  profileId: Id;
  requestId: Id;
  sourceEpoch: SourceEpoch;
}
export interface SemanticHit {
  bookmarkId: Id;
  chromeId: Id;
  score: number;
  title: string;
}
