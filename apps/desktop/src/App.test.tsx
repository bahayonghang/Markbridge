import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BridgeState } from '@markbridge/protocol';
import { App } from './App';
import * as backend from './backend';
import { DEFAULT_UI_PREFERENCES, UI_PREFERENCES_KEY } from './features/settings/ui-preferences';
import { LAYOUT_PREFERENCES_KEY } from './features/settings/layout-preferences';

vi.mock('./backend', () => ({
  getStartupState: vi.fn(), getBridgeState: vi.fn(), subscribeBridgeState: vi.fn(),
  listInstalledFonts: vi.fn(async () => ({ status: 'ready', families: [] })),
  hasNativeBridge: vi.fn(), retryBridgeListener: vi.fn(), renameProfile: vi.fn(),
  setProfileWritePaused: vi.fn(), ignoreProfile: vi.fn(), resumeProfile: vi.fn(), reconnectProfile: vi.fn(), ensureLocalLibrary: vi.fn(),
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
  semanticSettings: vi.fn(async () => ({ enabled: false, endpointLabel: 'http://localhost:11434', model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 })),
  semanticStatus: vi.fn(async () => ({ settings: { enabled: false, endpointLabel: 'http://localhost:11434', model: null, inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 }, index: null })),
}));
const initial: BridgeState = { protocolVersion: 1, revision: 1, port: null, errorCode: null, profiles: [], mirrors: [] };
const profile: BridgeState['profiles'][number] = {
  profileId: 'profile-a', instanceId: 'instance-a', displayName: '研究资料', connection: 'live',
  writePaused: false, ignored: false, nodeCount: 17, revision: 4, lastSyncedAt: null, errorCode: null,
};
let receive: (state: BridgeState) => void;
let invalid: () => void;
const unsubscribe = vi.fn();

const initialInnerWidth = window.innerWidth;
const initialInnerHeight = window.innerHeight;

function setViewport(width: number, height = 900) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  fireEvent(window, new Event('resize'));
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialInnerWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: initialInnerHeight });
  vi.mocked(backend.hasNativeBridge).mockReturnValue(true);
  vi.mocked(backend.getStartupState).mockResolvedValue({ protocolVersion: 1, state: 'unpaired' });
  vi.mocked(backend.getBridgeState).mockResolvedValue(initial);
  vi.mocked(backend.subscribeBridgeState).mockImplementation(async (onState, onInvalid) => {
    receive = onState;
    invalid = onInvalid;
    return unsubscribe;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialInnerWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: initialInnerHeight });
});

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
  expect(backend.retryBridgeListener).not.toHaveBeenCalled();
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
  const otherSources = document.querySelector('details.other-sources') as HTMLDetailsElement;
  expect(otherSources).not.toBeNull();
  expect(otherSources.open).toBe(false);
  fireEvent.click(screen.getByText('其他接入方式：只读文件来源'));
  expect(await screen.findByText('文件陈旧 · 保留缓存')).toBeVisible();
  expect(screen.getByText('独立只读')).toBeVisible();
  expect(screen.getByText('正在监听')).toBeVisible();
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
  expect(screen.queryByLabelText('端口')).toBeNull();
  expect(screen.queryByRole('button', { name: '启动连接' })).toBeNull();
  expect(screen.queryByRole('button', { name: '生成配对串' })).toBeNull();
  expect(screen.getByRole('button', { name: '重试监听' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '启用本地 Skills 书签库' })).toBeDisabled();
  expect(backend.retryBridgeListener).not.toHaveBeenCalled();
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
  act(() => { receive({ ...initial, revision: 3, port: 49153, profiles: [profile] }); });
  await act(async () => { hydrate(initial); });
  expect(screen.getByText('实时同步')).toBeVisible();
  vi.mocked(backend.reconnectProfile).mockResolvedValue({ ...initial, revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(backend.reconnectProfile).toHaveBeenCalledWith('profile-a'));
  expect(screen.getByText('实时同步')).toBeVisible();
});

