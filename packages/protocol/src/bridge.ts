import validateBridge from './generated/bridge-state.validator.js';
import validatePairing from './generated/pairing-offer.validator.js';
import type { BridgeState } from './generated/bridge-state';
import type { PairingOffer } from './generated/pairing-offer';

export type { BridgeState } from './generated/bridge-state';
export type { PairingOffer } from './generated/pairing-offer';

export function parseBridgeState(value: unknown): BridgeState {
  if (!validateBridge(value)) throw new Error('INVALID_BRIDGE_STATE');
  return value;
}

export function parsePairingOffer(value: unknown): PairingOffer {
  if (!validatePairing(value)) throw new Error('INVALID_PAIRING_OFFER');
  return value;
}
