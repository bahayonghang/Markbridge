/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Id = string;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = string | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = AiFailure | null;
export type AiFailure =
  | 'DISABLED'
  | 'ENDPOINT_DENIED'
  | 'MISSING_MODEL'
  | 'INVALID_OUTPUT'
  | 'TIMED_OUT'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'STALE_TARGET'
  | 'UNREACHABLE';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = Counter | null;
export type Counter = number;
export type AiJobState = 'ready' | 'failed' | 'cancelled' | 'applied';

export interface AiSuggestion {
  bookmarkId: Id;
  chromeId: Id;
  endpointLabel: RequiredNullable;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  evidence: string | null;
  failure: RequiredNullable3;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  failureMessage: string | null;
  inputFingerprint: Id;
  jobId: Id;
  model: RequiredNullable;
  profileId: Id;
  scope: AiScope;
  sourceTime: RequiredNullable2;
  state: AiJobState;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  suggestedFolder: string | null;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  summary: string | null;
  /**
   * @maxItems 3
   */
  tags: string[];
  title: string | null;
}
export interface AiScope {
  excerptChars: number;
  includesCachedText: boolean;
  includesTitle: boolean;
  includesUrl: boolean;
}
