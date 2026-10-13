import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BookmarkNode, BridgeState } from '@markbridge/protocol';
import { buildB10k } from './b10k';
import { LibraryWorkspace } from './LibraryWorkspace';
import { searchSnapshot } from './model';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

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
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const customQuery = extra?.(command, args);
      if (customQuery !== undefined) return customQuery;
      const legacyArgs = { ...args, ...request };
      const supplied = await extra?.(request.query ? 'cache_search' : 'cache_list', legacyArgs) as { items: BookmarkNode[]; total?: number } | undefined;
      const items = supplied?.items ?? (request.query ? (request.query === 'Alpha' ? [alpha] : []) : request.folderId === '1' ? barItems : [bar, other]);
      const matching = Array.isArray(request.tagIds) && request.tagIds.length ? items.filter((node) => node.chromeId === '10') : items;
      const offset = Number(request.offset);
      const page = matching.slice(offset, offset + Number(request.limit));
      return { items: page, offset, total: matching.length, sourceEpoch: 1, revision: 4, nextOffset: offset + page.length < matching.length ? offset + page.length : null };
    }
    const custom = extra?.(command, args);
    if (custom !== undefined) return custom;
    if (command === 'cache_tree') return { nodes: [root, bar, other, ...barItems] };
    if (command === 'cache_list') return args.folderId === '1' ? { items: barItems, total: barItems.length } : { items: [bar, other], total: 2 };
    if (command === 'cache_count') return args.folderId === '1' ? { folders: 4, bookmarks: 9 } : { folders: 2, bookmarks: 0 };
    if (command === 'cache_get') {
      const found = [root, bar, other, ...barItems].find((item) => item.chromeId === args.chromeId) ?? root;
      return { node: found, ancestors: args.chromeId === '10' || args.chromeId === '11' ? ['根', '栏'] : [] };
    }
    if (command === 'cache_search') return args.query === 'Alpha' ? { items: [alpha] } : { items: [] };
    if (command === 'open_http_url') return null;
    if (command === 'cancel_content_preview') return null;
    if (command === 'content_preview') return {
      requestId: args.requestId, profileId: args.profileId, chromeId: args.chromeId, bookmarkId: 'bookmark-a',
      status: 'cancelled', title: null, summary: null, summarySource: null, image: null,
      imageFailure: null, imageFailureMessage: null, fetchedAt: null, cacheLabel: null, failure: null, failureMessage: null,
    };
    if (command === 'tag_state' || command === 'tag_command') return {
      profileId: typeof args.profileId === 'string' ? args.profileId : 'profile-a',
      encodingEnabled: false, journalId: null, affected: 0, mergeRequired: false,
      sourceTagId: null, targetTagId: null, filterTagId: null, tags: [], entries: [], matches: [],
    };
    if (command === 'list_operations' || command === 'refresh_operations' || command === 'review_operation') return { operations: [] };
    if (command === 'get_mirror_tree') return { mirrorSourceId: 'mirror-a', displayName: 'Personal', fileStatus: 'stale', association: 'independent', revision: 2, lastSyncedAt: null, errorCode: 'INVALID_TREE', canWriteBrowser: false, nodes: [root, { ...firstDup, parentId: '0' }, { ...secondDup, parentId: '0' }] };
    return {};
  });
}

beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true); install(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it('R03 exposes the next page beyond 200 matching results', async () => {
  const many = Array.from({ length: 201 }, (_, index) => node(`hit-${index}`, '1', index, 'bookmark', `needle ${index}`));
  install((command, args) => {
    if (command === 'cache_tree') return { nodes: [root, bar, ...many] };
    if (command === 'cache_search') return { items: many };
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const offset = Number(request.offset);
      const items = many.slice(offset, offset + 200);
      return { items, total: many.length, offset, nextOffset: offset + items.length < many.length ? offset + items.length : null, sourceEpoch: 1, revision: 4 };
    }
    return undefined;
  });
  await shown();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'needle' } });
  const next = await screen.findByRole('button', { name: '加载下一页' });
  fireEvent.click(next);
  await waitFor(() => expect(screen.getByText(/已加载 201/)).toBeVisible());
});

