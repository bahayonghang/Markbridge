import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BookmarkNode, BridgeState } from '@markbridge/protocol';
import { buildB10k } from './b10k';
import { LibraryWorkspace } from './LibraryWorkspace';
import { searchSnapshot } from './model';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type Args = Record<string, unknown>;
const longTitle = `长标题${'长'.repeat(180)}`;

function node(chromeId: string, parentId: string | null, position: number, kind: BookmarkNode['kind'], title: string, url?: string): BookmarkNode {
  return { chromeId, parentId, position, kind, title, url: kind === 'bookmark' ? url ?? 'https://example.com/item' : null };
}

function state(profiles: BridgeState['profiles'], mirrors: BridgeState['mirrors'] = [], revision = 1): BridgeState {
  return { protocolVersion: 1, revision, port: 49153, errorCode: null, profiles, pending: [], mirrors };
}

function profile(id: string, name: string, revision = 4, connection: BridgeState['profiles'][number]['connection'] = 'live'): BridgeState['profiles'][number] {
  return { profileId: id, instanceId: `instance-${id}`, displayName: name, connection, nodeCount: 4, revision, lastSyncedAt: null, errorCode: null };
}

const root = node('0', null, 0, 'folder', '根');
const bar = node('1', '0', 0, 'folder', '栏');
const other = node('2', '0', 1, 'folder', '其他');
const alpha = node('10', '1', 0, 'bookmark', 'Alpha', 'https://example.com/Alpha');
const beta = node('11', '1', 1, 'bookmark', 'Beta', 'javascript:alert(1)');
const firstDup = node('12', '1', 2, 'bookmark', '中文书签', 'https://example.com/dup');
const secondDup = node('13', '1', 3, 'bookmark', longTitle, 'https://example.com/dup');
const tree = { nodes: [root, bar, other] };
const barItems = [alpha, beta, firstDup, secondDup];

function argsOf(value: unknown): Args {
  return value && typeof value === 'object' ? value as Args : {};
}

function install(extra?: (command: string, args: Args) => unknown) {
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args = argsOf(raw);
    const custom = extra?.(command, args);
    if (custom !== undefined) return custom;
    if (command === 'cache_tree') return args.folderId == null ? tree : { nodes: [bar, ...barItems] };
    if (command === 'cache_list') return args.folderId === '1' ? { items: barItems, total: barItems.length } : { items: [bar, other], total: 2 };
    if (command === 'cache_count') return args.folderId === '1' ? { folders: 4, bookmarks: 9 } : { folders: 2, bookmarks: 0 };
    if (command === 'cache_get') {
      const found = [root, bar, other, ...barItems].find((item) => item.chromeId === args.chromeId) ?? root;
      return { node: found, ancestors: args.chromeId === '10' || args.chromeId === '11' ? ['根', '栏'] : [] };
    }
    if (command === 'cache_search') return args.query === 'Alpha' ? { items: [alpha] } : { items: [] };
    if (command === 'open_http_url') return null;
    if (command === 'list_operations' || command === 'refresh_operations' || command === 'review_operation') return { operations: [] };
    if (command === 'get_mirror_tree') return { mirrorSourceId: 'mirror-a', displayName: 'Personal', fileStatus: 'stale', association: 'independent', revision: 2, lastSyncedAt: null, errorCode: 'INVALID_TREE', canWriteBrowser: false, nodes: [root, { ...firstDup, parentId: '0' }, { ...secondDup, parentId: '0' }] };
    return {};
  });
}

beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true); install(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

async function shown() {
  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByRole('treeitem', { name: /栏/ })).toBeVisible();
  return screen.getByRole('treeitem', { name: /根/ });
}

