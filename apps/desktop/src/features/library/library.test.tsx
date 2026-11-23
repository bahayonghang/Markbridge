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
  return { protocolVersion: 1, revision, port: 49153, errorCode: null, profiles, mirrors };
}

function profile(id: string, name: string, revision = 4, connection: BridgeState['profiles'][number]['connection'] = 'live'): BridgeState['profiles'][number] {
  return { profileId: id, instanceId: `instance-${id}`, displayName: name, connection, writePaused: false, ignored: false, nodeCount: 4, revision, lastSyncedAt: null, errorCode: null };
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
  const generate = await screen.findByRole('button', { name: '生成建议' });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
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
  expect(document.querySelector('.library-list-meta')?.textContent).not.toContain('·');
  expect(document.querySelector('.library-status')).toBeNull();
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

it('blocks browser writes and shows writePaused notice while keeping local tags and notes editable', async () => {
  const paused = { ...profile('profile-a', '资料 A', 4, 'live'), writePaused: true, ignored: false };
  render(<LibraryWorkspace state={state([paused])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  expect(screen.getAllByText(/已暂停写入（只读保护）/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByRole('button', { name: '新建' })).toBeDisabled();
  const alphaRow = await screen.findByRole('option', { name: /Alpha/ });
  expect(alphaRow).toHaveAttribute('draggable', 'false');
  fireEvent.keyDown(alphaRow, { key: 'ArrowDown', altKey: true });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Alpha' }));
  expect(screen.getByRole('button', { name: '移动所选' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(await screen.findByRole('button', { name: '预览修改' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '移动' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '预览删除' })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: '标签备注' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存备注' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '暂停写入时可编辑的备注' } });
  fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: { kind: 'set_note', chromeIds: ['10'], note: '暂停写入时可编辑的备注' },
  })));
  const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(commands).not.toContain('preview_edit');
  expect(commands).not.toContain('apply_edit');
  expect(commands).not.toContain('preview_batch_edit');
  expect(commands).not.toContain('apply_batch_edit');
  expect(commands).not.toContain('apply_title_encoding');
});

it('unifies detail tabs with segmented-control, groups controls in well-groups, uses output-well previews, and limits primary buttons', async () => {
  install((command) => {
    if (command === 'preview_edit') return editPreview();
    return undefined;
  });
  const { container } = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Alpha/ }));
  const detailPane = container.querySelector('.detail-pane')!;
  expect(detailPane.querySelector('.detail-tabs .segmented-control[role="tablist"]')).not.toBeNull();
  expect(detailPane.querySelectorAll('.well-group').length).toBeGreaterThanOrEqual(2);
  expect(detailPane.querySelectorAll('#detail-panel-info .primary-button, .edit-desk .primary-button')).toHaveLength(1);
  fireEvent.change(await screen.findByLabelText('新标题'), { target: { value: 'Alpha 2' } });
  fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  const dialog = await screen.findByRole('dialog', { name: '确认变更' });
  expect(dialog).toHaveClass('output-well');
  expect(detailPane.querySelectorAll('.edit-desk button.primary-button')).toHaveLength(1);
});

it('T2-S1 renders 4-segment tree rows with isolated 24x24 chevron buttons and preserves active context', async () => {
  const branch = node('1', '0', 0, 'folder', '分支');
  const leaf = node('3', '1', 0, 'folder', '子叶');
  const gamma = node('20', '2', 0, 'bookmark', 'Gamma', 'https://example.com/gamma');
  const treeNodes = [root, branch, leaf, other, alpha, gamma];
  install((command, args) => {
    if (command === 'cache_tree') return { nodes: treeNodes };
    if (command === 'tag_state') return {
      profileId: args.profileId, encodingEnabled: false, journalId: null, affected: 0, mergeRequired: false,
      sourceTagId: null, targetTagId: null, filterTagId: null,
      tags: [{ tagId: 'tag-1', name: '待读', count: 1 }], entries: [], matches: [],
    };
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const q = String(request.query ?? '');
      const tagIds = Array.isArray(request.tagIds) ? request.tagIds : [];
      let items = request.folderScope === 'all' || q || tagIds.length
        ? [alpha, gamma]
        : request.folderId === '2' ? [gamma] : request.folderId === '1' ? [leaf, alpha] : [branch, other];
      if (q) items = items.filter((item) => item.title.includes(q));
      if (tagIds.length) items = items.filter((item) => item.chromeId === '20');
      return { items, offset: 0, total: items.length, sourceEpoch: 1, revision: 4, nextOffset: null };
    }
    return undefined;
  });

  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);

  const rootItem = await screen.findByRole('treeitem', { name: '根' });
  const branchItem = screen.getByRole('treeitem', { name: '分支' });
  const otherItem = screen.getByRole('treeitem', { name: '其他' });

  expect(rootItem.querySelector('.tree-chevron')).not.toBeNull();
  expect(rootItem.querySelector('.tree-chevron')?.getAttribute('tabindex')).toBe('-1');
  expect(rootItem.querySelector('.tree-chevron')).toHaveAttribute('aria-label', '收起 根');
  expect(rootItem.querySelector('.tree-chevron')).toHaveAttribute('aria-expanded', 'true');
  expect(branchItem.querySelector('.tree-chevron')).toHaveAttribute('aria-label', '展开 分支');
  expect(branchItem.querySelector('.tree-chevron')).toHaveAttribute('aria-expanded', 'false');
  expect(otherItem.querySelector('.tree-chevron')).toBeNull();
  expect(otherItem.querySelector('.tree-chevron-spacer')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('treeitem', { name: '子叶' })).not.toBeInTheDocument();

  fireEvent.click(otherItem);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByText('更多搜索范围'));
  fireEvent.click(screen.getByLabelText('包含摘要'));
  fireEvent.click(screen.getByLabelText('包含备注'));
  await waitFor(() => expect(screen.getByLabelText('标签', { selector: '#library-tag' })).toHaveTextContent('待读'));
  fireEvent.change(screen.getByLabelText('标签', { selector: '#library-tag' }), { target: { value: 'tag-1' } });
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Gamma' } });

  const gammaCheckbox = await screen.findByRole('checkbox', { name: '选择 Gamma' });
  fireEvent.click(gammaCheckbox);
  expect(gammaCheckbox).toBeChecked();

  const branchChevron = branchItem.querySelector('button.tree-chevron') as HTMLButtonElement;
  branchChevron.focus();
  fireEvent.click(branchChevron);

  expect(await screen.findByRole('treeitem', { name: '子叶' })).toBeVisible();
  const leafItem = screen.getByRole('treeitem', { name: '子叶' });
  expect(leafItem.querySelector('.tree-chevron')).toBeNull();
  expect(leafItem.querySelector('.tree-chevron-spacer')).toHaveAttribute('aria-hidden', 'true');
  expect(branchChevron).toHaveAttribute('aria-expanded', 'true');
  expect(branchChevron).toHaveAttribute('aria-label', '收起 分支');
  expect(branchChevron).toHaveFocus();

  expect(otherItem).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('搜索标题或网址')).toHaveValue('Gamma');
  expect(screen.getByLabelText('标签', { selector: '#library-tag' })).toHaveValue('tag-1');
  expect(screen.getByLabelText('包含摘要')).toBeChecked();
  expect(screen.getByLabelText('包含备注')).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '选择 Gamma' })).toBeChecked();

  fireEvent.keyDown(branchChevron, { key: 'Enter' });
  expect(otherItem).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('搜索标题或网址')).toHaveValue('Gamma');
});