it('R05 preserves local drafts across tabs and closure, and explicitly handles leaving the item', async () => {
  await shown();
  fireEvent.click(screen.getByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(await screen.findByRole('tab', { name: '标签备注' }));
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '保留这个草稿' } });
  fireEvent.click(screen.getByRole('tab', { name: '信息' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭详情，返回列表' }));
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.click(screen.getByRole('tab', { name: '标签备注' }));
  expect(screen.getByLabelText('备注')).toHaveValue('保留这个草稿');
  fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
  expect(screen.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(screen.getByLabelText('备注')).toHaveValue('保留这个草稿');
  expect(screen.getByRole('checkbox', { name: '选择 Alpha' })).toBeChecked();
  fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并继续' }));
  await waitFor(() => expect(screen.getByLabelText('备注')).toHaveValue(''));
  expect(screen.getByRole('checkbox', { name: '选择 Beta' })).toBeChecked();
  expect(invoke).not.toHaveBeenCalledWith('tag_command', expect.anything());
});

it('R05 only fetches content in the visible content tab and cancels when hidden', async () => {
  install((command) => command === 'content_preview' ? new Promise(() => {}) : undefined);
  await shown();
  fireEvent.click(screen.getByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  const content = await screen.findByRole('tab', { name: '内容预览' });
  expect(invoke).not.toHaveBeenCalledWith('content_preview', expect.anything());
  fireEvent.click(content);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('content_preview', expect.objectContaining({ chromeId: '10' })));
  fireEvent.click(screen.getByRole('tab', { name: '信息' }));
  expect(invoke).toHaveBeenCalledWith('cancel_content_preview', expect.anything());
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Beta' }));
  expect(screen.getByRole('region', { name: '共同标签与备注' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: '内容预览' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '预览修改' })).not.toBeInTheDocument();
});

it('R05 guards Ctrl+End pagination and folder Enter before leaving a metadata draft', async () => {
  const many = [alpha, bar, ...Array.from({ length: 200 }, (_, index) => node(`hit-${index}`, '1', index + 2, 'bookmark', `needle ${index}`))];
  install((command) => command === 'cache_search' ? { items: many } : undefined);
  await shown();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'needle' } });
  const first = await screen.findByRole('option', { name: /Alpha/ });
  fireEvent.click(first);
  fireEvent.click(await screen.findByRole('tab', { name: '标签备注' }));
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '分页前草稿' } });
  const reads = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cache_query').length;
  fireEvent.keyDown(first, { key: 'End', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cache_query')).toHaveLength(reads);
  expect(screen.getByLabelText('备注')).toHaveValue('分页前草稿');
  fireEvent.keyDown(screen.getByRole('option', { name: /选择 栏/ }), { key: 'Enter' });
  expect(screen.getByRole('dialog', { name: '放弃未保存的本地草稿？' })).toBeVisible();
  expect(screen.getByLabelText('搜索标题或网址')).toHaveValue('needle');
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(screen.getByLabelText('备注')).toHaveValue('分页前草稿');
});

it('R05 remounts content and cancels its pending read when a source epoch reuses the same node', async () => {
  let epoch = 1;
  install((command) => {
    if (command === 'content_preview') return new Promise(() => {});
    if (command === 'cache_query') return { items: [alpha], offset: 0, total: 1, nextOffset: null, sourceEpoch: epoch, revision: 4 };
    return undefined;
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByLabelText('包含备注'));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Alpha' } });
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(await screen.findByRole('tab', { name: '内容预览' }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'content_preview')).toHaveLength(1));
  epoch = 2;
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A')], [], 2)} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_content_preview', expect.anything()));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'content_preview')).toHaveLength(2));
});