it('keeps duplicate urls, chinese text, and long titles through the cache reads', async () => {
  const rootRow = await shown();
  rootRow.focus();
  fireEvent.keyDown(rootRow, { key: 'ArrowDown' });
  expect(await screen.findByText('中文书签')).toBeVisible();
  expect(screen.getAllByText('https://example.com/dup')).toHaveLength(2);
  expect(screen.getByText(longTitle)).toHaveClass('library-title');
  expect(screen.getByText(/下级文件夹 4 · 下级书签 9/)).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('cache_tree', { profileId: 'profile-a', folderId: null, depth: 0 });
  expect(invoke).toHaveBeenCalledWith('cache_tree', { profileId: 'profile-a', folderId: null, depth: 1 });
  expect(invoke).toHaveBeenCalledWith('cache_list', { profileId: 'profile-a', folderId: '1', offset: 0, limit: 10000 });
  expect(invoke).toHaveBeenCalledWith('cache_count', { profileId: 'profile-a', folderId: '1' });
  fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
  expect(await screen.findByRole('list', { name: '所在路径' })).toHaveTextContent('根');
  expect(screen.getByRole('list', { name: '所在路径' })).toHaveTextContent('栏');
  expect(invoke).toHaveBeenCalledWith('cache_get', { profileId: 'profile-a', chromeId: '10' });
});

it('moves, expands, and opens with the keyboard while focus stays visible', async () => {
  const rootRow = await shown();
  rootRow.focus();
  fireEvent.keyDown(rootRow, { key: 'ArrowDown' });
  const barRow = screen.getByRole('treeitem', { name: /栏/ });
  expect(barRow).toHaveFocus();
  fireEvent.keyDown(barRow, { key: 'ArrowRight' });
  expect(barRow).toHaveAttribute('aria-expanded', 'true');
  const alpha = await screen.findByRole('option', { name: /Alpha/ });
  alpha.focus();
  fireEvent.keyDown(alpha, { key: 'Enter' });
  expect(invoke).toHaveBeenCalledWith('open_http_url', { url: 'https://example.com/Alpha' });
  const script = await screen.findByRole('option', { name: /Beta/ });
  script.focus();
  fireEvent.keyDown(script, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('button', { name: '在浏览器中打开' })).toBeDisabled());
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'open_http_url')).toHaveLength(1);
});

it('drops a late profile response and keeps the same chrome id on the selected profile', async () => {
  let resolveA: ((value: unknown) => void) | undefined;
  install((command, args) => {
    if (command === 'cache_list' && args.profileId === 'profile-a') return new Promise((resolve) => { resolveA = resolve; });
    if (command === 'cache_tree' && args.profileId === 'profile-a' && args.folderId == null) return { nodes: [node('same', null, 0, 'folder', '目录-profile-a')] };
    if (command === 'cache_tree' && args.profileId === 'profile-b' && args.folderId == null) return { nodes: [node('same', null, 0, 'folder', '目录-profile-b')] };
    if (command === 'cache_list' && args.profileId === 'profile-b') return { items: [node('same', 'same', 0, 'bookmark', '结果-profile-b', 'https://example.com/b')], total: 1 };
    return undefined;
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A'), profile('profile-b', '资料 B')])} invalid={false} native focusMirrorId={null} />);
  await screen.findByText('目录-profile-a');
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  expect(await screen.findByText('结果-profile-b')).toBeVisible();
  await act(async () => { resolveA?.({ items: [node('same', 'same', 0, 'bookmark', '结果-profile-a', 'https://example.com/a')], total: 1 }); });
  expect(screen.getByText('结果-profile-b')).toBeVisible();
  expect(screen.queryByText('结果-profile-a')).not.toBeInTheDocument();
  expect(screen.queryByText('目录-profile-a')).not.toBeInTheDocument();
  view.unmount();
});

it('switches profiles 20 times without leaving the previous result visible', async () => {
  install((command, args) => {
    const id = String(args.profileId);
    if (command === 'cache_tree' && args.folderId == null) return { nodes: [node('same', null, 0, 'folder', `目录-${id}`)] };
    if (command === 'cache_list') return { items: [node('same', 'same', 0, 'bookmark', `结果-${id}`, 'https://example.com/same')], total: 1 };
    if (command === 'cache_get') return { node: node('same', null, 0, 'folder', `目录-${id}`), ancestors: [] };
    return undefined;
  });
  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A'), profile('profile-b', '资料 B')])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText('目录-profile-a')).toBeVisible();
  for (let step = 1; step <= 20; step += 1) {
    const id = step % 2 === 0 ? 'profile-b' : 'profile-a';
    await act(async () => { fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: `profile:${id}` } }); });
  }
  expect(await screen.findByText('结果-profile-b')).toBeVisible();
  expect(screen.queryByText('结果-profile-a')).not.toBeInTheDocument();
  expect(screen.queryByText('目录-profile-a')).not.toBeInTheDocument();
});

