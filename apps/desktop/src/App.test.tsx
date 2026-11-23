import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BridgeState } from '@markbridge/protocol';
import { App } from './App';
import * as backend from './backend';
import { DEFAULT_UI_PREFERENCES, UI_PREFERENCES_KEY } from './features/settings/ui-preferences';

vi.mock('./backend', () => ({
  getStartupState: vi.fn(), getBridgeState: vi.fn(), subscribeBridgeState: vi.fn(),
  listInstalledFonts: vi.fn(async () => ({ status: 'ready', families: [] })),
  hasNativeBridge: vi.fn(), startBridge: vi.fn(), renameProfile: vi.fn(),
  setProfileWritePaused: vi.fn(), ignoreProfile: vi.fn(), resumeProfile: vi.fn(), revokePairing: vi.fn(), reconnectProfile: vi.fn(), ensureLocalLibrary: vi.fn(),
  readCacheQuery: vi.fn(async () => ({ items: [], total: 0, offset: 0, nextOffset: null, sourceEpoch: 1, revision: 1 })),
  readTagState: vi.fn(async () => ({ affected: 0, encodingEnabled: false, entries: [], filterTagId: null, journalId: null, matches: [], mergeRequired: false, profileId: 'local-skills', sourceTagId: null, tags: [], targetTagId: null })),
  tagCommand: vi.fn(),
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
  saveExport: vi.fn(),
  saveDiagnostics: vi.fn(async () => ({ status: 'cancelled', errorCode: null })),
  aiSettings: vi.fn(async () => ({ enabled: false, provider: null, endpointLabel: null, model: null, credentialConfigured: false, schemaSupported: null })),
  saveAiConfig: vi.fn(), setAiCredential: vi.fn(), clearAiCredential: vi.fn(), testAiConnection: vi.fn(),
  suggestAi: vi.fn(), cancelAi: vi.fn(), applyAi: vi.fn(),
}));
const initial: BridgeState = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], mirrors: [] };
const profile: BridgeState['profiles'][number] = {
  profileId: 'profile-a', instanceId: 'instance-a', displayName: '研究资料', connection: 'live',
  writePaused: false, ignored: false, nodeCount: 17, revision: 4, lastSyncedAt: null, errorCode: null,
};
let receive: (state: BridgeState) => void;
let invalid: () => void;
const unsubscribe = vi.fn();

beforeEach(() => {
  localStorage.clear();
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

it('opens General for ordinary settings, follows system with cleanup, and never saves during StrictMode mount', async () => {
  const listeners = new Set<() => void>();
  const media = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  const query = vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const save = vi.spyOn(Storage.prototype, 'setItem');
  const view = render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
  expect(listeners.size).toBe(1);
  expect(save).not.toHaveBeenCalled();
  act(() => { media.matches = true; listeners.forEach(fn => fn()); });
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  expect(listeners.size).toBe(0);
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => { media.matches = true; listeners.forEach(fn => fn()); });
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.click(screen.getByRole('tab', { name: 'AI' }));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('tabpanel', { name: '通用' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '跟随系统' }));
  expect(listeners.size).toBe(1);
  view.unmount();
  expect(listeners.size).toBe(0);
  save.mockRestore(); query.mockRestore();
});

it('applies failed saves for the session and resets only appearance without writing AI configuration', async () => {
  localStorage.setItem('unrelated-preference', 'keep');
  const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: '深色' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByRole('alert')).toHaveTextContent('当前外观已应用，但未能保存');
  fireEvent.change(screen.getByLabelText('字号'), { target: { value: '15' } });
  fireEvent.keyDown(screen.getByLabelText('字号'), { key: 'Enter' });
  expect(document.documentElement.style.getPropertyValue('--text-size')).toBe('15px');
  save.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));
  expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY)!)).toEqual(DEFAULT_UI_PREFERENCES);
  expect(localStorage.getItem('unrelated-preference')).toBe('keep');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(backend.saveAiConfig).not.toHaveBeenCalled();
  expect(backend.startBridge).not.toHaveBeenCalled();
});

