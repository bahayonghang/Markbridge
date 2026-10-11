import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BridgeState } from '@markbridge/protocol';
import { App } from './App';
import * as backend from './backend';

vi.mock('./backend', () => ({
  getStartupState: vi.fn(), getBridgeState: vi.fn(), subscribeBridgeState: vi.fn(),
  hasNativeBridge: vi.fn(), startBridge: vi.fn(), beginPairing: vi.fn(),
  confirmPairing: vi.fn(), cancelPairing: vi.fn(), revokePairing: vi.fn(), reconnectProfile: vi.fn(),
  enumerateChromeUserData: vi.fn(), attachFileMirror: vi.fn(), rescanFileMirrors: vi.fn(),
  detachFileMirror: vi.fn(), associateFileMirror: vi.fn(), getMirrorTree: vi.fn(),
  readCacheTree: vi.fn(async () => ({ nodes: [] })),
  readCacheList: vi.fn(async () => ({ items: [], total: 0 })),
  readCacheSearch: vi.fn(async () => ({ items: [] })),
  readCacheNode: vi.fn(async () => { throw new Error('missing'); }),
  readCacheCount: vi.fn(async () => ({ folders: 0, bookmarks: 0 })),
  openHttpUrl: vi.fn(async () => undefined),
  listOperations: vi.fn(async () => ({ operations: [] })),
  refreshOperations: vi.fn(async () => ({ operations: [] })),
  reviewOperation: vi.fn(async () => ({ operations: [] })),
  previewEdit: vi.fn(),
  applyEdit: vi.fn(),
  exportHtml: vi.fn(async () => ({ kind: 'html', body: '' })),
  exportSidecar: vi.fn(async () => ({ kind: 'sidecar', body: '{}' })),
}));
const initial: BridgeState = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], pending: [], mirrors: [] };
const profile: BridgeState['profiles'][number] = {
  profileId: 'profile-a', instanceId: 'instance-a', displayName: '研究资料', connection: 'live',
  nodeCount: 17, revision: 4, lastSyncedAt: null, errorCode: null,
};
let receive: (state: BridgeState) => void;
let invalid: () => void;
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.mocked(backend.hasNativeBridge).mockReturnValue(true);
  vi.mocked(backend.getStartupState).mockResolvedValue({ protocolVersion: 1, state: 'unpaired' });
  vi.mocked(backend.getBridgeState).mockResolvedValue(initial);
  vi.mocked(backend.subscribeBridgeState).mockImplementation(async (onState, onInvalid) => {
    receive = onState;
    invalid = onInvalid;
    return unsubscribe;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it('browses a stale file mirror without offering a browser write', async () => {
  const mirror: BridgeState['mirrors'][number] = {
    mirrorSourceId: 'mirror-a', displayName: 'Personal', association: 'independent', pairedProfileId: null,
    fileStatus: 'stale', watching: true, nodeCount: 4, revision: 2, lastSyncedAt: null, errorCode: 'INVALID_TREE', canWriteBrowser: false,
  };
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, mirrors: [mirror] });
  vi.mocked(backend.getMirrorTree).mockResolvedValue({
    mirrorSourceId: 'mirror-a', displayName: 'Personal', fileStatus: 'stale', association: 'independent',
    revision: 2, lastSyncedAt: null, errorCode: 'INVALID_TREE', canWriteBrowser: false,
    nodes: [{
      chromeId: '5', parentId: '1', position: 0, kind: 'bookmark', title: '示例', url: 'https://example.com/a',
      folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null,
    }],
  });
  render(<App />);
  expect(await screen.findByText('文件陈旧 · 保留缓存')).toBeVisible();
  expect(screen.getByText('独立只读 · 正在监听')).toBeVisible();
  expect(screen.getByText('浏览器写入已禁用。在线资料优先于已关联的文件来源。')).toBeVisible();
  expect(screen.queryByRole('button', { name: /写入|应用/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '浏览缓存' }));
  expect((await screen.findAllByText('示例')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('https://example.com/a').length).toBeGreaterThan(0);
  expect(backend.getMirrorTree).toHaveBeenCalledExactlyOnceWith('mirror-a');
});

it('keeps browser preview unpaired and disables native actions', async () => {
  vi.mocked(backend.hasNativeBridge).mockReturnValue(false);
  render(<App />);
  expect(await screen.findByText('未连接 · 只读')).toBeVisible();
  expect(screen.getByText(/浏览器预览/)).toBeVisible();
  expect(screen.getByRole('button', { name: '启动连接' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '生成配对串' })).toBeDisabled();
  expect(backend.startBridge).not.toHaveBeenCalled();
});

it('shows safe startup failure without raw details', async () => {
  vi.mocked(backend.getStartupState).mockRejectedValue(new Error('private backend detail'));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取启动状态');
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});

it('subscribes before hydration and ignores older hydrate and command replies', async () => {
  let hydrate!: (state: BridgeState) => void;
  vi.mocked(backend.getBridgeState).mockReturnValue(new Promise((resolve) => { hydrate = resolve; }));
  render(<App />);
  await waitFor(() => expect(backend.getBridgeState).toHaveBeenCalled());
  expect(vi.mocked(backend.subscribeBridgeState).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(backend.getBridgeState).mock.invocationCallOrder[0]!);
  act(() => { receive({ ...initial, revision: 3, profiles: [profile] }); });
  await act(async () => { hydrate(initial); });
  expect(screen.getByText('实时同步')).toBeVisible();
  vi.mocked(backend.reconnectProfile).mockResolvedValue({ ...initial, revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(backend.reconnectProfile).toHaveBeenCalledWith('profile-a'));
  expect(screen.getByText('实时同步')).toBeVisible();
});

it('validates port locally and sends a corrected port once', async () => {
  render(<App />);
  await screen.findByText('未连接 · 只读');
  fireEvent.change(screen.getByLabelText('端口'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: '启动连接' }));
  expect(screen.getByRole('alert')).toHaveTextContent('1024–65535');
  expect(backend.startBridge).not.toHaveBeenCalled();
  vi.mocked(backend.startBridge).mockResolvedValue({ ...initial, revision: 2, port: 49154 });
  fireEvent.change(screen.getByLabelText('端口'), { target: { value: '49154' } });
  fireEvent.click(screen.getByRole('button', { name: '启动连接' }));
  expect(await screen.findByText('127.0.0.1:49154')).toBeVisible();
  expect(backend.startBridge).toHaveBeenCalledExactlyOnceWith(49154);
  expect(screen.getByLabelText('端口')).toBeDisabled();
  expect(screen.getByRole('button', { name: '连接已启动' })).toBeDisabled();
});

it('requires explicit confirmation of a validated candidate and clears the offer', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  vi.mocked(backend.beginPairing).mockResolvedValue({ profileId: 'profile-a', pairingCode: 'synthetic-one-time-code', expiresAt: Date.now() + 120000 });
  render(<App />);
  await screen.findByText('未连接 · 只读');
  fireEvent.click(screen.getByRole('button', { name: '生成配对串' }));
  expect(await screen.findByLabelText('一次性配对串')).toHaveValue('synthetic-one-time-code');
  expect(backend.confirmPairing).not.toHaveBeenCalled();
  act(() => { receive({ ...initial, revision: 2, port: 49153, pending: [{
    profileId: 'profile-a', displayName: '研究资料', instanceId: 'instance-a',
    origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', expiresAt: Date.now() + 120000,
  }] }); });
  expect(screen.getByText('instance-a')).toBeVisible();
  vi.mocked(backend.confirmPairing).mockResolvedValue({ ...initial, revision: 3, port: 49153, profiles: [profile] });
  fireEvent.click(screen.getByRole('button', { name: '确认此扩展' }));
  expect(await screen.findByText('实时同步')).toBeVisible();
  expect(backend.confirmPairing).toHaveBeenCalledExactlyOnceWith('profile-a', 'instance-a');
  expect(screen.queryByLabelText('一次性配对串')).not.toBeInTheDocument();
});