it('R03 discards a late continuation after query A to B to A and restarts on revision conflict', async () => {
  const many = Array.from({ length: 201 }, (_, index) => node(`hit-${index}`, '1', index, 'bookmark', `needle ${index}`));
  let finishOldPage!: (value: unknown) => void;
  let continuations = 0;
  install((command, args) => {
    if (command !== 'cache_query') return undefined;
    const request = argsOf(args.request);
    if (request.query !== 'needle') return { items: [], total: 0, offset: 0, nextOffset: null, sourceEpoch: 1, revision: 4 };
    if (request.offset === 200) {
      continuations += 1;
      return continuations === 1 ? new Promise((resolve) => { finishOldPage = resolve; }) : Promise.reject('CONFLICT');
    }
    return { items: many.slice(0, 200), total: 201, offset: 0, nextOffset: 200, sourceEpoch: 1, revision: 4 };
  });
  await shown();
  const search = screen.getByLabelText('搜索标题或网址');
  fireEvent.change(search, { target: { value: 'needle' } });
  fireEvent.click(await screen.findByRole('button', { name: '加载下一页' }));
  fireEvent.change(search, { target: { value: 'other' } });
  await screen.findByText('没有匹配的标题或网址。');
  fireEvent.change(search, { target: { value: 'needle' } });
  await screen.findByRole('button', { name: '加载下一页' });
  await act(async () => finishOldPage({ items: many.slice(200), total: 201, offset: 200, nextOffset: null, sourceEpoch: 1, revision: 4 }));
  expect(screen.getByText(/已加载 200 \/ 201/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '加载下一页' }));
  expect(await screen.findByText('来源版本已改变，已从第一页重新读取。')).toBeVisible();
  expect(await screen.findByRole('button', { name: '加载下一页' })).toBeEnabled();
  expect(screen.getByText(/已加载 200 \/ 201/)).toBeVisible();
});

it('R03 uses Ctrl and Shift for folder and bookmark selection and clears it on a filter change', async () => {
  install((command, args) => command === 'cache_search' ? { items: [bar, alpha, beta, firstDup] } : command === 'cache_query' && argsOf(args.request).query === 'all' ? { items: [bar, alpha, beta, firstDup], total: 4, offset: 0, nextOffset: null, sourceEpoch: 1, revision: 4 } : undefined);
  await shown();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'all' } });
  const parent = await screen.findByRole('option', { name: /选择 栏/ });
  fireEvent.click(parent, { ctrlKey: true });
  fireEvent.click(screen.getByRole('option', { name: /Beta/ }), { shiftKey: true });
  expect(screen.getByText('已选 3 项', { exact: true })).toBeVisible();
  expect(parent).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(parent, { ctrlKey: true, key: 'a' });
  expect(screen.getByText('已选 4 项', { exact: true })).toBeVisible();
  fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'subtree' } });
  expect(screen.getByText('范围已改变，已清除多选。')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('option', { name: /选择 栏/ })).toHaveAttribute('aria-selected', 'false'));
});