it('T2-S2 decouples single-click selection from double-click toggle and expands ancestors on deep navigation', async () => {
  const branch = node('1', '0', 0, 'folder', '分支');
  const sub = node('3', '1', 0, 'folder', '深枝');
  const deepLeaf = node('4', '3', 0, 'folder', '最深叶');
  const deepBm = node('30', '3', 1, 'bookmark', 'DeepMark', 'https://example.com/deep');
  const treeNodes = [root, branch, sub, deepLeaf, other, alpha, deepBm];
  install((command, args) => {
    if (command === 'cache_tree') return { nodes: treeNodes };
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const items = request.folderId === '3'
        ? [deepLeaf, deepBm]
        : request.folderId === '1'
          ? [sub, alpha]
          : request.folderId === '2'
            ? []
            : [branch, other];
      return { items, offset: 0, total: items.length, sourceEpoch: 1, revision: 4, nextOffset: null };
    }
    if (command === 'semantic_status') {
      return {
        settings: { enabled: true, endpointLabel: 'http://127.0.0.1:11434', model: 'fixture-embed', inputRecipeVersion: 1, maxInputChars: 8192, maxInputBytes: 32768 },
        index: { indexId: 'idx-1', profileId: 'profile-a', sourceEpoch: 1, generation: 1, phase: 'ready', model: 'fixture-embed', digest: 'a'.repeat(64), dimension: 768, total: 1, ready: 1, pending: 0, storedBytes: 3072, failure: null, failureMessage: null },
      };
    }
    if (command === 'semantic_query') {
      const q = argsOf(args.query);
      return {
        requestId: q.requestId, profileId: q.profileId, sourceEpoch: q.sourceEpoch, indexId: q.indexId, generation: q.generation,
        hits: [{ bookmarkId: 'bm-30', chromeId: '30', title: 'DeepMark', score: 0.91 }],
        failure: null, failureMessage: null,
      };
    }
    return undefined;
  });

  const onLibrary = vi.fn();
  const wsState = state([profile('profile-a', '资料 A')]);
  const view = render(<LibraryWorkspace state={wsState} invalid={false} native focusMirrorId={null} section="library" onLibrary={onLibrary} />);

  const branchItem = await screen.findByRole('treeitem', { name: '分支' });
  expect(branchItem).toHaveAttribute('aria-expanded', 'false');

  // Single-clicking row selects without expanding
  fireEvent.click(branchItem);
  expect(branchItem).toHaveAttribute('aria-selected', 'true');
  expect(branchItem).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('treeitem', { name: '深枝' })).not.toBeInTheDocument();
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();

  // Double-clicking row toggles expand and collapse
  fireEvent.dblClick(branchItem);
  expect(await screen.findByRole('treeitem', { name: '深枝' })).toBeVisible();
  expect(branchItem).toHaveAttribute('aria-expanded', 'true');

  // Double-clicking chevron stops propagation so row does not toggle twice
  const branchChevron = branchItem.querySelector('button.tree-chevron') as HTMLButtonElement;
  fireEvent.dblClick(branchChevron);
  expect(branchItem).toHaveAttribute('aria-expanded', 'true');

  fireEvent.dblClick(branchItem);
  expect(branchItem).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('treeitem', { name: '深枝' })).not.toBeInTheDocument();

  // Double-clicking a folder inside the bookmark list expands ancestors only (not target itself)
  const rootItem = screen.getByRole('treeitem', { name: '根' });
  fireEvent.click(rootItem);
  fireEvent.click(rootItem.querySelector('button.tree-chevron')!);
  expect(screen.queryByRole('treeitem', { name: '分支' })).not.toBeInTheDocument();
  const listBranchOption = await screen.findByRole('option', { name: /分支/ });
  fireEvent.dblClick(listBranchOption);
  const reappearedBranch = await screen.findByRole('treeitem', { name: '分支' });
  expect(rootItem).toHaveAttribute('aria-expanded', 'true');
  expect(reappearedBranch).toHaveAttribute('aria-expanded', 'false');
  expect(reappearedBranch).toHaveAttribute('aria-selected', 'true');

  // Breadcrumb navigation expands ancestors only
  const listSubOption = await screen.findByRole('option', { name: /深枝/ });
  fireEvent.dblClick(listSubOption);
  expect(await screen.findByRole('treeitem', { name: '深枝' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('treeitem', { name: '分支' }).querySelector('button.tree-chevron')!);
  fireEvent.click(rootItem.querySelector('button.tree-chevron')!);
  expect(screen.queryByRole('treeitem', { name: '深枝' })).not.toBeInTheDocument();
  const crumbs = screen.getByRole('navigation', { name: '当前目录' });
  fireEvent.click(crumbs.querySelectorAll('button')[3]!); // 深枝
  expect(await screen.findByRole('treeitem', { name: '深枝' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('treeitem', { name: '深枝' })).toHaveAttribute('aria-expanded', 'false');

  // Semantic jump expands ancestors including node.parentId
  fireEvent.click(rootItem.querySelector('button.tree-chevron')!);
  expect(screen.queryByRole('treeitem', { name: '深枝' })).not.toBeInTheDocument();
  view.rerender(<LibraryWorkspace state={wsState} invalid={false} native focusMirrorId={null} section="semantic" onLibrary={onLibrary} />);
  await screen.findByRole('button', { name: '查询语义索引' });
  fireEvent.change(screen.getByLabelText('描述想找的内容'), { target: { value: 'deep' } });
  fireEvent.click(screen.getByRole('button', { name: '查询语义索引' }));
  const hitButton = await screen.findByRole('button', { name: /DeepMark.*相似度/ });
  fireEvent.click(hitButton);
  expect(onLibrary).toHaveBeenCalled();
  view.rerender(<LibraryWorkspace state={wsState} invalid={false} native focusMirrorId={null} section="library" onLibrary={onLibrary} />);
  expect(await screen.findByRole('treeitem', { name: '深枝' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('treeitem', { name: '最深叶' })).toBeVisible();
});

it('T2-S3 prevents Tab focus from changing folder or filters and preserves WAI-ARIA tree keys', async () => {
  const branch = node('1', '0', 0, 'folder', '分支');
  const leaf = node('3', '1', 0, 'folder', '子叶');
  const treeNodes = [root, branch, leaf, other, alpha];
  install((command, args) => {
    if (command === 'cache_tree') return { nodes: treeNodes };
    if (command === 'tag_state') return {
      profileId: args.profileId, encodingEnabled: false, journalId: null, affected: 0, mergeRequired: false,
      sourceTagId: null, targetTagId: null, filterTagId: null,
      tags: [{ tagId: 'tag-1', name: '待读', count: 1 }], entries: [], matches: [],
    };
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const q = String(request.query ?? '');
      const tagIds = Array.isArray(request.tagIds) ? request.tagIds : [];
      let items = q || tagIds.length ? [alpha] : request.folderId === '1' ? [leaf, alpha] : request.folderId === '3' ? [] : [branch, other];
      if (q) items = items.filter((item) => item.title.includes(q));
      return { items, offset: 0, total: items.length, sourceEpoch: 1, revision: 4, nextOffset: null };
    }
    return undefined;
  });

  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);

  const branchItem = await screen.findByRole('treeitem', { name: '分支' });
  fireEvent.click(branchItem);
  expect(branchItem).toHaveAttribute('aria-selected', 'true');

  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  await waitFor(() => expect(screen.getByLabelText('标签', { selector: '#library-tag' })).toHaveTextContent('待读'));
  fireEvent.change(screen.getByLabelText('标签', { selector: '#library-tag' }), { target: { value: 'tag-1' } });
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Alpha' } });

  const rootItem = screen.getByRole('treeitem', { name: '根' });
  fireEvent.click(rootItem.querySelector('button.tree-chevron')!);
  expect(screen.queryByRole('treeitem', { name: '分支' })).not.toBeInTheDocument();
  expect(rootItem).toHaveAttribute('tabindex', '0');

  // Simulate Tab focusing into the tree
  act(() => { rootItem.focus(); });
  expect(rootItem).toHaveFocus();
  expect(rootItem).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByLabelText('搜索标题或网址')).toHaveValue('Alpha');
  expect(screen.getByLabelText('标签', { selector: '#library-tag' })).toHaveValue('tag-1');

  // Standard WAI-ARIA tree keys
  fireEvent.keyDown(rootItem, { key: 'ArrowRight' });
  const expandedBranch = await screen.findByRole('treeitem', { name: '分支' });
  expect(rootItem).toHaveAttribute('aria-expanded', 'true');
  expect(rootItem).toHaveFocus();
  expect(expandedBranch).toHaveAttribute('aria-selected', 'true');

  fireEvent.keyDown(rootItem, { key: 'ArrowDown' });
  expect(expandedBranch).toHaveFocus();
  expect(expandedBranch).toHaveAttribute('aria-selected', 'true');
  expect(expandedBranch).toHaveAttribute('aria-expanded', 'false');

  fireEvent.keyDown(expandedBranch, { key: 'ArrowRight' });
  const leafItem = await screen.findByRole('treeitem', { name: '子叶' });
  expect(expandedBranch).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(expandedBranch, { key: 'ArrowRight' });
  expect(leafItem).toHaveFocus();
  expect(leafItem).toHaveAttribute('aria-selected', 'true');

  fireEvent.keyDown(leafItem, { key: 'ArrowLeft' });
  expect(expandedBranch).toHaveFocus();
  expect(expandedBranch).toHaveAttribute('aria-selected', 'true');

  fireEvent.keyDown(expandedBranch, { key: 'ArrowLeft' });
  expect(expandedBranch).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('treeitem', { name: '子叶' })).not.toBeInTheDocument();

  fireEvent.keyDown(expandedBranch, { key: 'End' });
  const otherItem = screen.getByRole('treeitem', { name: '其他' });
  expect(otherItem).toHaveFocus();
  expect(otherItem).toHaveAttribute('aria-selected', 'true');

  fireEvent.keyDown(otherItem, { key: 'Home' });
  expect(rootItem).toHaveFocus();
  expect(rootItem).toHaveAttribute('aria-selected', 'true');

  fireEvent.keyDown(rootItem, { key: 'ArrowDown' });
  expect(expandedBranch).toHaveFocus();
  fireEvent.keyDown(expandedBranch, { key: 'Enter' });
  expect(expandedBranch).toHaveAttribute('aria-selected', 'true');
  expect(expandedBranch).toHaveAttribute('aria-expanded', 'false');
});

