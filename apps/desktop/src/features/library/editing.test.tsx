import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BatchEditStatus, BookmarkNode, EditPreview } from '@markbridge/protocol';
import * as backend from '../../backend';
import { EditDesk } from './EditDesk';
import { BatchEditDesk } from './BatchEditDesk';

vi.mock('../../backend', async (original) => ({ ...await original<typeof backend>(), previewEdit: vi.fn(), applyEdit: vi.fn(), listOperations: vi.fn(async () => ({ operations: [] })), previewBatchEdit: vi.fn(), applyBatchEdit: vi.fn(), getBatchEdit: vi.fn(), cancelBatchEdit: vi.fn() }));
const node = (chromeId: string, parentId: string | null, title: string, kind: 'folder' | 'bookmark' = 'folder'): BookmarkNode => ({ chromeId, parentId, title, kind, position: 0, url: kind === 'bookmark' ? 'https://example.com/' : null });
const nodes = [node('0', null, '书签'), node('bar', '0', '书签栏'), node('empty', 'bar', '空目录'), node('a', 'bar', '原书签', 'bookmark'), node('b', 'bar', '另一个书签', 'bookmark')];
function preview(label = '新值', revision = 1): EditPreview { return { profileId: 'p', expectedRevision: revision, affected: 1, requiresSecondConfirm: false, writable: true, errorCode: null, changes: [{ field: 'title', before: '原值', after: label }] }; }
function desk(selected: BookmarkNode | null = nodes[3]!, revision = 1, creating = false) { return <EditDesk mode="edit" profileId="p" revision={revision} node={selected} siblingIds={['a', 'b']} folderId="empty" insertParentId="empty" insertPosition={0} request={null} nodes={nodes} creating={creating} />; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(backend.previewEdit).mockResolvedValue(preview()); });
afterEach(cleanup);

it('creates from blank independent bookmark/folder drafts in an empty directory and cancels without applying', async () => {
  const view = render(desk());
  fireEvent.change(screen.getByLabelText('新标题'), { target: { value: '未保存编辑' } });
  view.rerender(desk(null, 1, true));
  expect(screen.getByLabelText('名称')).toHaveValue(''); expect(screen.getByLabelText('网址')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新书签' } });
  fireEvent.change(screen.getByLabelText('网址'), { target: { value: 'https://new.example/' } });
  fireEvent.click(screen.getByRole('button', { name: /^文件夹$/ }));
  expect(screen.getByLabelText('名称')).toHaveValue(''); expect(screen.queryByLabelText('网址')).toBeNull();
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新目录' } });
  fireEvent.click(screen.getByRole('button', { name: '预览新文件夹' }));
  await screen.findByRole('button', { name: '确认变更' });
  expect(backend.previewEdit).toHaveBeenLastCalledWith('p', 1, { kind: 'create', parentId: 'empty', position: 0, title: '新目录' });
  fireEvent.click(screen.getByRole('button', { name: /^取消$/ })); expect(backend.applyEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^书签$/ }));
  expect(screen.getByLabelText('名称')).toHaveValue('新书签'); expect(screen.getByLabelText('网址')).toHaveValue('https://new.example/');
  view.rerender(desk()); expect(screen.getByLabelText('新标题')).toHaveValue('未保存编辑');
});

it('rejects previews after node switch, revision change, cancellation and a newer response', async () => {
  const old = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(old.promise);
  const view = render(desk()); fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  view.rerender(desk(nodes[4])); await act(async () => old.resolve(preview('旧节点预览'))); expect(screen.queryByText(/旧节点预览/)).toBeNull();
  const stale = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(stale.promise);
  fireEvent.change(screen.getByLabelText('新标题'), { target: { value: '保留草稿' } }); fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  view.rerender(desk(nodes[4], 2)); await act(async () => stale.resolve(preview('旧版本预览')));
  expect(screen.getByLabelText('新标题')).toHaveValue('保留草稿'); expect(screen.queryByText(/旧版本预览/)).toBeNull();
  const cancelled = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(cancelled.promise);
  fireEvent.click(screen.getByRole('button', { name: '预览修改' })); fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
  await act(async () => cancelled.resolve(preview('取消预览', 2))); expect(screen.queryByRole('dialog')).toBeNull();
  const slower = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(slower.promise).mockResolvedValueOnce(preview('最新预览', 2));
  fireEvent.click(screen.getByRole('button', { name: '预览修改' })); fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  await screen.findByText(/最新预览/); await act(async () => slower.resolve(preview('过时预览', 2)));
  expect(screen.queryByText(/过时预览/)).toBeNull(); expect(backend.applyEdit).not.toHaveBeenCalled();
});