it('R03 refreshes summary search after a confirmed local AI save without a Chrome revision change', async () => {
  let summarySaved = false;
  const matches = Array.from({ length: 201 }, (_, index) => index === 0 ? alpha : node(`summary-${index}`, '1', index, 'bookmark', `Result ${index}`));
  install((command, args) => {
    if (command === 'ai_settings') return { enabled: true, provider: 'ollama', endpointLabel: 'http://127.0.0.1:11434', model: 'fixture', credentialConfigured: false, schemaSupported: true };
    if (command === 'suggest_ai') return {
      jobId: 'ai-job', profileId: 'profile-a', bookmarkId: 'bookmark-a', chromeId: '10', inputFingerprint: 'a'.repeat(64),
      endpointLabel: null, model: null, scope: { includesTitle: true, includesUrl: true, includesCachedText: false, excerptChars: 0 },
      state: 'ready', title: 'Alpha', tags: ['AI 新标签'], summary: 'replacement', suggestedFolder: null, evidence: null, sourceTime: null, failure: null, failureMessage: null,
    };
    if (command === 'apply_ai') {
      summarySaved = true;
      return { jobId: 'ai-job', browser: null, tagsApplied: true, summaryApplied: true, failure: null, failureMessage: null };
    }
    if (command === 'tag_state') return {
      profileId: args.profileId, encodingEnabled: false, journalId: null, affected: 0, mergeRequired: false,
      sourceTagId: null, targetTagId: null, filterTagId: null, tags: summarySaved ? [{ tagId: 'new-tag', name: 'AI 新标签', count: 1 }] : [], entries: [], matches: [],
    };
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      if (request.query !== 'needle') return undefined;
      const items = summarySaved ? matches.slice(1) : matches;
      const offset = Number(request.offset);
      const page = items.slice(offset, offset + 200);
      return { items: page, total: items.length, offset, nextOffset: offset + page.length < items.length ? offset + page.length : null, sourceEpoch: 1, revision: 4 };
    }
    return undefined;
  });
  const workspaceState = state([profile('profile-a', '资料 A')]);
  const view = render(<LibraryWorkspace state={workspaceState} invalid={false} native focusMirrorId={null} />);
  await screen.findByRole('treeitem', { name: /栏/ });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByText('更多搜索范围'));
  fireEvent.click(screen.getByLabelText('包含摘要'));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'needle' } });
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  expect(screen.getByText(/已加载 200 \/ 201/)).toBeVisible();
  view.rerender(<LibraryWorkspace state={workspaceState} invalid={false} native focusMirrorId={null} section="organize" />);
  fireEvent.click(await screen.findByRole('tab', { name: '单条建议' }));
  fireEvent.click(await screen.findByRole('button', { name: '生成建议' }));
  fireEvent.click(await screen.findByLabelText('保存摘要'));
  fireEvent.click(screen.getByLabelText('保存标签'));
  fireEvent.click(screen.getByRole('button', { name: '确认这条建议' }));
  await screen.findByText('本地标签或摘要已保存。');
  view.rerender(<LibraryWorkspace state={workspaceState} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.getByText(/已加载 200 \/ 200/)).toBeVisible());
  expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '加载下一页' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('标签', { selector: '#library-tag' })).toHaveTextContent('AI 新标签'));
  expect(screen.getByLabelText('按标签筛选')).toHaveTextContent('AI 新标签');
});

