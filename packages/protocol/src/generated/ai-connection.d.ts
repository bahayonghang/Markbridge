/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = AiFailure | null;
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
export type RequiredNullable = boolean | null;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable3 = AiProviderKind | null;
export type AiProviderKind = 'ollama' | 'compatible';

export interface AiConnection {
  failure: RequiredNullable2;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  failureMessage: string | null;
  ok: boolean;
  schemaSupported: RequiredNullable;
  settings: AiSettings;
}
export interface AiSettings {
  credentialConfigured: boolean;
  enabled: boolean;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  endpointLabel: string | null;
  /**
   * A required JSON field whose value can be null. Unlike Option, absence is rejected.
   */
  model: string | null;
  provider: RequiredNullable3;
  schemaSupported: RequiredNullable;
}