it('T2-S4a provides smart header expand-all / collapse-all toggle without resetting active context', async () => {
  const branch = node('1', '0', 0, 'folder', '分支');
  const leaf = node('3', '1', 0, 'folder', '子叶');
  const loneRoot = node('2', null, 1, 'folder', '独立根');
  const flatOnly = [node('100', null, 0, 'folder', '平级甲'), node('101', null, 1, 'folder', '平级乙')];
  const currentNodes = [root, branch, leaf, loneRoot, alpha];
  install((command, args) => {
    if (command === 'cache_tree') {
      return { nodes: args.profileId === 'profile-flat' ? flatOnly : currentNodes };
    }
    if (command === 'cache_query') {
      const request = argsOf(args.request);
      const q = String(request.query ?? '');
      const items = q ? [alpha] : request.folderId === '1' ? [leaf, alpha] : [branch];
      return { items, offset: 0, total: items.length, sourceEpoch: 1, revision: 4, nextOffset: null };
    }
    return undefined;
  });

  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A'), profile('profile-flat', '纯平级')])} invalid={false} native focusMirrorId={null} />);

  const branchItem = await screen.findByRole('treeitem', { name: '分支' });
  fireEvent.click(branchItem);
  fireEvent.change(screen.getByLabelText('搜索标题或网址'), { target: { value: 'Alpha' } });
  const alphaCheck = await screen.findByRole('checkbox', { name: '选择 Alpha' });
  fireEvent.click(alphaCheck);
  expect(alphaCheck).toBeChecked();

  const collapseBtn = screen.getByRole('button', { name: '全部收起' });
  fireEvent.click(collapseBtn);

  expect(screen.queryByRole('treeitem', { name: '分支' })).not.toBeInTheDocument();
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByLabelText('搜索标题或网址')).toHaveValue('Alpha');
  expect(screen.getByRole('checkbox', { name: '选择 Alpha' })).toBeChecked();

  const expandBtn = screen.getByRole('button', { name: '全部展开' });
  fireEvent.click(expandBtn);

  expect(await screen.findByRole('treeitem', { name: '子叶' })).toBeVisible();
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'true');
  const expandedBranch = screen.getByRole('treeitem', { name: '分支' });
  expect(expandedBranch).toHaveAttribute('aria-expanded', 'true');
  expect(expandedBranch).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: '全部收起' })).toBeVisible();

  // Collapsing all expandable roots manually switches header button to 全部展开
  fireEvent.click(screen.getByRole('treeitem', { name: '分支' }).querySelector('button.tree-chevron')!);
  expect(screen.getByRole('button', { name: '全部收起' })).toBeVisible();
  fireEvent.click(screen.getByRole('treeitem', { name: '根' }).querySelector('button.tree-chevron')!);
  expect(screen.getByRole('button', { name: '全部展开' })).toBeVisible();

  // Switch to profile with zero expandable folders: toggle button disappears
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-flat' } });
  await screen.findByRole('treeitem', { name: '平级甲' });
  expect(screen.queryByRole('button', { name: /全部(展开|收起)/ })).not.toBeInTheDocument();
});