it('does not offer confirmation before verified identity exists and allows cancel', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, pending: [{
    profileId: 'profile-a', displayName: '研究资料', instanceId: null, origin: null, expiresAt: Date.now() + 120000,
  }] });
  vi.mocked(backend.cancelPairing).mockResolvedValue({ ...initial, revision: 2, port: 49153 });
  render(<App />);
  await screen.findByText('等待扩展连接。请将配对串粘贴到扩展选项页。');
  expect(screen.queryByRole('button', { name: '确认此扩展' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '取消配对' }));
  await waitFor(() => expect(backend.cancelPairing).toHaveBeenCalledExactlyOnceWith('profile-a'));
});

it('shows reconciling and revoked cache as read-only', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  vi.mocked(backend.reconnectProfile).mockResolvedValue({ ...initial, revision: 2, profiles: [{ ...profile, connection: 'reconciling' }] });
  vi.mocked(backend.revokePairing).mockResolvedValue({ ...initial, revision: 3, profiles: [{ ...profile, connection: 'unpaired' }] });
  render(<App />);
  await screen.findByText('实时同步');
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect(await screen.findByText('核对中 · 只读')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '吊销配对' }));
  expect(await screen.findByText('未配对 · 只读')).toBeVisible();
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '吊销配对' })).toBeDisabled();
});

