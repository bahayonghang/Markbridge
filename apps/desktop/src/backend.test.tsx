import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type Event } from '@tauri-apps/api/event';
import { beginPairing, enumerateChromeUserData, getBridgeState, getMirrorTree, openHttpUrl, readCacheCount, readCacheList, readCacheNode, readCacheSearch, readCacheTree, startBridge, subscribeBridgeState } from './backend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });
const state = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], pending: [], mirrors: [] };

it('browser preview never invokes or subscribes to native endpoints', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await getBridgeState()).toMatchObject({ profiles: [], port: null });
  await subscribeBridgeState(vi.fn(), vi.fn());
  await expect(startBridge(49153)).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(enumerateChromeUserData('D:\\User Data')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(getMirrorTree('mirror-a')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(readCacheTree('profile-a', null, 1)).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(readCacheList('profile-a', '1', 0, 10)).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(readCacheSearch('profile-a', 'Alpha', null, 10)).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(readCacheNode('profile-a', '10')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(readCacheCount('profile-a', null)).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  await expect(openHttpUrl('https://example.com/a')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  expect(invoke).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

it('validates unknown IPC responses before exposing state or offer', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ ...state, credential: 'unexpected-secret' });
  await expect(getBridgeState()).rejects.toThrow('INVALID_BRIDGE_STATE');
  vi.mocked(invoke).mockResolvedValue({ profileId: 'profile-a', pairingCode: 'synthetic', expiresAt: 'invalid' });
  await expect(beginPairing('Chrome 资料')).rejects.toThrow('INVALID_PAIRING_OFFER');
});

it('rejects a cache page that is not the list contract', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ items: [{ chromeId: '10', position: 0, kind: 'bookmark', title: 'Alpha' }], total: 1, credential: 'secret' });
  await expect(readCacheList('profile-a', '1', 0, 10)).rejects.toThrow('INVALID_LIBRARY_PAGE');
  vi.mocked(invoke).mockResolvedValue({ nodes: [{ chromeId: 'bad id', position: 0, kind: 'folder', title: '根' }] });
  await expect(readCacheTree('profile-a', null, 1)).rejects.toThrow('INVALID_LIBRARY_NODES');
  expect(invoke).toHaveBeenCalledWith('cache_list', { profileId: 'profile-a', folderId: '1', offset: 0, limit: 10 });
  expect(invoke).toHaveBeenCalledWith('cache_tree', { profileId: 'profile-a', folderId: null, depth: 1 });
});

it('validates event payloads and retains a safe invalid-data path', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let emit!: (event: Event<unknown>) => void;
  const stop = vi.fn();
  vi.mocked(listen).mockImplementation(async (_name, callback) => { emit = callback; return stop; });
  const receive = vi.fn();
  const invalid = vi.fn();
  const unsubscribe = await subscribeBridgeState(receive, invalid);
  emit({ event: 'bridge-state', id: 1, payload: { ...state, revision: -1 } });
  expect(invalid).toHaveBeenCalledOnce();
  expect(receive).not.toHaveBeenCalled();
  emit({ event: 'bridge-state', id: 2, payload: state });
  expect(receive).toHaveBeenCalledExactlyOnceWith(state);
  unsubscribe();
  expect(stop).toHaveBeenCalledOnce();
});