it('R03 resets a deleted mirror directory and removes its stale active item', async () => {
  const mirror = {
    mirrorSourceId: 'mirror-a', displayName: 'Personal', association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'current' as const, watching: true, nodeCount: 4, revision: 2, lastSyncedAt: null, errorCode: null, canWriteBrowser: false as const,
  };
  let mirrorTree = [root, bar, other, alpha];
  install((command) => command === 'get_mirror_tree' ? {
    mirrorSourceId: mirror.mirrorSourceId, displayName: mirror.displayName, association: mirror.association,
    fileStatus: mirror.fileStatus, revision: mirror.revision, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: mirrorTree,
  } : undefined);
  const view = render(<LibraryWorkspace state={state([], [mirror])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(screen.getByRole('button', { name: '关闭详情，返回列表' }));
  mirrorTree = [root, other];
  view.rerender(<LibraryWorkspace state={state([], [{ ...mirror, revision: 3, nodeCount: 2 }])} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.queryByRole('treeitem', { name: /栏/ })).not.toBeInTheDocument());
  expect(await screen.findByRole('option', { name: /其他/ })).toBeVisible();
  expect(screen.getByRole('treeitem', { name: /根/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText('已选 1 项', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
});

it('R03 invalidates the current note filter when it changes during a pending local save', async () => {
  let saved = false;
  let finishSave!: (value: unknown) => void;
  install((command, args) => {
    if (command === 'tag_command') return new Promise((resolve) => { finishSave = resolve; });
    if (command !== 'cache_query' || argsOf(args.request).query !== 'needle') return undefined;
    const items = saved ? [] : [alpha];
    return { items, total: items.length, offset: 0, nextOffset: null, sourceEpoch: 1, revision: 4 };
  });
  await shown();
  fireEvent.click(screen.getByRole('treeitem', { name: /栏/ }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(screen.getByRole('tab', { name: '标签备注' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(finishSave).toBeDefined());
  fireEvent.click(screen.getByText('更多搜索范围'));
  fireEvent.click(screen.getByLabelText('包含备注'));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'needle' } });
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();
  saved = true;
  await act(async () => finishSave({
    profileId: 'profile-a', encodingEnabled: false, journalId: null, affected: 1, mergeRequired: false,
    sourceTagId: null, targetTagId: null, filterTagId: null, tags: [], entries: [], matches: [],
  }));
  await waitFor(() => expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument());
  expect(screen.getByText(/已加载 0 \/ 0/)).toBeVisible();
});

it('R03 refreshes sidecar queries after a receipt publication without resetting ordinary search or note drafts', async () => {
  let saved = false;
  let chromeRevision = 4;
  install((command, args) => {
    if (command !== 'cache_query' || argsOf(args.request).query !== 'needle') return undefined;
    const items = saved ? [] : [alpha];
    return { items, total: items.length, offset: 0, nextOffset: null, sourceEpoch: 1, revision: chromeRevision };
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  await screen.findByRole('treeitem', { name: /栏/ });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByText('更多搜索范围'));
  fireEvent.click(screen.getByLabelText('包含备注'));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'needle' } });
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(screen.getByRole('tab', { name: '标签备注' }));
  fireEvent.change(await screen.findByLabelText('备注'), { target: { value: '未保存的备注草稿' } });
  chromeRevision = 5;
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', chromeRevision)], [], 2)} invalid={false} native focusMirrorId={null} />);
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();
  fireEvent.click(screen.getByRole('option', { name: /Alpha/ }), { ctrlKey: true });
  expect(screen.getByText('已选 1 项', { exact: true })).toBeVisible();
  saved = true;
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', chromeRevision)], [], 3)} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument());
  expect(screen.getByText('范围已改变，已清除多选。')).toBeVisible();
  expect(screen.getByLabelText('备注')).toHaveValue('未保存的备注草稿');
  fireEvent.click(screen.getByLabelText('包含备注'));
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并继续' }));
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Alpha' } });
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();
  const reads = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cache_query').length;
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', chromeRevision)], [], 4)} invalid={false} native focusMirrorId={null} />);
  await act(async () => {});
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cache_query')).toHaveLength(reads);
  expect(screen.getByLabelText('备注')).toHaveValue('');
});

it('R03 resets mirror scroll and active descendant when search replaces a fully loaded page', async () => {
  const items = Array.from({ length: 10001 }, (_, index) => node(`mirror-${index}`, '1', index, 'bookmark', `Mirror match ${index}`));
  const mirror = {
    mirrorSourceId: 'mirror-a', displayName: 'Personal', association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'current' as const, watching: true, nodeCount: items.length + 2, revision: 2, lastSyncedAt: null, errorCode: null, canWriteBrowser: false as const,
  };
  install((command) => command === 'get_mirror_tree' ? {
    mirrorSourceId: mirror.mirrorSourceId, displayName: mirror.displayName, association: mirror.association,
    fileStatus: mirror.fileStatus, revision: mirror.revision, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: [root, bar, ...items],
  } : undefined);
  render(<LibraryWorkspace state={state([], [mirror])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  const first = await screen.findByRole('option', { name: /Mirror match 0example/ });
  first.focus();
  fireEvent.keyDown(first, { key: 'End', ctrlKey: true });
  expect(await screen.findByRole('option', { name: /Mirror match 10000/ })).toBeVisible();
  const list = screen.getByRole('listbox', { name: '书签列表' });
  expect(list.scrollTop).toBeGreaterThan(10000);
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Mirror match' } });
  expect(await screen.findByRole('option', { name: /Mirror match 0example/ })).toBeVisible();
  expect(screen.getByRole('listbox', { name: '搜索结果' }).scrollTop).toBe(0);
  expect(screen.getByRole('listbox', { name: '搜索结果' })).not.toHaveAttribute('aria-activedescendant');
  const searchList = screen.getByRole('listbox', { name: '搜索结果' });
  fireEvent.scroll(searchList, { target: { scrollTop: 5200 } });
  expect(searchList.scrollTop).toBe(5200);
  fireEvent.click(screen.getByRole('button', { name: '加载下一页' }));
  expect(searchList.scrollTop).toBe(5200);
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Mirror' } });
  expect(screen.getByRole('listbox', { name: '搜索结果' }).scrollTop).toBe(0);
  expect(screen.getByRole('option', { name: /Mirror match 0example/ })).toBeVisible();
});

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
  expect(screen.getAllByText('example.com')).toHaveLength(3);
  expect(searchSnapshot(barItems, 'https://example.com/dup', 10)).toHaveLength(2);
  expect(screen.getByText(longTitle)).toHaveClass('library-title');
  expect(screen.getByText(/已加载 4 \/ 4 项/)).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('cache_tree', { profileId: 'profile-a', folderId: null, depth: 0 });
  expect(invoke).toHaveBeenCalledWith('cache_query', { profileId: 'profile-a', request: expect.objectContaining({ folderId: '1', offset: 0, limit: 200 }) });
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
  expect(barRow).toHaveAttribute('aria-level', '2');
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
  await screen.findByRole('treeitem', { name: '目录-profile-a' });
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
  expect(await screen.findByRole('treeitem', { name: '目录-profile-a' })).toBeVisible();
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

it('queries immediately without a debounce and intersects rather than overriding text', async () => {
  await shown();
  const input = screen.getByLabelText('搜索标题或网址');
  fireEvent.change(input, { target: { value: 'Alpha' } });
  expect(input).toBeEnabled();
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('cache_query', { profileId: 'profile-a', request: expect.objectContaining({ query: 'Alpha', folderScope: 'all', limit: 200 }) });
  expect(screen.getByText(/已加载 1 \/ 1 项/)).toBeVisible();
  fireEvent.change(input, { target: { value: 'ALPHA' } });
  expect(await screen.findByText('没有匹配的标题或网址。')).toBeVisible();
});

it('finds a bookmark outside the open folder through the complete cache query', async () => {
  const hidden = node('99', '2', 0, 'bookmark', 'MB05MARK', 'https://example.com/mb05-mark');
  install((command) => command === 'cache_search' ? { items: [hidden] } : undefined);
  await shown();
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'MB05MARK' } });
  expect(await screen.findByRole('option', { name: /MB05MARK/ })).toBeVisible();
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
  expect(screen.getAllByText('example.com').length).toBeGreaterThan(1);
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
  expect(screen.getByRole('option', { name: /项1example/ })).toHaveFocus();
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
  expect(screen.getByText(/已加载 3 \/ 3 项/)).toBeVisible();
  fireEvent.click(screen.getByRole('treeitem', { name: /MB05BAR/ }));
  expect(screen.getAllByText('中文文件夹').some((element) => element.closest('[role=option]'))).toBe(true);
  const search = screen.getByLabelText('搜索标题或网址');
  function commit(value: string) {
    fireEvent.change(search, { target: { value } });
  }
  commit('MB05DEEP');
  fireEvent.click(screen.getByRole('option', { name: /MB05DEEP/ }));
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(screen.getByRole('list', { name: '所在路径' }).querySelectorAll('li')).toHaveLength(20);
  expect(screen.getByText('文件夹', { selector: 'dd' })).toBeVisible();
  await commit('MB05MARK');
  const marker = screen.getByRole('option', { name: /MB05MARK/ });
  fireEvent.click(marker);
  expect(screen.getByText('b4')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '在浏览器中打开' })).toBeEnabled();
  await commit('https://example.com/dup');
  expect(screen.getByText(/已加载 200 \/ 1000 项/)).toBeVisible();
  expect(screen.getByRole('button', { name: '加载下一页' })).toBeVisible();
  const duplicateIds = [...screen.getByRole('listbox', { name: '搜索结果' }).querySelectorAll('[role=option]')].map((row) => row.id);
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
    if (command === 'save_export') return { status: 'cancelled', metadata: null, errorCode: null };
    return undefined;
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
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
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} section="export" />);
  fireEvent.click(screen.getByRole('button', { name: '导出 HTML' }));
  await screen.findByText('已取消保存，没有生成文件。');
  fireEvent.click(screen.getByRole('button', { name: '导出侧车 JSON' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_export', { source: { kind: 'profile', id: 'profile-a' }, format: 'sidecar' }));
  expect(invoke).toHaveBeenCalledWith('save_export', { source: { kind: 'profile', id: 'profile-a' }, format: 'html' });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'apply_edit')).toHaveLength(2);
});