it('T2-S4b caps visual indent at 8 levels (14px per level) with indent guides while preserving aria-level and rowHeight', async () => {
  const chain = Array.from({ length: 10 }, (_, depth) =>
    node(`d-${depth}`, depth === 0 ? null : `d-${depth - 1}`, 0, 'folder', `第${depth + 1}层`),
  );
  install((command) => {
    if (command === 'cache_tree') return { nodes: chain };
    if (command === 'cache_query') return { items: [], offset: 0, total: 0, sourceEpoch: 1, revision: 4, nextOffset: null };
    return undefined;
  });

  render(<LibraryWorkspace state={state([profile('profile-a', '资料 A')])} invalid={false} native focusMirrorId={null} />);

  await screen.findByRole('treeitem', { name: '第2层' });
  fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
  fireEvent.click(screen.getByRole('button', { name: '全部展开' }));

  const d0 = await screen.findByRole('treeitem', { name: '第1层' });
  const d1 = screen.getByRole('treeitem', { name: '第2层' });
  const d8 = screen.getByRole('treeitem', { name: '第9层' });
  const d9 = screen.getByRole('treeitem', { name: '第10层' });

  expect(d0).toHaveAttribute('aria-level', '1');
  expect((d0.querySelector('.tree-row-content') as HTMLElement).style.paddingLeft).toBe('0px');
  expect(d0.querySelectorAll('.tree-indent-guide')).toHaveLength(0);
  expect(d0.style.height).toBe('40px');

  expect(d1).toHaveAttribute('aria-level', '2');
  expect((d1.querySelector('.tree-row-content') as HTMLElement).style.paddingLeft).toBe('14px');
  expect(d1.querySelectorAll('.tree-indent-guide')).toHaveLength(1);

  expect(d8).toHaveAttribute('aria-level', '9');
  expect((d8.querySelector('.tree-row-content') as HTMLElement).style.paddingLeft).toBe('112px');
  expect(d8.querySelectorAll('.tree-indent-guide')).toHaveLength(8);

  expect(d9).toHaveAttribute('aria-level', '10');
  expect((d9.querySelector('.tree-row-content') as HTMLElement).style.paddingLeft).toBe('112px');
  expect(d9.querySelectorAll('.tree-indent-guide')).toHaveLength(8);
  expect(d9.style.height).toBe('40px');
});

