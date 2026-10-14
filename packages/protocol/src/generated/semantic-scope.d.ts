/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
/**
 * A required JSON field whose value can be null. Unlike Option, absence is rejected.
 */
export type RequiredNullable = Id | null;
export type Id = string;
export type SourceEpoch = number;

export interface SemanticScope {
  expectedRevision: Counter;
  folderId: RequiredNullable;
  profileId: Id;
  /**
   * @maxItems 10000
   */
  selectedChromeIds: Id[];
  sourceEpoch: SourceEpoch;
}
