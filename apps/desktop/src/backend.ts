import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  parseBridgeState, parsePairingOffer, parseStartupState,
  type BridgeState, type PairingOffer, type StartupState,
} from '@markbridge/protocol';

export function hasNativeBridge(): boolean { return isTauri(); }

export async function getStartupState(): Promise<StartupState> {
  const value: unknown = isTauri()
    ? await invoke('get_startup_state')
    : { protocolVersion: 1, state: 'unpaired' };
  return parseStartupState(value);
}

export async function getBridgeState(): Promise<BridgeState> {
  const value: unknown = isTauri()
    ? await invoke('get_bridge_state')
    : { protocolVersion: 1, revision: 0, port: null, errorCode: null, profiles: [], pending: [] };
  return parseBridgeState(value);
}

export async function subscribeBridgeState(
  onState: (state: BridgeState) => void,
  onInvalid: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen<unknown>('bridge-state', ({ payload }) => {
    try { onState(parseBridgeState(payload)); } catch { onInvalid(); }
  });
}

async function bridgeCommand(command: string, args: Record<string, unknown>): Promise<BridgeState> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseBridgeState(await invoke<unknown>(command, args));
}

export function startBridge(port: number): Promise<BridgeState> {
  return bridgeCommand('start_bridge', { port });
}

export async function beginPairing(displayName: string): Promise<PairingOffer> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parsePairingOffer(await invoke<unknown>('begin_pairing', { displayName }));
}

export function confirmPairing(profileId: string, instanceId: string): Promise<BridgeState> {
  return bridgeCommand('confirm_pairing', { profileId, instanceId });
}

export function cancelPairing(profileId: string): Promise<BridgeState> {
  return bridgeCommand('cancel_pairing', { profileId });
}

export function revokePairing(profileId: string): Promise<BridgeState> {
  return bridgeCommand('revoke_pairing', { profileId });
}

export function reconnectProfile(profileId: string): Promise<BridgeState> {
  return bridgeCommand('reconnect_profile', { profileId });
}
