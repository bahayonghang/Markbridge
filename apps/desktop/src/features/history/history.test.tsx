import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExportSaveResult, OperationDetail, OperationList, UndoPreview } from '@markbridge/protocol';
import * as backend from '../../backend';
import { ExportDesk } from './ExportDesk';
import { HistoryWorkspace } from './HistoryWorkspace';

vi.mock('../../backend', () => ({ saveExport: vi.fn(), listOperations: vi.fn(), operationDetail: vi.fn(), previewUndo: vi.fn(), applyEdit: vi.fn(), reviewOperation: vi.fn(), refreshOperations: vi.fn(), getBatchEdit: vi.fn() }));
const summary: OperationList['operations'][number] = { operationId: 'op-a', createdAt: 1791800000000, kind: 'update', state: 'applied', affected: 1, errorCode: null, conflicts: [] };
function detail(profileId = 'p'): OperationDetail { return { profileId, sourceEpoch: 1, summary, undoOf: null, steps: [], restored: [] }; }
function undo(count = 1): UndoPreview { return { profileId: 'p', operationId: 'op-a', sourceEpoch: 1, expectedRevision: 4, affected: count, writable: true, errorCode: null, conflicts: [], steps: Array.from({ length: count }, (_, i) => ({ requestId: `r${i}`, payload: { kind: 'create', parentId: 'bar', position: i, title: `恢复条目 ${i}`, url: 'https://example.com/' } })) }; }
function result(status: ExportSaveResult['status'], id = 'p'): ExportSaveResult { return { status, metadata: { source: { kind: 'profile', id }, displayName: '研究资料', format: 'html', sourceEpoch: 1, revision: 4, cachedAt: 1791800000000, exportedAt: 1791800000001, nodeCount: 3 }, errorCode: status === 'failed' ? 'STORAGE_ERROR' : null }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [summary] });
  vi.mocked(backend.refreshOperations).mockResolvedValue({ operations: [summary] });
  vi.mocked(backend.operationDetail).mockImplementation(async (id) => detail(id));
  vi.mocked(backend.previewUndo).mockResolvedValue(undo());
  vi.mocked(backend.applyEdit).mockResolvedValue({ operationId: 'undo-a', state: 'rolled_back', errorCode: null, conflicts: [] });
});
afterEach(cleanup);

it('requires a real save receipt, locks duplicate clicks, and distinguishes cancel, failure and retry', async () => {
  const pending = deferred<ExportSaveResult>();
  vi.mocked(backend.saveExport).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result('failed')).mockResolvedValueOnce(result('saved'));
  render(<ExportDesk source={{ kind: 'profile', id: 'p' }} name="研究资料" cachedAt={null} />);
  const html = screen.getByRole('button', { name: '导出 HTML' });
  fireEvent.click(html); fireEvent.click(html);
  expect(backend.saveExport).toHaveBeenCalledOnce();
  expect(screen.queryByText('文件已保存到所选位置。')).toBeNull();
  expect(screen.getByRole('button', { name: '导出侧车 JSON' })).toBeDisabled();
  await act(async () => pending.resolve(result('cancelled')));
  expect(screen.getByText('已取消保存，没有生成文件。')).toBeVisible();
  fireEvent.click(html);
  expect(await screen.findByRole('alert')).toHaveTextContent('文件未保存');
  expect(screen.queryByText('文件已保存到所选位置。')).toBeNull();
  fireEvent.click(html);
  expect(await screen.findByText('文件已保存到所选位置。')).toBeVisible();
  expect(backend.saveExport).toHaveBeenLastCalledWith({ kind: 'profile', id: 'p' }, 'html');
});