it('names an empty library, a disconnected cache, and a revision gap', async () => {
  install((command) => command === 'cache_tree' ? { nodes: [] } : undefined);
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText('此资料还没有书签。')).toBeVisible();
  install();
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 4, 'cached_read_only')])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText(/扩展未连接/)).toBeVisible();
  expect(await screen.findByRole('treeitem', { name: /栏/ })).toBeVisible();
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 7, 'reconciling')])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText('来源版本不连续，已重新读取。')).toBeVisible();
  expect(screen.getByText(/正在核对书签/)).toBeVisible();
  view.rerender(<LibraryWorkspace state={state([])} invalid={false} native focusMirrorId={null} />);
  expect(screen.getByText(/尚未接入书签来源/)).toBeVisible();
});

it('keeps search input usable and calls cache search after 200 milliseconds', async () => {
  const pending: Array<(value: unknown) => void> = [];
  install((command, args) => {
    if (command === 'cache_tree' && args.folderId == null) return new Promise((resolve) => { pending.push(resolve); });
    return undefined;
  });
  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  const input = await screen.findByLabelText('搜索标题或网址');
  expect(input).toBeEnabled();
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  await act(async () => { pending.splice(0).forEach((resolve) => resolve(tree)); });
  await screen.findByRole('treeitem', { name: /栏/ });
  vi.useFakeTimers();
  fireEvent.change(input, { target: { value: 'Alpha' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(199); });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_search')).toBe(false);
  expect(input).toBeEnabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(invoke).toHaveBeenCalledWith('cache_search', { profileId: 'profile-a', query: 'Alpha', folderId: null, limit: 201 });
  expect(screen.getByText('1 条匹配')).toBeVisible();
  fireEvent.change(input, { target: { value: 'ALPHA' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('没有匹配的标题或网址。')).toBeVisible();
});

it('shows a synced cache bookmark outside the open folder on the input turn', async () => {
  const hidden = node('99', '2', 0, 'bookmark', 'MB05MARK', 'https://example.com/mb05-mark');
  install((command, args) => {
    if (command === 'cache_search') return { items: [hidden] };
    if (command === 'cache_tree' && args.folderId == null && args.depth === 0) return { nodes: [root, bar, other, hidden] };
    return undefined;
  });
  await shown();
  expect(screen.queryByRole('option', { name: /MB05MARK/ })).not.toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('cache_tree', { profileId: 'profile-a', folderId: null, depth: 0 });
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'MB05MARK' } });
  expect(screen.getByRole('option', { name: /MB05MARK/ })).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_search')).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(invoke).toHaveBeenCalledWith('cache_search', { profileId: 'profile-a', query: 'MB05MARK', folderId: null, limit: 201 });
  expect(screen.getByRole('option', { name: /MB05MARK/ })).toBeVisible();
});

it('shows a loaded profile title on the input turn before cache search', async () => {
  const rootRow = await shown();
  rootRow.focus();
  fireEvent.keyDown(rootRow, { key: 'ArrowDown' });
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Alpha' } });
  expect(screen.getByRole('option', { name: /Alpha/ })).toBeVisible();
  expect(screen.queryByText('中文书签')).not.toBeInTheDocument();
  expect(screen.getByText('1 条匹配')).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_search')).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(invoke).toHaveBeenCalledWith('cache_search', { profileId: 'profile-a', query: 'Alpha', folderId: null, limit: 201 });
  expect(screen.getByRole('option', { name: /Alpha/ })).toBeVisible();
});

it('ignores a cache read that resolves after unmount', async () => {
  let resolveTree: ((value: unknown) => void) | undefined;
  install((command) => command === 'cache_tree' ? new Promise((resolve) => { resolveTree = resolve; }) : undefined);
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  view.unmount();
  await act(async () => { resolveTree?.(tree); });
  expect(screen.queryByText('栏')).not.toBeInTheDocument();
});

