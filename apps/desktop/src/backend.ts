import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  parseApplyResult, parseBridgeState, parseChromeProfileList, parseEditDocument, parseEditPreview,
  parseLibraryCount, parseLibraryDetail, parseLibraryNodes, parseLibraryPage, parseLibrarySearch,
  parseMirrorTree, parseOperationList, parsePairingOffer, parseStartupState,
  type ApplyResult, type BridgeState, type ChromeProfileList, type EditDocument, type EditPreview,
  type LibraryCount, type LibraryDetail, type LibraryNodes, type LibraryPage, type LibrarySearch,
  type MirrorTree, type OperationList, type PairingOffer, type StartupState,
} from '@markbridge/protocol';

export type EditAction =
  | { kind: 'create'; parentId: string; position: number; title: string; url?: string | null }
  | { kind: 'update'; chromeId: string; title?: string | null; url?: string | null }
  | { kind: 'move'; chromeId: string; parentId: string; position: number }
  | { kind: 'reorder'; parentId: string; childIds: string[] }
  | { kind: 'delete'; chromeId: string }
  | { kind: 'undo'; operationId: string };

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

export async function readCacheTree(profileId: string, folderId: string | null, depth: number): Promise<LibraryNodes> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseLibraryNodes(await invoke<unknown>('cache_tree', { profileId, folderId, depth }));
}

export async function readCacheList(profileId: string, folderId: string, offset: number, limit: number): Promise<LibraryPage> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseLibraryPage(await invoke<unknown>('cache_list', { profileId, folderId, offset, limit }));
}

export async function readCacheSearch(profileId: string, query: string, folderId: string | null, limit: number): Promise<LibrarySearch> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseLibrarySearch(await invoke<unknown>('cache_search', { profileId, query, folderId, limit }));
}

export async function readCacheNode(profileId: string, chromeId: string): Promise<LibraryDetail> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseLibraryDetail(await invoke<unknown>('cache_get', { profileId, chromeId }));
}

export async function readCacheCount(profileId: string, folderId: string | null): Promise<LibraryCount> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseLibraryCount(await invoke<unknown>('cache_count', { profileId, folderId }));
}

export async function openHttpUrl(url: string): Promise<void> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  await invoke('open_http_url', { url });
}

export async function previewEdit(profileId: string, expectedRevision: number, action: EditAction): Promise<EditPreview> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseEditPreview(await invoke<unknown>('preview_edit', { profileId, expectedRevision, action }));
}

export async function applyEdit(profileId: string, expectedRevision: number, action: EditAction, secondConfirm: boolean): Promise<ApplyResult> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseApplyResult(await invoke<unknown>('apply_edit', { profileId, expectedRevision, action, secondConfirm }));
}

export async function listOperations(profileId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseOperationList(await invoke<unknown>('list_operations', { profileId }));
}

export async function reviewOperation(profileId: string, operationId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseOperationList(await invoke<unknown>('review_operation', { profileId, operationId }));
}

export async function refreshOperations(profileId: string): Promise<OperationList> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseOperationList(await invoke<unknown>('refresh_operations', { profileId }));
}

export async function exportHtml(profileId: string): Promise<EditDocument> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseEditDocument(await invoke<unknown>('export_html', { profileId }));
}

export async function exportSidecar(profileId: string): Promise<EditDocument> {
  if (!isTauri()) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  return parseEditDocument(await invoke<unknown>('export_sidecar', { profileId }));
}