it('keeps disconnected cache available for explicit reconnect and revocation', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [{ ...profile, connection: 'cached_read_only' }] });
  render(<App />);
  await screen.findByText('缓存 · 只读');
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '吊销配对' })).toBeEnabled();
});

it('rejects invalid events without exposing the last live state as usable', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  render(<App />);
  await screen.findByText('实时同步');
  act(() => { invalid(); });
  expect(screen.getByRole('alert')).toHaveTextContent('收到无效连接状态');
  expect(screen.getByText('状态无效 · 只读')).toBeVisible();
  expect(screen.getByRole('button', { name: '吊销配对' })).toBeDisabled();
});

it('unsubscribes after unmount even when listener registration resolves late', async () => {
  let register!: (stop: () => void) => void;
  vi.mocked(backend.subscribeBridgeState).mockReturnValue(new Promise((resolve) => { register = resolve; }));
  const view = render(<App />);
  view.unmount();
  await act(async () => { register(unsubscribe); });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(backend.getBridgeState).not.toHaveBeenCalled();
});

it('development remount subscribes safely without duplicate actions', async () => {
  const view = render(<StrictMode><App /></StrictMode>);
  await screen.findByText('未连接 · 只读');
  expect(backend.subscribeBridgeState).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(backend.startBridge).not.toHaveBeenCalled();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('removes the one-time code when the offer expires', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  render(<App />);
  await screen.findByText('未连接 · 只读');
  vi.useFakeTimers();
  vi.mocked(backend.beginPairing).mockResolvedValue({ profileId: 'profile-a', pairingCode: 'synthetic-expiring-code', expiresAt: Date.now() + 120000 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '生成配对串' })); });
  expect(screen.getByLabelText('一次性配对串')).toHaveValue('synthetic-expiring-code');
  act(() => { vi.advanceTimersByTime(120000); });
  expect(screen.queryByLabelText('一次性配对串')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('配对串已到期');
});

it('ignores a pairing action that completes after unmount', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  let complete!: (offer: Awaited<ReturnType<typeof backend.beginPairing>>) => void;
  vi.mocked(backend.beginPairing).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const view = render(<App />);
  await screen.findByText('未连接 · 只读');
  fireEvent.click(screen.getByRole('button', { name: '生成配对串' }));
  view.unmount();
  await act(async () => { complete({ profileId: 'profile-a', pairingCode: 'synthetic-late-code', expiresAt: Date.now() + 120000 }); });
  expect(screen.queryByLabelText('一次性配对串')).not.toBeInTheDocument();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
