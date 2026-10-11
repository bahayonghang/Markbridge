/* Generated from crates/protocol. Run pnpm protocol:generate. */

export type Counter = number;
export type Id = string;

export interface PairingOffer {
  expiresAt: Counter;
  pairingCode: string;
  profileId: Id;
}