it('reads a file mirror without cache commands and filters that snapshot', async () => {
  const mirror = {
    mirrorSourceId: 'mirror-a', displayName: 'Personal', association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'stale' as const, watching: true, nodeCount: 3, revision: 2, lastSyncedAt: null, errorCode: 'INVALID_TREE' as const, canWriteBrowser: false as const,
  };
  render(<LibraryWorkspace state={state([], [mirror])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText('中文书签')).toBeVisible();
  expect(screen.getByText(longTitle)).toBeVisible();
  expect(screen.getAllByText('https://example.com/dup').length).toBeGreaterThan(1);
  expect(screen.getByText(/文件来源陈旧/)).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_tree')).toBe(false);
  expect(invoke).toHaveBeenCalledWith('get_mirror_tree', { mirrorSourceId: 'mirror-a' });
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: '长标题' } });
  expect(screen.getByText(longTitle)).toBeVisible();
  expect(screen.queryByText('中文书签')).not.toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_search')).toBe(false);
});

it('virtualizes ten thousand direct children from the list entry point', async () => {
  const items = Array.from({ length: 10_000 }, (_, index) => node(`b${index}`, '1', index, 'bookmark', index === 0 ? 'FIRST' : index === 9999 ? 'LASTMARK' : `项${index}`, 'https://example.com/item'));
  install((command, args) => {
    if (command === 'cache_list' && args.folderId === '1') return { items, total: items.length };
    return undefined;
  });
  const rootRow = await shown();
  rootRow.focus();
  fireEvent.keyDown(rootRow, { key: 'ArrowDown' });
  expect(await screen.findByText('FIRST')).toBeVisible();
  expect(screen.queryByText('LASTMARK')).not.toBeInTheDocument();
  expect(screen.getAllByRole('option').length).toBeLessThan(40);
  const first = screen.getByRole('option', { name: /FIRST/ });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: /项1https/ })).toHaveFocus();
  const samples: number[] = [];
  for (let run = 0; run < 30; run += 1) {
    const started = performance.now();
    searchSnapshot(items, 'LASTMARK', 201);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  console.info(`MB05_TIMING searchSnapshot n=10000 runs=30 p95_ms=${p95?.toFixed(2)} max_ms=${samples[samples.length - 1]?.toFixed(2)}`);
  expect(searchSnapshot(items, 'LASTMARK', 10)).toHaveLength(1);
  expect(searchSnapshot(items, 'lastmark', 10)).toHaveLength(0);
  expect(searchSnapshot([firstDup, secondDup], 'https://example.com/dup', 10)).toHaveLength(2);
});

