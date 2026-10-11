import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BookmarkNode, BridgeState } from '@markbridge/protocol';
import { LibraryWorkspace } from '../library/LibraryWorkspace';
import { TagDesk } from './TagDesk';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type Args = Record<string, unknown>;

function node(chromeId: string, parentId: string | null, position: number, title: string): BookmarkNode {
  return { chromeId, parentId, position, kind: 'bookmark', title, url: `https://example.com/${chromeId}` };
}

function catalog(extra: Args = {}) {
  return {
    profileId: 'profile-a', encodingEnabled: false, journalId: 'journal-1', affected: 0, mergeRequired: false,
    sourceTagId: null, targetTagId: null, filterTagId: null,
    tags: [{ tagId: 'tag-work', name: 'Work', count: 1 }],
    entries: [] as Args[],
    matches: [] as BookmarkNode[],
    ...extra,
  };
}

function encodingPreview(changes: { before: string; after: string }[], conflicts: { chromeId: string }[] = [], writable = true) {
  return {
    profileId: 'profile-a', expectedRevision: 4, enabled: true, restore: false, writable,
    errorCode: conflicts.length && !writable ? 'CONFLICT' : null,
    changes: changes.map((change) => ({ field: 'title', before: change.before, after: change.after })),
    conflicts: conflicts.map((conflict) => ({ chromeId: conflict.chromeId, errorCode: 'CONFLICT' })),
  };
}

const alpha = node('10', '1', 0, 'Alpha');
const beta = node('11', '1', 1, 'Beta');

function profile(connection: BridgeState['profiles'][number]['connection'] = 'cached_read_only'): BridgeState {
  return {
    protocolVersion: 1, revision: 1, port: 49153, errorCode: null, pending: [], mirrors: [],
    profiles: [{ profileId: 'profile-a', instanceId: 'instance-profile-a', displayName: '资料 A', connection, nodeCount: 4, revision: 4, lastSyncedAt: null, errorCode: null }],
  };
}

beforeEach(() => { vi.mocked(isTauri).mockReturnValue(true); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('edits tags and notes for a multi-selection while offline without writing chrome titles', async () => {
  const root = node('0', null, 0, '根');
  const bar = { ...node('1', '0', 0, '栏'), kind: 'folder' as const, url: null };
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args: Args = raw && typeof raw === 'object' ? raw as Args : {};
    if (command === 'cache_tree') return args.folderId == null ? { nodes: [{ ...root, kind: 'folder', url: null }, bar] } : { nodes: [bar, alpha, beta] };
    if (command === 'cache_list') return { items: [alpha, beta], total: 2 };
    if (command === 'cache_count') return { folders: 0, bookmarks: 2 };
    if (command === 'cache_get') return { node: alpha, ancestors: ['根', '栏'] };
    if (command === 'cache_search') return { items: [] };
    if (command === 'list_operations' || command === 'refresh_operations' || command === 'review_operation') return { operations: [] };
    if (command === 'tag_state') {
      const filter = args.filterTagId;
      return catalog({
        filterTagId: filter ?? null,
        matches: filter === 'tag-work' ? [alpha] : [],
        entries: Array.isArray(args.chromeIds) ? args.chromeIds.map((chromeId) => ({ bookmarkId: `bm-${chromeId}`, chromeId, note: '', tagIds: [], rawTitle: null, lastEncodedTitle: null, conflict: false })) : [],
      });
    }
    if (command === 'tag_command') {
      const body = args.command as { kind?: string; chromeIds?: string[]; tagId?: string; note?: string };
      return catalog({
        affected: body.chromeIds?.length ?? 0,
        entries: (body.chromeIds ?? []).map((chromeId) => ({
          bookmarkId: `bm-${chromeId}`, chromeId, note: body.note ?? '',
          tagIds: body.kind === 'remove' ? [] : ['tag-work'],
          rawTitle: null, lastEncodedTitle: null, conflict: false,
        })),
      });
    }
    return {};
  });
  render(<LibraryWorkspace state={profile()} invalid={false} native focusMirrorId={null} />);
  const rootRow = await screen.findByRole('treeitem', { name: /根/ });
  rootRow.focus();
  fireEvent.keyDown(rootRow, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择 Alpha' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Beta' }));
  fireEvent.change(screen.getByLabelText('添加标签'), { target: { value: 'Work' } });
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    profileId: 'profile-a', command: { kind: 'add', chromeIds: ['10', '11'], name: 'Work' },
  })));
  fireEvent.click(await screen.findByRole('button', { name: '移除' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: expect.objectContaining({ kind: 'remove', tagId: 'tag-work', chromeIds: ['10', '11'] }),
  })));
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '离线备注' } });
  fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: { kind: 'set_note', chromeIds: ['10', '11'], note: '离线备注' },
  })));
  expect(screen.getByText('Alpha')).toBeVisible();
  expect(screen.getByText('Beta')).toBeVisible();
  fireEvent.change(screen.getByLabelText('按标签筛选'), { target: { value: 'tag-work' } });
  expect(await screen.findByRole('listbox', { name: '标签筛选' })).toBeVisible();
  expect(screen.getByRole('option', { name: /Alpha/ })).toBeVisible();
  expect(screen.queryByRole('option', { name: /Beta/ })).not.toBeInTheDocument();
  const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(commands).not.toContain('preview_edit');
  expect(commands).not.toContain('apply_edit');
  expect(commands).not.toContain('preview_title_encoding');
  expect(commands).not.toContain('apply_title_encoding');
});

