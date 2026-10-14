/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
export type Id = string;
export type SourceEpoch = number;

export interface SemanticScopeReview {
  clippedCount: number;
  count: number;
  expectedRevision: Counter;
  inputRecipeVersion: number;
  maxInputBytes: number;
  maxInputChars: number;
  model: string;
  profileId: Id;
  reviewId: Id;
  sourceEpoch: SourceEpoch;
  upperBytes: Counter;
}