it('keeps a ten thousand bookmark mirror consistent across tree, list, and detail', async () => {
  const built = buildB10k();
  expect(built.bookmarks).toBe(10_000);
  expect(built.folders).toBe(1_000);
  expect(built.maxDepth).toBe(20);
  expect(new Set(built.nodes.filter((node) => node.url === 'https://example.com/dup').map((node) => node.chromeId)).size).toBe(1_000);
  install((command) => command === 'get_mirror_tree' ? {
    mirrorSourceId: 'mirror-b10k', displayName: 'B10K', fileStatus: 'current', association: 'independent',
    revision: 1, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: built.nodes,
  } : undefined);
  const mirror = {
    mirrorSourceId: 'mirror-b10k', displayName: 'B10K', association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'current' as const, watching: true, nodeCount: built.nodes.length, revision: 1, lastSyncedAt: null,
    errorCode: null, canWriteBrowser: false as const,
  };
  render(<LibraryWorkspace state={state([], [mirror])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByRole('treeitem', { name: /MB05BAR/ })).toBeVisible();
  expect(screen.getByText('下级文件夹 1003 · 下级书签 10000')).toBeVisible();
  fireEvent.click(screen.getByRole('treeitem', { name: /MB05BAR/ }));
  expect(screen.getByText('中文文件夹')).toBeVisible();
  const search = screen.getByLabelText('搜索标题或网址');
  function commit(value: string) {
    fireEvent.change(search, { target: { value } });
  }
  commit('MB05DEEP');
  fireEvent.click(screen.getByRole('option', { name: /MB05DEEP/ }));
  expect(screen.getByRole('list', { name: '所在路径' }).querySelectorAll('li')).toHaveLength(20);
  expect(screen.getByText('文件夹', { selector: 'dd' })).toBeVisible();
  await commit('MB05MARK');
  const marker = screen.getByRole('option', { name: /MB05MARK/ });
  fireEvent.click(marker);
  expect(screen.getByText('b4')).toBeVisible();
  expect(screen.getByRole('button', { name: '在浏览器中打开' })).toBeEnabled();
  await commit('https://example.com/dup');
  expect(screen.getByText(/200 条匹配/)).toBeVisible();
  expect(screen.getByText(/只显示前 200 条/)).toBeVisible();
  const duplicateIds = screen.getAllByRole('option').map((row) => row.id);
  expect(new Set(duplicateIds).size).toBe(duplicateIds.length);
  expect(duplicateIds.length).toBeGreaterThan(1);
  await commit('长标题');
  expect(screen.getByText(built.longTitle)).toHaveClass('library-title');
  await commit('不要拆');
  expect(screen.getByText(built.pipeTitle)).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cache_tree')).toBe(false);
  expect(invoke).toHaveBeenCalledWith('get_mirror_tree', { mirrorSourceId: 'mirror-b10k' });
}, 20_000);

function editPreview(second = false) {
  return {
    profileId: 'profile-a', expectedRevision: 4, affected: second ? 21 : 1, requiresSecondConfirm: second,
    writable: true, errorCode: null, changes: [{ field: 'title', before: '根', after: '根 2' }],
  };
}

it('requires confirmation before a browser write and a second confirmation for a large delete', async () => {
  install((command, args) => {
    const action = args.action as { kind?: string } | undefined;
    if (command === 'preview_edit') return editPreview(action?.kind === 'delete');
    if (command === 'apply_edit') return { operationId: 'op-1', state: 'applying', errorCode: null, conflicts: [] };
    if (command === 'export_html') return { kind: 'html', body: '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<H3>栏</H3>' };
    if (command === 'export_sidecar') return { kind: 'sidecar', body: '{"schemaVersion":1,"entries":[]}' };
    return undefined;
  });
  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  const title = await screen.findByLabelText('新标题');
  fireEvent.change(title, { target: { value: '根 2' } });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'preview_edit' || command === 'apply_edit')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  expect(await screen.findByRole('dialog', { name: '确认变更' })).toBeVisible();
  expect(screen.getByText(/根 2/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '确认变更' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_edit', expect.objectContaining({ profileId: 'profile-a', secondConfirm: false, action: expect.objectContaining({ kind: 'update', title: '根 2' }) })));
  expect(screen.getByText(/等待回执/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '预览删除' }));
  expect(await screen.findByRole('button', { name: '继续确认' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '继续确认' }));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'apply_edit')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_edit', expect.objectContaining({ secondConfirm: true, action: expect.objectContaining({ kind: 'delete' }) })));
  fireEvent.click(screen.getByRole('button', { name: '导出 HTML' }));
  fireEvent.click(screen.getByRole('button', { name: '导出侧车 JSON' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('export_sidecar', { profileId: 'profile-a' }));
  expect(invoke).toHaveBeenCalledWith('export_html', { profileId: 'profile-a' });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'apply_edit')).toHaveLength(2);
});

it('does not offer browser edits for a read-only file mirror', async () => {
  const mirror = {
    mirrorSourceId: 'mirror-a', displayName: 'Personal', association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'stale' as const, watching: true, nodeCount: 1, revision: 2, lastSyncedAt: null, errorCode: null, canWriteBrowser: false as const,
  };
  render(<LibraryWorkspace state={state([], [mirror])} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByText('中文书签')).toBeVisible();
  expect(screen.queryByRole('button', { name: '预览修改' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /写入|应用/ })).not.toBeInTheDocument();
});