it('accepts its own write receipt after a revision event and blocks duplicate confirm', async () => {
  const applied = deferred<Awaited<ReturnType<typeof backend.applyEdit>>>(); vi.mocked(backend.applyEdit).mockReturnValue(applied.promise);
  const view = render(desk()); fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  const confirm = await screen.findByRole('button', { name: '确认变更' }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(backend.applyEdit).toHaveBeenCalledTimes(1); view.rerender(desk(nodes[3], 2));
  await act(async () => applied.resolve({ operationId: 'op', state: 'applied', errorCode: null, conflicts: [] }));
  expect(screen.getByText('回执已确认。')).toBeVisible();
});

it('reviews one backend group, submits only the reviewed token, and reports cancellation truthfully', async () => {
  const item = { chromeId: 'a', title: '原书签', path: '书签 / 书签栏 / 原书签', affected: 1, changes: [] };
  vi.mocked(backend.previewBatchEdit).mockResolvedValue({ planId: 'plan', planHash: 'hash', profileId: 'p', sourceEpoch: 1, expectedRevision: 1, selectedCount: 2, affected: 2, requiresSecondConfirm: false, destinationPath: null, writable: true, items: [item, { ...item, chromeId: 'b' }] });
  const result: BatchEditStatus = { operationId: 'op', profileId: 'p', state: 'applying' as const, stopped: false, errorCode: null, items: [{ chromeId: 'a', title: '原书签', state: 'in_flight' as const, errorCode: null }, { chromeId: 'b', title: '另一个书签', state: 'not_executed' as const, errorCode: null }] };
  vi.mocked(backend.applyBatchEdit).mockResolvedValue(result);
  vi.mocked(backend.cancelBatchEdit).mockResolvedValue({ ...result, state: 'uncertain', stopped: true, items: [{ ...result.items[0]!, state: 'uncertain' }, result.items[1]!] });
  render(<BatchEditDesk profileId="p" profileName="资料" revision={1} live nodes={nodes} request={{ id: 1, kind: 'delete', chromeIds: ['a', 'b'] }} />);
  fireEvent.click(await screen.findByRole('button', { name: '确认批量变更' }));
  await waitFor(() => expect(backend.applyBatchEdit).toHaveBeenCalledWith('p', 'plan', 'hash', false));
  expect(backend.applyEdit).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '停止后续步骤' }));
  expect(await screen.findByText(/停止不会撤销/)).toBeVisible(); expect(screen.getByText('结果不确定')).toBeVisible(); expect(screen.getByText('未执行')).toBeVisible();
});

it('rejects a late A preview after A to B to A and after editing the same draft', async () => {
  const old = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(old.promise);
  const view = render(desk()); fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  view.rerender(desk(nodes[4])); view.rerender(desk(nodes[3]));
  await act(async () => old.resolve(preview('A旧预览'))); expect(screen.queryByText(/A旧预览/)).toBeNull();
  const draft = deferred<EditPreview>(); vi.mocked(backend.previewEdit).mockReturnValueOnce(draft.promise);
  fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
  fireEvent.change(screen.getByLabelText('新标题'), { target: { value: '较新草稿' } });
  await act(async () => draft.resolve(preview('旧草稿预览'))); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByLabelText('新标题')).toHaveValue('较新草稿');
});

it('requires batch second confirmation and accepts an own revision before apply resolves', async () => {
  const request = { id: 1, kind: 'delete' as const, chromeIds: ['a'] };
  vi.mocked(backend.previewBatchEdit).mockResolvedValue({ planId: 'plan', planHash: 'hash', profileId: 'p', sourceEpoch: 1, expectedRevision: 1, selectedCount: 1, affected: 21, requiresSecondConfirm: true, destinationPath: null, writable: true, items: [{ chromeId: 'a', title: '目录', path: '书签 / 目录', affected: 21, changes: [] }] });
  const pending = deferred<Awaited<ReturnType<typeof backend.applyBatchEdit>>>(); vi.mocked(backend.applyBatchEdit).mockReturnValue(pending.promise);
  const component = (revision: number) => <BatchEditDesk profileId="p" profileName="资料" revision={revision} live nodes={nodes} request={request} />;
  const view = render(component(1)); fireEvent.click(await screen.findByRole('button', { name: '继续确认批量删除' }));
  expect(backend.applyBatchEdit).not.toHaveBeenCalled(); const confirm = screen.getByRole('button', { name: '确认批量删除' }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(backend.applyBatchEdit).toHaveBeenCalledExactlyOnceWith('p', 'plan', 'hash', true);
  view.rerender(component(2)); await act(async () => pending.resolve({ operationId: 'op', profileId: 'p', state: 'applied', stopped: false, errorCode: null, items: [{ chromeId: 'a', title: '目录', state: 'applied', errorCode: null }] }));
  expect(screen.getByText('全部回执已确认')).toBeVisible();
});