it('writes an encoded title only after the full diff is shown, and a second pass does not append', async () => {
  let enabled = false;
  let previews = 0;
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args: Args = raw && typeof raw === 'object' ? raw as Args : {};
    if (command === 'tag_state') return catalog({ encodingEnabled: enabled });
    if (command === 'tag_command') {
      enabled = (args.command as { enabled?: boolean }).enabled === true;
      return catalog({ encodingEnabled: enabled });
    }
    if (command === 'preview_title_encoding') {
      previews += 1;
      return previews === 1
        ? encodingPreview([{ before: '报告 | 草稿', after: '报告 \\| 草稿 | Work' }, { before: 'Beta', after: 'Beta | Work' }])
        : encodingPreview([]);
    }
    if (command === 'apply_title_encoding') return { operationId: 'op-title', state: 'applied', errorCode: null, conflicts: [] };
    return {};
  });
  render(<TagDesk profileId="profile-a" revision={4} live chromeIds={['10', '11']} filterTagId={null} onFilter={() => {}} onCatalog={() => {}} />);
  const toggle = await screen.findByLabelText('启用标题编码');
  expect(screen.getByRole('button', { name: '预览标题差异' })).toBeDisabled();
  fireEvent.click(toggle);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({ command: { kind: 'set_encoding', enabled: true } })));
  expect(screen.getByText('关闭编码不会改写 Chrome 标题。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '预览标题差异' }));
  expect(await screen.findByText('报告 | 草稿 → 报告 \\| 草稿 | Work')).toBeVisible();
  expect(screen.getByText('Beta → Beta | Work')).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_title_encoding')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认写入标题' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_title_encoding', {
    profileId: 'profile-a', expectedRevision: 4, chromeIds: ['10', '11'], restore: false,
  }));
  fireEvent.click(screen.getByRole('button', { name: '预览标题差异' }));
  expect(await screen.findByText('没有需要写入的标题。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '确认写入标题' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('启用标题编码'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({ command: { kind: 'set_encoding', enabled: false } })));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'apply_title_encoding')).toHaveLength(1);
});