function operation(state: 'applying' | 'applied') {
  return { operationId: 'op-applied', state, affected: 1, errorCode: null, conflicts: [] };
}

it('shows a confirmed receipt after confirm when the operation list reaches applied', async () => {
  let listed: 'before' | 'after' = 'before';
  install((command) => {
    if (command === 'preview_edit') return editPreview();
    if (command === 'apply_edit') return { operationId: 'op-applied', state: 'applying', errorCode: null, conflicts: [] };
    if (command === 'list_operations') return { operations: listed === 'after' ? [operation('applied')] : [] };
    return undefined;
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  const title = await screen.findByLabelText('新标题');
  fireEvent.change(title, { target: { value: '根 2' } });
  fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认变更' }));
  expect(await screen.findByText(/等待回执/)).toBeVisible();
  listed = 'after';
  await waitFor(() => expect(screen.getByText('回执已确认。')).toBeVisible(), { timeout: 2500 });
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 5)])} invalid={false} native focusMirrorId={null} />);
  expect(screen.getByText('回执已确认。')).toBeVisible();
  expect(screen.queryByRole('dialog', { name: '确认变更' })).not.toBeInTheDocument();
});

it('keeps a confirmed receipt when apply returns applied and the revision changes', async () => {
  install((command) => {
    if (command === 'preview_edit') return editPreview();
    if (command === 'apply_edit') return { operationId: 'op-applied', state: 'applied', errorCode: null, conflicts: [] };
    if (command === 'list_operations') return { operations: [operation('applied')] };
    return undefined;
  });
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  const title = await screen.findByLabelText('新标题');
  fireEvent.change(title, { target: { value: '根 2' } });
  fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认变更' }));
  expect(await screen.findByText('回执已确认。')).toBeVisible();
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 5)])} invalid={false} native focusMirrorId={null} />);
  expect(screen.getByText('回执已确认。')).toBeVisible();
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

