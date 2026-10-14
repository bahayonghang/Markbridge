/* Generated from crates/protocol. Run pnpm protocol:generate. */

export interface SemanticSettings {
  enabled: boolean;
  endpointLabel: string | null;
  inputRecipeVersion: number;
  maxInputBytes: number;
  maxInputChars: number;
  model: string | null;
}
