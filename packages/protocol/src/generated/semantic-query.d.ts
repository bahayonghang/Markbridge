/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
export type Id = string;
export type SourceEpoch = number;

export interface SemanticQuery {
  generation: Counter;
  indexId: Id;
  profileId: Id;
  requestId: Id;
  sourceEpoch: SourceEpoch;
  text: string;
  topK: number;
}
