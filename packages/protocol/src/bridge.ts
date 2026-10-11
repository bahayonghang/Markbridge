import validateBridge from './generated/bridge-state.validator.js';
import validatePairing from './generated/pairing-offer.validator.js';
import validateMirrorTree from './generated/mirror-tree.validator.js';
import validateChromeProfiles from './generated/chrome-profiles.validator.js';
import type { BridgeState } from './generated/bridge-state';
import type { PairingOffer } from './generated/pairing-offer';
import type { MirrorTree } from './generated/mirror-tree';
import type { ChromeProfileList } from './generated/chrome-profiles';

export type { BridgeState } from './generated/bridge-state';
export type { PairingOffer } from './generated/pairing-offer';
export type { MirrorTree } from './generated/mirror-tree';
export type { ChromeProfileList, ChromeProfileChoice } from './generated/chrome-profiles';

export function parseBridgeState(value: unknown): BridgeState {
  if (!validateBridge(value)) throw new Error('INVALID_BRIDGE_STATE');
  return value;
}

export function parsePairingOffer(value: unknown): PairingOffer {
  if (!validatePairing(value)) throw new Error('INVALID_PAIRING_OFFER');
  return value;
}

export function parseMirrorTree(value: unknown): MirrorTree {
  if (!validateMirrorTree(value)) throw new Error('INVALID_MIRROR_TREE');
  return value;
}

export function parseChromeProfileList(value: unknown): ChromeProfileList {
  if (!validateChromeProfiles(value)) throw new Error('INVALID_CHROME_PROFILES');
  return value;
}