it('portals export into one settings panel without duplicating the source owner or accepting a late source result', async () => {
  const mirror: BridgeState['mirrors'][number] = { mirrorSourceId: 'mirror-export', displayName: '只读文件', fileStatus: 'current', association: 'independent', pairedProfileId: null, watching: true, nodeCount: 0, revision: 1, lastSyncedAt: null, errorCode: null, canWriteBrowser: false };
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile], mirrors: [mirror] });
  vi.mocked(backend.getMirrorTree).mockResolvedValue({ ...mirror, nodes: [] });
  let finish!: (value: Awaited<ReturnType<typeof backend.saveExport>>) => void;
  vi.mocked(backend.saveExport).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  fireEvent.click(screen.getByRole('tab', { name: '备份导出' }));
  expect(document.querySelectorAll('#library-source')).toHaveLength(1);
  expect(screen.getByRole('tabpanel', { name: '备份导出' })).toContainElement(screen.getByLabelText('书签来源'));
  fireEvent.click(screen.getByRole('button', { name: '导出 HTML' }));
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'mirror:mirror-export' } });
  expect(await screen.findByText('此文件来源没有本地侧车数据。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '导出侧车 JSON' })).toBeNull();
  await act(async () => finish({ status: 'saved', metadata: null, errorCode: null }));
  expect(screen.queryByText('文件已保存到所选位置。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '书签' }));
  expect(screen.getByLabelText('书签来源')).toHaveValue('mirror:mirror-export');
  expect(document.querySelectorAll('#library-source')).toHaveLength(1);
  expect(backend.subscribeBridgeState).toHaveBeenCalledOnce();
});

it('opens bookmarks first and shares one bridge subscription across workspaces', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));
  expect(screen.getByRole('heading', { level: 1, name: '书签' })).toBeVisible();
  expect(screen.queryByLabelText('端口')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('启用 AI')).not.toBeInTheDocument();
  expect(backend.aiSettings).not.toHaveBeenCalled();
  for (const name of ['整理', '操作历史', '设置']) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('heading', { level: 1, name })).toBeVisible();
  }
  fireEvent.click(screen.getByRole('tab', { name: 'AI' }));
  expect(await screen.findByLabelText('启用 AI')).not.toBeChecked();
  expect(backend.testAiConnection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '书签' }));
  expect(screen.getByRole('heading', { level: 1, name: '书签' })).toBeVisible();
  expect(backend.subscribeBridgeState).toHaveBeenCalledOnce();
});

it('shows cached history without enabling browser undo', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [{ ...profile, connection: 'cached_read_only' }] });
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [{ operationId: 'op-cached', state: 'applied', affected: 1, errorCode: null, conflicts: [] }] });
  render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));
  fireEvent.click(screen.getByRole('button', { name: '操作历史' }));
  expect(await screen.findByText('已完成')).toBeVisible();
  expect(screen.queryByText('op-cached')).toBeNull();
  expect(screen.getByRole('button', { name: '撤销此记录' })).toBeDisabled();
  expect(backend.previewEdit).not.toHaveBeenCalled();
});

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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  expect(await screen.findByText('文件陈旧 · 保留缓存')).toBeVisible();
  expect(screen.getByText('独立只读 · 正在监听')).toBeVisible();
  expect(screen.getByText('浏览器写入已禁用。在线资料优先于已关联的文件来源。')).toBeVisible();
  expect(screen.queryByRole('button', { name: /写入|应用/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '浏览缓存' }));
  expect((await screen.findAllByText('示例')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('option', { name: /示例/ }));
  expect(await screen.findByText('https://example.com/a')).toBeVisible();
  expect(backend.getMirrorTree).toHaveBeenCalledExactlyOnceWith('mirror-a');
});

it('keeps browser preview unpaired and disables native actions', async () => {
  vi.mocked(backend.hasNativeBridge).mockReturnValue(false);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));
  expect(screen.getByText(/浏览器预览 · 仅显示界面/)).toBeVisible();
  expect(screen.getByRole('button', { name: '启动连接' })).toBeDisabled();
  expect(backend.startBridge).not.toHaveBeenCalled();
});