it('shows PORT_EXHAUSTED recovery guidance, retries listener once, and clears retry trigger once bound', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, revision: 1, port: null, errorCode: 'PORT_EXHAUSTED' });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await waitFor(() => expect(document.querySelector('.connection-pill')).toHaveTextContent('端口已占满 · 只读'));
  expect(screen.getByRole('alert')).toHaveTextContent('49153–49160');
  vi.mocked(backend.retryBridgeListener).mockResolvedValue({ ...initial, revision: 2, port: 49154, errorCode: null });
  fireEvent.click(screen.getByRole('button', { name: '重试监听' }));
  expect(await screen.findByText('127.0.0.1:49154')).toBeVisible();
  expect(backend.retryBridgeListener).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByRole('button', { name: '重试监听' })).toBeNull();
  expect(document.querySelector('.connection-pill')).toHaveTextContent('监听就绪 · :49154');
});

it('shows reconciling, ignored cache as read-only, and supports resumeProfile', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, profiles: [profile] });
  vi.mocked(backend.reconnectProfile).mockResolvedValue({ ...initial, revision: 2, port: 49153, profiles: [{ ...profile, connection: 'reconciling' }] });
  vi.mocked(backend.ignoreProfile).mockResolvedValue({ ...initial, revision: 3, port: 49153, profiles: [{ ...profile, connection: 'ignored', ignored: true }] });
  vi.mocked(backend.resumeProfile).mockResolvedValue({ ...initial, revision: 4, port: 49153, profiles: [{ ...profile, connection: 'cached_read_only', ignored: false }] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await screen.findByText('实时同步');
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('核对中 · 只读'));
  expect((await screen.findAllByText('核对中 · 只读')).length).toBeGreaterThanOrEqual(2);
  const ignoreButton = screen.getByRole('button', { name: '断开并忽略' });
  fireEvent.click(ignoreButton);
  expect(backend.ignoreProfile).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('本机缓存、标签和备注都会保留');
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(backend.ignoreProfile).not.toHaveBeenCalled();
  expect(ignoreButton).toHaveFocus();
  fireEvent.click(ignoreButton);
  fireEvent.click(screen.getByRole('button', { name: '确认断开并忽略' }));
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已忽略 · 只读'));
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已忽略 · 只读');
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '断开并忽略' })).toBeNull();
  const resumeButton = screen.getByRole('button', { name: '恢复连接' });
  expect(resumeButton).toBeEnabled();
  fireEvent.click(resumeButton);
  await waitFor(() => expect(backend.resumeProfile).toHaveBeenCalledExactlyOnceWith('profile-a'));
  expect(await screen.findByText('缓存 · 只读')).toBeVisible();
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读');
});

it('keeps disconnected cache available for explicit reconnect, write-pause, and ignore', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, profiles: [{ ...profile, connection: 'cached_read_only' }] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await screen.findByText('缓存 · 只读');
  expect(screen.getByText('17')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '暂停写入（只读）' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '断开并忽略' })).toBeEnabled();
});

it('rejects invalid events without exposing the last live state as usable', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, profiles: [profile] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));
  await screen.findByText('实时同步');
  act(() => { invalid(); });
  expect(screen.getByRole('alert')).toHaveTextContent('收到无效连接状态');
  expect(screen.getByText('状态无效 · 只读')).toBeVisible();
  expect(screen.getByRole('button', { name: '断开并忽略' })).toBeDisabled();
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
  expect(backend.retryBridgeListener).not.toHaveBeenCalled();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('renders minimal 1-step zero-click onboarding and collapsed other-sources without pairing or port forms', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  render(<App />);
  const region = await screen.findByRole('region', { name: '首次接入' });
  expect(region).toBeVisible();
  expect(screen.getByText(/chrome:\/\/extensions/)).toBeVisible();
  expect(screen.getByText('127.0.0.1:49153')).toBeVisible();
  expect(screen.getByRole('button', { name: '启用本地 Skills 书签库' })).toBeVisible();

  const otherDetails = region.querySelector('details.other-sources') as HTMLDetailsElement;
  expect(otherDetails).not.toBeNull();
  expect(otherDetails.open).toBe(false);
  expect(screen.getByLabelText('用户数据目录')).not.toBeVisible();

  expect(screen.queryByLabelText('端口')).toBeNull();
  expect(screen.queryByRole('button', { name: '启动连接' })).toBeNull();
  expect(screen.queryByRole('button', { name: '生成配对串' })).toBeNull();
  expect(screen.queryByRole('button', { name: '确认配对' })).toBeNull();
  expect(region.textContent).not.toMatch(/120\s*[秒s]/);
  expect(backend.aiSettings).not.toHaveBeenCalled();
  expect(backend.retryBridgeListener).not.toHaveBeenCalled();
  expect(backend.enumerateChromeUserData).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('其他接入方式：只读文件来源'));
  expect(screen.getByLabelText('用户数据目录')).toBeVisible();
  expect(screen.getByRole('button', { name: '枚举资料' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '枚举资料' }));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('请输入 Chrome 用户数据目录');
});