it('mirror export has no invented sidecar and old source results cannot become current success', async () => {
  const old = deferred<ExportSaveResult>();
  vi.mocked(backend.saveExport).mockReturnValue(old.promise);
  const view = render(<ExportDesk source={{ kind: 'profile', id: 'p' }} name="A" cachedAt={null} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 HTML' }));
  view.rerender(<ExportDesk source={{ kind: 'mirror', id: 'mirror' }} name="文件 B" cachedAt={null} />);
  expect(screen.queryByRole('button', { name: '导出侧车 JSON' })).toBeNull();
  expect(screen.getByText('此文件来源没有本地侧车数据。')).toBeVisible();
  await act(async () => old.resolve(result('saved')));
  expect(screen.queryByText('文件已保存到所选位置。')).toBeNull();
});

it('rejects a saved receipt for another source', async () => {
  vi.mocked(backend.saveExport).mockResolvedValue(result('saved', 'other'));
  render(<ExportDesk source={{ kind: 'profile', id: 'p' }} name="A" cachedAt={null} />);
  fireEvent.click(screen.getByRole('button', { name: '导出 HTML' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('文件未保存');
});

it('shows distinct truthful states offline, independently of selected bookmark', async () => {
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: ['uncertain', 'failed', 'partial', 'rollback_conflict', 'applied'].map((state, i) => ({ ...summary, operationId: `op${i}`, state: state as typeof summary.state })) });
  render(<HistoryWorkspace profileId="p" profileName="A" revision={4} live={false} />);
  for (const label of ['结果不确定', '执行失败', '部分完成', '撤销存在冲突', '已完成']) expect(await screen.findByText(label)).toBeVisible();
  for (const button of screen.getAllByRole('button', { name: '撤销此记录' })) expect(button).toBeDisabled();
  expect(backend.previewUndo).not.toHaveBeenCalled();
  expect(backend.applyEdit).not.toHaveBeenCalled();
});

it('renders all 61 reviewed steps, cancels without writes and disables confirmation after disconnect', async () => {
  vi.mocked(backend.previewUndo).mockResolvedValue(undo(61));
  const content = (live: boolean) => <HistoryWorkspace profileId="p" profileName="A" revision={4} live={live} />;
  const view = render(content(true));
  fireEvent.click(await screen.findByRole('button', { name: '撤销此记录' }));
  const differences = await screen.findByRole('list', { name: '完整撤销差异' });
  expect(within(differences).getAllByRole('listitem')).toHaveLength(61);
  expect(within(differences).getByRole('heading', { name: '新建 · 恢复条目 60' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消撤销' }));
  expect(backend.applyEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
  await screen.findByRole('region', { name: '撤销预览' });
  view.rerender(content(false));
  fireEvent.click(screen.getByRole('button', { name: '确认条件撤销' }));
  expect(backend.applyEdit).not.toHaveBeenCalled();
  view.rerender(content(true));
  fireEvent.click(screen.getByRole('button', { name: '确认条件撤销' }));
  fireEvent.click(screen.getByRole('button', { name: '确认条件撤销' }));
  expect(await screen.findByText('撤销回执已确认。')).toBeVisible();
  expect(backend.applyEdit).toHaveBeenCalledOnce();
});

it('discards late undo previews on revision change and late details after an A-B-A source visit', async () => {
  const delayed = deferred<UndoPreview>(); const old = deferred<OperationDetail>();
  vi.mocked(backend.previewUndo).mockReturnValue(delayed.promise);
  vi.mocked(backend.operationDetail).mockReturnValueOnce(old.promise).mockResolvedValue(detail());
  const content = (id: string, revision: number) => <HistoryWorkspace profileId={id} profileName={id} revision={revision} live />;
  const view = render(content('p', 4));
  fireEvent.click(await screen.findByRole('button', { name: '撤销此记录' }));
  view.rerender(content('p', 5));
  await act(async () => delayed.resolve(undo()));
  expect(screen.queryByRole('region', { name: '撤销预览' })).toBeNull();
  view.rerender(content('other', 4));
  await screen.findByRole('button', { name: '撤销此记录' });
  view.rerender(content('p', 4));
  fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }));
  await screen.findByRole('heading', { name: '记录详情' });
  await act(async () => old.resolve({ ...detail(), summary: { ...summary, state: 'uncertain' } }));
  expect(screen.queryByText(/未收到可靠结果/)).toBeNull();
  expect(backend.applyEdit).not.toHaveBeenCalled();
});

it('records manual review without relabeling an unknown result as success', async () => {
  const unknown = { ...summary, state: 'uncertain' as const };
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [unknown] });
  vi.mocked(backend.operationDetail).mockResolvedValue({ ...detail(), summary: unknown });
  vi.mocked(backend.reviewOperation).mockImplementation(async () => { vi.mocked(backend.listOperations).mockResolvedValue({ operations: [{ ...unknown, reviewed: true }] }); return { operations: [{ ...unknown, reviewed: true }] }; });
  render(<HistoryWorkspace profileId="p" profileName="A" revision={4} live={false} />);
  fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }));
  fireEvent.click(await screen.findByRole('button', { name: '标记已核对' }));
  expect(await screen.findByText('结果不确定 · 已核对')).toBeVisible();
  expect(screen.queryByText('已完成')).toBeNull();
  await waitFor(() => expect(backend.reviewOperation).toHaveBeenCalledWith('p', 'op-a'));
});

it.each(['rolled_back', 'rollback_conflict'] as const)('finishes an async undo notice only from its matching %s receipt', async (state) => {
  vi.mocked(backend.applyEdit).mockResolvedValue({ operationId: 'undo-watched', state: 'rolling_back', errorCode: null, conflicts: [] });
  render(<HistoryWorkspace profileId="p" profileName="A" revision={4} live />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销此记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认条件撤销' }));
  expect(await screen.findByText('已发送撤销，正在等待回执。')).toBeVisible();
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [summary, { ...summary, state, operationId: 'unrelated' }] });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  expect(screen.getByText('已发送撤销，正在等待回执。')).toBeVisible();
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [summary, { ...summary, state, operationId: 'undo-watched' }] });
  // Keep the original detail mounted while the independently watched receipt finishes.
  fireEvent.click(screen.getByRole('button', { name: '重新查询回执' }));
  await waitFor(() => expect(screen.queryByText('已发送撤销，正在等待回执。')).toBeNull(), { timeout: 2000 });
  expect(screen.getByText(state === 'rolled_back' ? '撤销回执已确认。' : '撤销存在冲突，外部值保持不变。')).toBeVisible();
});