it('keeps history readable offline and requires live confirmation for undo', async () => {
  install((command) => {
    if (command === 'list_operations') return { operations: [operation('applied')] };
    if (command === 'preview_undo') return { profileId: 'profile-a', operationId: 'op-applied', sourceEpoch: 1, expectedRevision: 4, writable: true, affected: 1, errorCode: null, conflicts: [], steps: [{ requestId: 'undo-step', target: '10', expectedBefore: alpha, payload: { kind: 'update', title: '恢复标题' } }] };
    if (command === 'apply_edit') return { operationId: 'op-undo', state: 'rolled_back', errorCode: null, conflicts: [] };
    return undefined;
  });
  const history = (connection: 'live' | 'cached_read_only') => <LibraryWorkspace state={state([profile('profile-a', '资料 A', 4, connection)])} invalid={false} native focusMirrorId={null} section="history" />;
  const view = render(history('cached_read_only'));
  expect(await screen.findByText('已完成')).toBeVisible();
  expect(screen.getByRole('button', { name: '撤销此记录' })).toBeDisabled();
  view.rerender(history('live'));
  fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
  expect(await screen.findByRole('region', { name: '撤销预览' })).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('preview_undo', { profileId: 'profile-a', expectedRevision: 4, operationId: 'op-applied' });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_edit')).toBe(false);
  view.rerender(history('cached_read_only'));
  expect(screen.getByRole('button', { name: '确认条件撤销' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '确认条件撤销' }));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_edit')).toBe(false);
  view.rerender(history('live'));
  fireEvent.click(screen.getByRole('button', { name: '确认条件撤销' }));
  expect(await screen.findByText('撤销回执已确认。')).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('apply_edit', { profileId: 'profile-a', expectedRevision: 4, action: { kind: 'undo', operationId: 'op-applied' }, secondConfirm: false });
});