it('T2-S5a preserves collapse-all across profile revision refreshes and resets on source switch', async () => {
  const branchA = node('1', '0', 0, 'folder', '分支A');
  const rootB = node('b0', null, 0, 'folder', '根B');
  const branchB = node('b1', 'b0', 0, 'folder', '分支B');
  let treeCallsA = 0;
  install((command, args) => {
    if (command === 'cache_tree') {
      if (args.profileId === 'profile-a') {
        treeCallsA += 1;
        return { nodes: [root, branchA, alpha] };
      }
      return { nodes: [rootB, branchB] };
    }
    if (command === 'cache_query') return { items: [], offset: 0, total: 0, sourceEpoch: 1, revision: 4, nextOffset: null };
    return undefined;
  });

  const profB = profile('profile-b', '资料 B', 1);
  const view = render(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 4), profB])} invalid={false} native focusMirrorId={null} />);

  expect(await screen.findByRole('treeitem', { name: '分支A' })).toBeVisible();
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
  expect(screen.queryByRole('treeitem', { name: '分支A' })).not.toBeInTheDocument();
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'false');

  // Revision refresh on the same profile must NOT re-expand collapsed roots
  view.rerender(<LibraryWorkspace state={state([profile('profile-a', '资料 A', 5), profB], [], 2)} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(treeCallsA).toBeGreaterThanOrEqual(2));
  await act(async () => {});
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('treeitem', { name: '分支A' })).not.toBeInTheDocument();

  // Switching to a new profile resets initialization and expands its roots
  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'profile:profile-b' } });
  expect(await screen.findByRole('treeitem', { name: '分支B' })).toBeVisible();
  expect(screen.getByRole('treeitem', { name: '根B' })).toHaveAttribute('aria-expanded', 'true');
});

