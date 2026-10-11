/* Generated from crates/protocol. Run pnpm protocol:generate. */

/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = AiProviderKind | null;
export type AiProviderKind = 'ollama' | 'compatible';
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable2 = boolean | null;

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
  provider: RequiredNullable;
  schemaSupported: RequiredNullable2;
}