it('keeps current detail input until source-switch discard, including requests from settings', async () => {
  const profiles = [profile('profile-a', '资料 A'), profile('profile-b', '资料 B')];
  install((command, args) => {
    if (args.profileId === 'profile-b' && command === 'cache_get' && args.chromeId === '10') return { node: { ...alpha, title: 'B 的同 ID 书签' }, ancestors: ['B 的目录'] };
    if (args.profileId === 'profile-b' && command === 'cache_list' && args.folderId === '1') return { items: [{ ...alpha, title: 'B 的同 ID 书签' }], total: 1 };
  });
  const view = render(<LibraryWorkspace state={state(profiles)} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  await waitFor(() => expect(screen.getByLabelText('新标题')).toHaveValue('Alpha'));
  fireEvent.change(screen.getByLabelText('新标题'), { target: { value: 'A 的未确认输入' } });
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  expect(screen.getByRole('dialog', { name: '切换书签来源？' })).toBeVisible();
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:profile-a');
  fireEvent.click(screen.getByRole('button', { name: '留在当前页面' }));
  expect(screen.getByLabelText('新标题')).toHaveValue('A 的未确认输入');
  view.rerender(<LibraryWorkspace state={state(profiles)} invalid={false} native focusMirrorId={null} sourceRequest={{ kind: 'profile', id: 'profile-b', request: 1 }} />);
  expect(screen.getByRole('dialog', { name: '切换书签来源？' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清除当前输入并切换' }));
  expect(screen.getByLabelText('书签来源')).toHaveValue('profile:profile-b');
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /B 的同 ID 书签/ }));
  await waitFor(() => expect(screen.getByLabelText('新标题')).toHaveValue('B 的同 ID 书签'));
  expect(screen.queryByDisplayValue('A 的未确认输入')).not.toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'apply_edit')).toHaveLength(0);
});

it('ignores an old catalog command after switching away and back to the same profile', async () => {
  let finishOldCommand!: (value: unknown) => void;
  const catalog = {
    profileId: 'profile-a', encodingEnabled: false, journalId: null, affected: 0, mergeRequired: false,
    sourceTagId: null, targetTagId: null, filterTagId: null,
    tags: [{ tagId: 'tag-work', name: 'Work', count: 1 }], entries: [], matches: [],
  };
  install((command, args) => {
    if (command === 'tag_command') return new Promise((resolve) => { finishOldCommand = resolve; });
    if (command === 'tag_state') return { ...catalog, profileId: args.profileId, filterTagId: args.filterTagId ?? null, matches: args.filterTagId ? [alpha] : [] };
  });
  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A'), profile('profile-b', '资料 B')])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.click(screen.getByRole('tab', { name: '标签备注' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(finishOldCommand).toBeDefined());
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  await screen.findByRole('treeitem', { name: /栏/ });
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-a' } });
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  fireEvent.change(await screen.findByLabelText('按标签筛选'), { target: { value: 'tag-work' } });
  await waitFor(() => {
    expect(screen.getByRole('listbox', { name: '标签筛选' })).toHaveTextContent('Alpha');
    expect(screen.getByRole('listbox', { name: '标签筛选' })).not.toHaveTextContent('Beta');
  });
  await act(async () => { finishOldCommand({ ...catalog, matches: [beta] }); });
  expect(screen.getByRole('listbox', { name: '标签筛选' })).toHaveTextContent('Alpha');
  expect(screen.getByRole('listbox', { name: '标签筛选' })).not.toHaveTextContent('Beta');
});