it('drops a title diff when local tags change, including a late preview', async () => {
  let releasePreview: (value: ReturnType<typeof encodingPreview>) => void = () => {};
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args: Args = raw && typeof raw === 'object' ? raw as Args : {};
    const body = args.command as { kind?: string } | undefined;
    if (command === 'tag_state') return catalog({ encodingEnabled: true });
    if (command === 'tag_command' && body?.kind === 'add') return catalog({ encodingEnabled: true, affected: 1 });
    if (command === 'preview_title_encoding') return await new Promise((resolve) => { releasePreview = resolve; });
    if (command === 'apply_title_encoding') return { operationId: 'op-title', state: 'applied', errorCode: null, conflicts: [] };
    return {};
  });
  render(<TagDesk profileId="profile-a" revision={4} live chromeIds={['10']} filterTagId={null} onFilter={() => {}} onCatalog={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '预览标题差异' }));
  fireEvent.change(screen.getByLabelText('添加标签'), { target: { value: 'Home' } });
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: { kind: 'add', chromeIds: ['10'], name: 'Home' },
  })));
  await act(async () => { releasePreview(encodingPreview([{ before: 'Alpha', after: 'Alpha | Work' }])); });
  expect(screen.queryByText('Alpha → Alpha | Work')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认写入标题' })).not.toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_title_encoding')).toBe(false);
});

it('shows an external title conflict and does not restore it', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'tag_state') return catalog({
      encodingEnabled: true,
      entries: [{ bookmarkId: 'bm-10', chromeId: '10', note: '', tagIds: ['tag-work'], rawTitle: 'Alpha', lastEncodedTitle: 'Alpha | Work', conflict: true }],
    });
    if (command === 'preview_title_encoding') return encodingPreview([{ before: 'keep', after: 'keep | Work' }], [{ chromeId: '10' }], false);
    return {};
  });
  render(<TagDesk profileId="profile-a" revision={4} live chromeIds={['10']} filterTagId={null} onFilter={() => {}} onCatalog={() => {}} />);
  expect(await screen.findByText('外部标题已改变，这一条不会写入。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '预览标题差异' }));
  expect(await screen.findByText(/外部标题已改变，这一条不会写入。10/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '确认写入标题' })).not.toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_title_encoding')).toBe(false);
});

it('asks before merging a normalized tag and can undo the journal', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    const args: Args = raw && typeof raw === 'object' ? raw as Args : {};
    const body = args.command as { kind?: string } | undefined;
    if (command === 'tag_state') return catalog({ tags: [{ tagId: 'tag-work', name: 'Work', count: 2 }, { tagId: 'tag-folded', name: 'work', count: 1 }] });
    if (command === 'tag_command' && body?.kind === 'rename') return catalog({
      mergeRequired: true, sourceTagId: 'tag-work', targetTagId: 'tag-folded', affected: 2,
      tags: [{ tagId: 'tag-work', name: 'Work', count: 2 }, { tagId: 'tag-folded', name: 'work', count: 1 }],
    });
    if (command === 'tag_command' && body?.kind === 'merge') return catalog({ affected: 2, tags: [{ tagId: 'tag-folded', name: 'work', count: 3 }] });
    if (command === 'tag_command' && body?.kind === 'undo') return catalog({ affected: 2, journalId: null });
    if (command === 'tag_command' && body?.kind === 'delete') return catalog({ affected: 1, tags: [] });
    return catalog();
  });
  render(<TagDesk profileId="profile-a" revision={4} live={false} chromeIds={['10']} filterTagId={null} onFilter={() => {}} onCatalog={() => {}} />);
  fireEvent.change(await screen.findByLabelText('重命名'), { target: { value: 'work' } });
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认合并' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: { kind: 'merge', sourceId: 'tag-work', targetId: 'tag-folded' },
  })));
  fireEvent.click(screen.getByRole('button', { name: '撤销上次标签变更' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('tag_command', expect.objectContaining({
    command: { kind: 'undo', journalId: 'journal-1' },
  })));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'apply_title_encoding' || command === 'apply_edit')).toBe(false);
});