it('T2-S5b preserves collapse-all across mirror revision refreshes and resets on mirror switch', async () => {
  const branchA = node('1', '0', 0, 'folder', '镜像分支A');
  const rootB = node('mb0', null, 0, 'folder', '镜像根B');
  const branchB = node('mb1', 'mb0', 0, 'folder', '镜像分支B');
  let mirrorCallsA = 0;
  install((command, args) => {
    if (command === 'get_mirror_tree') {
      if (args.mirrorSourceId === 'mirror-a') {
        mirrorCallsA += 1;
        return { mirrorSourceId: 'mirror-a', displayName: 'Mirror A', fileStatus: 'current', association: 'independent', revision: mirrorCallsA, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: [root, branchA] };
      }
      return { mirrorSourceId: 'mirror-b', displayName: 'Mirror B', fileStatus: 'current', association: 'independent', revision: 1, lastSyncedAt: null, errorCode: null, canWriteBrowser: false, nodes: [rootB, branchB] };
    }
    return undefined;
  });

  const mkMirror = (id: string, name: string, rev: number) => ({
    mirrorSourceId: id, displayName: name, association: 'independent' as const, pairedProfileId: null,
    fileStatus: 'current' as const, watching: true, nodeCount: 2, revision: rev, lastSyncedAt: null, errorCode: null, canWriteBrowser: false as const,
  });
  const mirrorB = mkMirror('mirror-b', 'Mirror B', 1);
  const view = render(<LibraryWorkspace state={state([], [mkMirror('mirror-a', 'Mirror A', 1), mirrorB])} invalid={false} native focusMirrorId={null} />);

  expect(await screen.findByRole('treeitem', { name: '镜像分支A' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'false');

  view.rerender(<LibraryWorkspace state={state([], [mkMirror('mirror-a', 'Mirror A', 2), mirrorB], 2)} invalid={false} native focusMirrorId={null} />);
  await waitFor(() => expect(mirrorCallsA).toBeGreaterThanOrEqual(2));
  await act(async () => {});
  expect(screen.getByRole('treeitem', { name: '根' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('treeitem', { name: '镜像分支A' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('书签来源'), { target: { value: 'mirror:mirror-b' } });
  expect(await screen.findByRole('treeitem', { name: '镜像分支B' })).toBeVisible();
  expect(screen.getByRole('treeitem', { name: '镜像根B' })).toHaveAttribute('aria-expanded', 'true');
});

it('T4 collapses source-guidance in healthy live/local state, preserves explicit risk guidance and recovery button in non-healthy states, and merges selection status into library-list-meta without shortcut noise', async () => {
  const onSettings = vi.fn();
  const liveProfile = profile('profile-a', '资料 A', 4, 'live');
  const view = render(<LibraryWorkspace state={state([liveProfile])} invalid={false} native focusMirrorId={null} onSettings={onSettings} />);
  fireEvent.click(await screen.findByRole('treeitem', { name: /栏/ }));
  expect(await screen.findByRole('option', { name: /Alpha/ })).toBeVisible();

  // Healthy live state: compact <details class="source-guidance source-guidance-compact">, closed by default
  const compactLive = document.querySelector('details.source-guidance.source-guidance-compact') as HTMLDetailsElement | null;
  expect(compactLive).not.toBeNull();
  expect(compactLive!.open).toBe(false);
  expect(compactLive!.querySelector('summary')).toHaveTextContent('实时同步 · 已完成全树核对');
  expect(screen.queryByRole('button', { name: '检查连接设置' })).toBeNull();

  // No bottom .library-status and no mechanical shortcut texts
  expect(document.querySelector('.library-status')).toBeNull();
  const meta = document.querySelector('.library-list-meta') as HTMLElement;
  expect(meta).not.toBeNull();
  expect(meta).toHaveTextContent('已加载 4 / 4 项');
  expect(meta).not.toHaveTextContent('Ctrl+A');
  expect(meta).not.toHaveTextContent('Ctrl+End');
  expect(document.body.textContent).not.toContain('按 Chrome 顺序');
  expect(document.body.textContent).not.toContain('方向键浏览，Enter 打开');

  // Selecting an item merges "已选 1 项" into .library-list-meta
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Alpha' }));
  expect(meta).toHaveTextContent('已选 1 项');

  // Healthy local Skills library state: also uses compact guidance
  const localProfile = { ...liveProfile, profileId: 'local-skills', displayName: 'Skills 书签库', connection: 'local' as const };
  view.rerender(<LibraryWorkspace state={state([localProfile])} invalid={false} native focusMirrorId={null} onSettings={onSettings} />);
  const compactLocal = document.querySelector('details.source-guidance.source-guidance-compact') as HTMLDetailsElement | null;
  expect(compactLocal).not.toBeNull();
  expect(compactLocal!.querySelector('summary')).toHaveTextContent('本地 Skills 书签库');
  expect(screen.queryByRole('button', { name: '检查连接设置' })).toBeNull();

  // Non-healthy writePaused state: explicit risk warning & recovery button
  const pausedProfile = { ...liveProfile, writePaused: true };
  view.rerender(<LibraryWorkspace state={state([pausedProfile])} invalid={false} native focusMirrorId={null} onSettings={onSettings} />);
  expect(document.querySelector('details.source-guidance-compact')).toBeNull();
  expect(document.querySelector('.source-guidance .access-note')).toHaveTextContent('已暂停写入（只读保护）');
  expect(document.querySelector('.source-guidance .access-note')).toHaveTextContent('缓存时间：');
  const settingsBtn = screen.getByRole('button', { name: '检查连接设置' });
  fireEvent.click(settingsBtn);
  expect(onSettings).toHaveBeenCalledOnce();

  // Non-healthy cached_read_only state: explicit risk warning & recovery button
  const offlineProfile = { ...liveProfile, connection: 'cached_read_only' as const };
  view.rerender(<LibraryWorkspace state={state([offlineProfile])} invalid={false} native focusMirrorId={null} onSettings={onSettings} />);
  expect(document.querySelector('details.source-guidance-compact')).toBeNull();
  expect(document.querySelector('.source-guidance .access-note')).toHaveTextContent('扩展未连接');
  expect(screen.getByRole('button', { name: '检查连接设置' })).toBeInTheDocument();
});

