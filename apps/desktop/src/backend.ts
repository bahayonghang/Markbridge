import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  parseBridgeState, parseChromeProfileList, parseMirrorTree, parsePairingOffer, parseStartupState,
  type BridgeState, type ChromeProfileList, type MirrorTree, type PairingOffer, type StartupState,
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
    : { protocolVersion: 1, revision: 0, port: null, errorCode: null, profiles: [], pending: [], mirrors: [] };
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

export async function enumerateChromeUserData(userDataPath: string): Promise<ChromeProfileList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseChromeProfileList(await invoke<unknown>('enumerate_chrome_user_data', { userDataPath }));
}

export function attachFileMirror(userDataPath: string, directoryKey: string): Promise<BridgeState> {
  return bridgeCommand('attach_file_mirror', { userDataPath, directoryKey });
}

export function rescanFileMirrors(): Promise<BridgeState> {
  return bridgeCommand('rescan_file_mirrors', {});
}

export function detachFileMirror(mirrorSourceId: string): Promise<BridgeState> {
  return bridgeCommand('detach_file_mirror', { mirrorSourceId });
}

export function associateFileMirror(mirrorSourceId: string, profileId: string): Promise<BridgeState> {
  return bridgeCommand('associate_file_mirror', { mirrorSourceId, profileId });
}

export async function getMirrorTree(mirrorSourceId: string): Promise<MirrorTree> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseMirrorTree(await invoke<unknown>('get_mirror_tree', { mirrorSourceId }));
}