it('shows safe startup failure without raw details', async () => {
  vi.mocked(backend.getStartupState).mockRejectedValue(new Error('private backend detail'));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取启动状态');
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});

it('subscribes before hydration and ignores older hydrate and command replies', async () => {
  let hydrate!: (state: BridgeState) => void;
  vi.mocked(backend.getBridgeState).mockReturnValue(new Promise((resolve) => { hydrate = resolve; }));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));
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

it('shows reconciling and ignored cache as read-only', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  vi.mocked(backend.reconnectProfile).mockResolvedValue({ ...initial, revision: 2, profiles: [{ ...profile, connection: 'reconciling' }] });
  vi.mocked(backend.revokePairing).mockResolvedValue({ ...initial, revision: 3, profiles: [{ ...profile, connection: 'ignored', ignored: true }] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await screen.findByText('实时同步');
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect(await screen.findByRole('status')).toHaveTextContent('核对中 · 只读');
  fireEvent.click(screen.getByRole('button', { name: '吊销配对' }));
  expect(backend.revokePairing).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('本机缓存、标签和备注都会保留');
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(backend.revokePairing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '吊销配对' }));
  fireEvent.click(screen.getByRole('button', { name: '确认吊销配对' }));
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已忽略 · 只读'));
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '吊销配对' })).toBeDisabled();
});

it('keeps disconnected cache available for explicit reconnect and revocation', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [{ ...profile, connection: 'cached_read_only' }] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await screen.findByText('缓存 · 只读');
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '吊销配对' })).toBeEnabled();
});

it('rejects invalid events without exposing the last live state as usable', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  view.unmount();
  await act(async () => { register(unsubscribe); });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(backend.getBridgeState).not.toHaveBeenCalled();
});

it('development remount subscribes safely without duplicate actions', async () => {
  const view = render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));
  expect(backend.subscribeBridgeState).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(backend.startBridge).not.toHaveBeenCalled();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('introduces extension and read-only routes without AI or automatic directory reads', async () => {
  render(<App />);
  expect(await screen.findByRole('region', { name: '首次接入' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '1. 准备 Chrome 扩展' })).toBeVisible();
  expect(screen.getByLabelText('端口')).not.toBeVisible();
  expect(screen.getByRole('button', { name: '启动连接' })).toBeEnabled();
  expect(backend.aiSettings).not.toHaveBeenCalled();
  expect(backend.startBridge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '只读浏览文件' }));
  expect(screen.getByLabelText('用户数据目录')).toBeVisible();
  expect(screen.getByRole('button', { name: '枚举资料' })).toBeEnabled();
  expect(backend.enumerateChromeUserData).not.toHaveBeenCalled();
  expect(screen.getByText(/无需扩展，可浏览最后有效/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '枚举资料' }));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('请输入 Chrome 用户数据目录');
});

it('uses the selected source for status even when another profile is live', async () => {
  const cached = { ...profile, profileId: 'profile-b', displayName: '离线资料', connection: 'cached_read_only' as const };
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile, cached] });
  render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读');
  expect(screen.getByText(/缓存时间：尚无同步时间/)).toBeVisible();
  act(() => receive({ ...initial, revision: 2, profiles: [profile, { ...cached, connection: 'reconciling' }] }));
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('核对中 · 只读');
  expect(backend.applyEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  fireEvent.click(screen.getAllByRole('button', { name: '浏览此资料' })[0]!);
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:profile-a');
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome');
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  fireEvent.click(screen.getAllByRole('button', { name: '浏览此资料' })[0]!);
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:profile-a');
});