it('uses the selected source for status even when another profile is live', async () => {
  const cached = { ...profile, profileId: 'profile-b', displayName: '离线资料', connection: 'cached_read_only' as const };
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, profiles: [profile, cached] });
  render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读');
  expect(screen.getByText(/缓存时间：尚无同步时间/)).toBeVisible();
  act(() => receive({ ...initial, revision: 2, port: 49153, profiles: [profile, { ...cached, connection: 'reconciling' }] }));
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

it('enables and browses the isolated local Skills library from settings without exposing Chrome controls', async () => {
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
  expect(screen.getByRole('button', { name: '启用本地 Skills 书签库' })).toBeVisible();

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
  expect(screen.queryByRole('button', { name: '断开并忽略' })).toBeNull();
  expect(screen.queryByRole('button', { name: '暂停写入（只读）' })).toBeNull();
  expect(screen.queryByLabelText('资料名称')).toBeNull();
  fireEvent.click(screen.getByText('其他接入方式：只读文件来源'));
  expect(screen.queryByRole('combobox', { name: '关联 Chrome 资料' })).toBeNull();
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

it('navigates all 5 settings tabs via keyboard and structures General with segmented controls and well groups', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));

  const tabNames = ['通用', 'Chrome 连接', 'AI', '语义检索', '备份导出'];
  const firstTab = screen.getByRole('tab', { name: '通用' });
  firstTab.focus();
  for (let i = 1; i < tabNames.length; i += 1) {
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: tabNames[i]! })).toHaveFocus();
    expect(screen.getByRole('tab', { name: tabNames[i]! })).toHaveAttribute('aria-selected', 'true');
  }
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(firstTab).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(screen.getByRole('tab', { name: '备份导出' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(screen.getByRole('tab', { name: '语义检索' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });

  const generalPanel = screen.getByRole('tabpanel', { name: '通用' });
  expect(generalPanel.querySelectorAll('.well-group').length).toBeGreaterThanOrEqual(2);
  expect(generalPanel.querySelectorAll('.primary-button')).toHaveLength(0);
  const themeGroup = generalPanel.querySelector('.segmented-control.theme-options');
  expect(themeGroup).not.toBeNull();
  expect(Array.from(themeGroup!.querySelectorAll('button')).map(b => b.textContent)).toEqual(['跟随系统', '浅色', '深色']);
  const sizeGroup = generalPanel.querySelector('.segmented-control.font-size-options');
  expect(sizeGroup).not.toBeNull();
  expect(Array.from(sizeGroup!.querySelectorAll('button')).map(b => b.textContent)).toEqual(['13 px', '14 px', '16 px']);
  expect(screen.getByLabelText('字号')).toHaveValue('14');
  expect(generalPanel.querySelector('.appearance-sample')).not.toBeNull();
  expect(screen.getByRole('button', { name: '选择字体' })).toBeVisible();
  const resetButton = screen.getByRole('button', { name: '恢复默认外观' });
  expect(resetButton).not.toHaveClass('primary-button');

  fireEvent.click(screen.getByRole('button', { name: '16 px' }));
  expect(document.documentElement.style.getPropertyValue('--text-size')).toBe('16px');
  expect(screen.getByRole('button', { name: '16 px' })).toHaveAttribute('aria-pressed', 'true');
  expect(container.querySelectorAll('.settings-tabs > button[role="tab"]')).toHaveLength(5);
});

it('auto-enters bookmark workbench when first active Chrome profile connects during onboarding and skips ignored profiles', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  render(<App />);
  expect(await screen.findByRole('region', { name: '首次接入' })).toBeVisible();
  expect(document.querySelector('.connection-pill')).toHaveTextContent('监听就绪 · :49153');

  const ignored: BridgeState['profiles'][number] = {
    ...profile, profileId: 'profile-ignored', instanceId: 'instance-ignored', displayName: '已忽略旧资料',
    connection: 'ignored', ignored: true,
  };
  act(() => {
    receive({ ...initial, revision: 2, port: 49153, profiles: [ignored, profile] });
  });

  expect(await screen.findByRole('heading', { level: 1, name: '书签' })).toBeVisible();
  expect(screen.queryByRole('region', { name: '首次接入' })).toBeNull();
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:profile-a');
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome');
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已连接 Chrome');
});

it('keeps a user who intentionally opened Settings there when the first Chrome profile connects', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153 });
  render(<App />);
  expect(await screen.findByRole('region', { name: '首次接入' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();

  act(() => {
    receive({ ...initial, revision: 2, port: 49153, profiles: [profile] });
  });

  expect(screen.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
  expect(screen.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已连接 Chrome');
});

it('reflects PORT_EXHAUSTED, CONFLICT, writePaused, and multi-live profile count in connection-pill', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, revision: 1, port: null, errorCode: 'PORT_EXHAUSTED' });
  render(<App />);
  await waitFor(() => expect(document.querySelector('.connection-pill')).toHaveTextContent('端口已占满 · 只读'));

  act(() => {
    receive({ ...initial, revision: 2, port: null, errorCode: 'CONFLICT' });
  });
  expect(document.querySelector('.connection-pill')).toHaveTextContent('监听冲突 · 只读');

  act(() => {
    receive({ ...initial, revision: 3, port: 49153, errorCode: null, profiles: [{ ...profile, writePaused: true }] });
  });
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已暂停写入 · 只读');
  expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已暂停写入 · 只读');

  const second = { ...profile, profileId: 'profile-b', instanceId: 'instance-b', displayName: '第二份资料' };
  act(() => {
    receive({ ...initial, revision: 4, port: 49153, errorCode: null, profiles: [profile, second] });
  });
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已连接 Chrome（2 个）');
});

