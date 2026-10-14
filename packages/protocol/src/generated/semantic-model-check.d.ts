/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = SemanticFailure | null;
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

export interface SemanticModelCheck {
  available: boolean;
  digest: RequiredNullable;
  dimension: number | null;
  failure: RequiredNullable2;
  failureMessage: string | null;
  model: string | null;
}