it('enables and browses the isolated local Skills library from settings without exposing Chrome pairing or tree-write controls', async () => {
  const mirror: BridgeState['mirrors'][number] = {
    mirrorSourceId: 'mirror-local-check', displayName: '独立镜像', association: 'independent', pairedProfileId: null,
    fileStatus: 'current', watching: true, nodeCount: 1, revision: 1, lastSyncedAt: null, errorCode: null, canWriteBrowser: false,
  };
  const localProfile: BridgeState['profiles'][number] = {
    profileId: 'local-skills', instanceId: 'local-skills', displayName: 'Skills 书签库', connection: 'local',
    writePaused: false, ignored: false, nodeCount: 2, revision: 2, lastSyncedAt: 1791800000000, errorCode: null,
  };
  render(<App />);
  expect(await screen.findByRole('region', { name: '首次接入' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '启用本地 Skills 书签库' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  const enableButton = await screen.findByRole('button', { name: '启用本地 Skills 书签库' });
  expect(enableButton).toBeVisible();

  vi.mocked(backend.ensureLocalLibrary).mockResolvedValue({ ...initial, revision: 2, profiles: [localProfile], mirrors: [mirror] });
  vi.mocked(backend.readCacheTree).mockResolvedValue({
    nodes: [
      { chromeId: 'skills-root', parentId: null, position: 0, kind: 'folder', title: 'Skills 书签', url: null, folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null },
      { chromeId: 'local-b:1', parentId: 'skills-root', position: 0, kind: 'bookmark', title: '本地研究条目', url: 'https://example.com/local', folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null },
    ],
  });
  vi.mocked(backend.readCacheQuery).mockResolvedValue({
    items: [{ chromeId: 'local-b:1', parentId: 'skills-root', position: 0, kind: 'bookmark', title: '本地研究条目', url: 'https://example.com/local', folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null }],
    total: 1, offset: 0, nextOffset: null, sourceEpoch: 1, revision: 2,
  });
  vi.mocked(backend.readCacheNode).mockResolvedValue({
    node: { chromeId: 'local-b:1', parentId: 'skills-root', position: 0, kind: 'bookmark', title: '本地研究条目', url: 'https://example.com/local', folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null },
    ancestors: ['Skills 书签'],
  });

  fireEvent.click(enableButton);
  await waitFor(() => expect(backend.ensureLocalLibrary).toHaveBeenCalledOnce());
  expect(await screen.findByRole('heading', { level: 1, name: '书签' })).toBeVisible();
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('本地书签库');
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:local-skills');
  expect(screen.queryByRole('button', { name: '新建' })).toBeNull();
  expect(await screen.findByRole('option', { name: /本地研究条目/ })).toBeVisible();

  fireEvent.click(screen.getByRole('checkbox', { name: '选择 本地研究条目' }));
  expect(screen.queryByRole('button', { name: '移动所选' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除所选' })).toBeNull();
  expect(screen.getByRole('button', { name: '标签' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  expect(screen.queryByRole('button', { name: '启用本地 Skills 书签库' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重新连接' })).toBeNull();
  expect(screen.queryByRole('button', { name: '吊销配对' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '已配对资料' })).toBeNull();
  expect(screen.queryByRole('button', { name: '验证关联' })).toBeNull();
});

it('groups all 5 primary nav items at top, hides sidebar-library off library, removes status-bar, and navigates via connection-pill', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));

  const nav = container.querySelector('.app-sidebar > nav.primary-navigation[aria-label="主导航"]');
  expect(nav).not.toBeNull();
  expect(Array.from(nav!.querySelectorAll('button.nav-button')).map((btn) => btn.textContent?.trim())).toEqual([
    '书签', '整理', '语义检索', '操作历史', '设置',
  ]);
  expect(container.querySelector('.secondary-navigation')).toBeNull();
  expect(container.querySelector('footer.status-bar')).toBeNull();

  const sidebarLibrary = container.querySelector('.sidebar-library');
  expect(sidebarLibrary).not.toBeNull();
  expect(sidebarLibrary).not.toHaveAttribute('hidden');

  const pill = container.querySelector('.app-sidebar > button.connection-pill[type="button"]');
  expect(pill).not.toBeNull();
  expect(pill).toHaveTextContent('已连接 Chrome');
  expect(pill!.querySelector('svg.workspace-icon')).not.toBeNull();
  expect(pill!.querySelector('.dot, .status-dot, .indicator')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '整理' }));
  expect(sidebarLibrary).toHaveAttribute('hidden');

  fireEvent.click(pill!);
  expect(screen.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Chrome 连接' })).toHaveAttribute('aria-selected', 'true');
  expect(sidebarLibrary).toHaveAttribute('hidden');
});