it('validates inline profile rename, immediately toggles writePaused, and uses single-column well-groups', async () => {
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, port: 49153, profiles: [profile] });
  vi.mocked(backend.renameProfile).mockResolvedValue({ ...initial, revision: 2, port: 49153, profiles: [{ ...profile, displayName: '工作资料' }] });
  vi.mocked(backend.setProfileWritePaused)
    .mockResolvedValueOnce({ ...initial, revision: 3, port: 49153, profiles: [{ ...profile, displayName: '工作资料', writePaused: true }] })
    .mockResolvedValueOnce({ ...initial, revision: 4, port: 49153, profiles: [{ ...profile, displayName: '工作资料', writePaused: false }] });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Chrome 连接' }));

  const renameInput = await screen.findByLabelText('资料名称');
  const panel = screen.getByRole('tabpanel', { name: 'Chrome 连接' });
  expect(panel.querySelectorAll('.well-group').length).toBeGreaterThanOrEqual(4);
  expect(panel.querySelectorAll('.well-group .well-group')).toHaveLength(0);
  expect(panel.querySelectorAll('button.primary-button').length).toBeLessThanOrEqual(1);
  expect(panel.textContent).not.toMatch(/\s[·•]\s[^\n]*\s[·•]\s/);
  expect(panel.querySelector('[aria-label="诊断导出"]')).toHaveClass('well-group');
  fireEvent.change(renameInput, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  expect(screen.getByRole('alert')).toHaveTextContent('1–128');
  expect(backend.renameProfile).not.toHaveBeenCalled();

  const tooLong = '字'.repeat(129);
  fireEvent.change(renameInput, { target: { value: tooLong } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  expect(screen.getByRole('alert')).toHaveTextContent('128');
  expect(renameInput).toHaveValue(tooLong);
  expect(backend.renameProfile).not.toHaveBeenCalled();

  fireEvent.change(renameInput, { target: { value: 'local-skills' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  expect(screen.getByRole('alert')).toHaveTextContent('local-skills');
  expect(backend.renameProfile).not.toHaveBeenCalled();

  fireEvent.change(renameInput, { target: { value: '  工作资料  ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await waitFor(() => expect(backend.renameProfile).toHaveBeenCalledExactlyOnceWith('profile-a', '工作资料'));
  expect(await screen.findByRole('heading', { level: 3, name: '工作资料' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '暂停写入（只读）' }));
  await waitFor(() => expect(backend.setProfileWritePaused).toHaveBeenCalledWith('profile-a', true));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText('已暂停写入（只读保护）')).toBeVisible();
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已暂停写入 · 只读');

  fireEvent.click(screen.getByRole('button', { name: '恢复写入' }));
  await waitFor(() => expect(backend.setProfileWritePaused).toHaveBeenCalledWith('profile-a', false));
  expect(document.querySelector('.connection-pill')).toHaveTextContent('已连接 Chrome');
});

it('renders default 256px sidebar, splitter ARIA, and brand collapse toggle without saving on StrictMode mount', async () => {
  setViewport(1440, 900);
  const save = vi.spyOn(Storage.prototype, 'setItem');
  const { container } = render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  const sidebar = container.querySelector('aside#app-sidebar.app-sidebar');
  const splitter = screen.getByRole('separator', { name: '调整侧栏宽度' });
  const collapseBtn = screen.getByRole('button', { name: '收起侧栏' });

  expect(sidebar).not.toBeNull();
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('256px');
  expect(workspace).not.toHaveClass('is-sidebar-collapsed');
  expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  expect(splitter).toHaveAttribute('aria-controls', 'app-sidebar');
  expect(splitter).toHaveAttribute('aria-valuemin', '200');
  expect(splitter).toHaveAttribute('aria-valuemax', '420');
  expect(splitter).toHaveAttribute('aria-valuenow', '256');
  expect(splitter).toHaveAttribute('tabindex', '0');
  expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');
  expect(collapseBtn).toHaveAttribute('aria-controls', 'app-sidebar');
  expect(collapseBtn.getAttribute('title')).toContain('(Ctrl+B)');
  expect(save).not.toHaveBeenCalled();
  save.mockRestore();
});

it('resizes sidebar via keyboard steps, Home, and End and persists to layout-preferences.v1', async () => {
  setViewport(1440, 900);
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  const splitter = screen.getByRole('separator', { name: '调整侧栏宽度' });

  fireEvent.keyDown(splitter, { key: 'ArrowRight' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('272px');
  expect(splitter).toHaveAttribute('aria-valuenow', '272');
  expect(JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY)!)).toEqual({ version: 1, sidebarWidthPx: 272, sidebarCollapsed: false });

  fireEvent.keyDown(splitter, { key: 'ArrowRight', shiftKey: true });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('304px');
  expect(splitter).toHaveAttribute('aria-valuenow', '304');

  fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('288px');

  fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('256px');

  fireEvent.keyDown(splitter, { key: 'End' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('420px');
  expect(splitter).toHaveAttribute('aria-valuenow', '420');

  fireEvent.keyDown(splitter, { key: 'Home' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('200px');
  expect(splitter).toHaveAttribute('aria-valuenow', '200');
  expect(JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY)!)).toEqual({ version: 1, sidebarWidthPx: 200, sidebarCollapsed: false });
});

it('supports pointer drag preview, save on pointerUp, Escape cancel, and double-click reset', async () => {
  setViewport(1440, 900);
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  const splitter = screen.getByRole('separator', { name: '调整侧栏宽度' });
  const save = vi.spyOn(Storage.prototype, 'setItem');

  fireEvent.pointerDown(splitter, { pointerId: 1, button: 0, clientX: 270 });
  fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 354 });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('340px');
  expect(splitter).toHaveAttribute('aria-valuenow', '340');
  expect(save).not.toHaveBeenCalled();

  fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 354 });
  expect(save).toHaveBeenCalledWith(LAYOUT_PREFERENCES_KEY, JSON.stringify({ version: 1, sidebarWidthPx: 340, sidebarCollapsed: false }));

  save.mockClear();
  fireEvent.pointerDown(splitter, { pointerId: 2, button: 0, clientX: 354 });
  fireEvent.pointerMove(splitter, { pointerId: 2, clientX: 414 });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('400px');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('340px');
  fireEvent.pointerUp(splitter, { pointerId: 2, clientX: 414 });
  expect(save).not.toHaveBeenCalled();

  fireEvent.doubleClick(splitter);
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('256px');
  expect(JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY)!)).toEqual({ version: 1, sidebarWidthPx: 256, sidebarCollapsed: false });
  save.mockRestore();
});

it('clamps effective sidebar width dynamically on viewport resize without losing saved wider width', async () => {
  setViewport(1440, 900);
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify({ version: 1, sidebarWidthPx: 400, sidebarCollapsed: false }));
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  const splitter = screen.getByRole('separator', { name: '调整侧栏宽度' });
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('400px');

  act(() => { setViewport(860, 760); });
  expect(splitter).toHaveAttribute('aria-valuemax', '338');
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('338px');
  expect(splitter).toHaveAttribute('aria-valuenow', '338');

  act(() => { setViewport(1440, 900); });
  expect(splitter).toHaveAttribute('aria-valuemax', '420');
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('400px');
});

it('toggles icon rail via brand button and Ctrl+B/Cmd+B while respecting editable targets and narrow viewports', async () => {
  setViewport(1440, 900);
  vi.mocked(backend.getBridgeState).mockResolvedValue({ ...initial, profiles: [profile] });
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify({ version: 1, sidebarWidthPx: 332, sidebarCollapsed: false }));
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('已连接 Chrome'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
  expect(workspace).toHaveClass('is-sidebar-collapsed');
  const expandBtn = screen.getByRole('button', { name: '展开侧栏' });
  expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
  expect(JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY)!)).toEqual({ version: 1, sidebarWidthPx: 332, sidebarCollapsed: true });

  const searchInput = screen.getByLabelText('搜索标题或网址');
  searchInput.focus();
  fireEvent.keyDown(searchInput, { key: 'b', ctrlKey: true });
  expect(workspace).toHaveClass('is-sidebar-collapsed');

  const editableDiv = document.createElement('div');
  editableDiv.setAttribute('contenteditable', 'true');
  editableDiv.tabIndex = 0;
  document.body.appendChild(editableDiv);
  editableDiv.focus();
  fireEvent.keyDown(editableDiv, { key: 'b', ctrlKey: true });
  expect(workspace).toHaveClass('is-sidebar-collapsed');
  editableDiv.remove();

  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  expect(workspace).not.toHaveClass('is-sidebar-collapsed');
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('332px');

  fireEvent.keyDown(window, { key: 'B', metaKey: true });
  expect(workspace).toHaveClass('is-sidebar-collapsed');

  act(() => { setViewport(799, 760); });
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  expect(workspace).toHaveClass('is-sidebar-collapsed');
});

it('keeps layout preferences isolated when resetting appearance defaults', async () => {
  setViewport(1440, 900);
  const customLayout = { version: 1, sidebarWidthPx: 340, sidebarCollapsed: true };
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify(customLayout));
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ version: 2, theme: 'dark', font: { kind: 'preset', value: 'yahei' }, fontSizePx: 16 }));
  const { container } = render(<App />);
  await waitFor(() => expect(document.querySelector('.workspace-heading .connection')).toHaveTextContent('未连接 · 只读'));

  const workspace = container.querySelector('.workspace') as HTMLElement;
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('340px');
  expect(workspace).toHaveClass('is-sidebar-collapsed');

  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));

  expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY)!)).toEqual(DEFAULT_UI_PREFERENCES);
  expect(JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY)!)).toEqual(customLayout);
  expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('340px');
  expect(workspace).toHaveClass('is-sidebar-collapsed');
});
