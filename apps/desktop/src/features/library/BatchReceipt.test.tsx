import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BatchEditStatus } from '@markbridge/protocol';
import { parseOperationList } from '@markbridge/protocol';
import * as backend from '../../backend';
import { BatchReceipt } from './BatchReceipt';
import { HistoryWorkspace } from '../history/HistoryWorkspace';

vi.mock('../../backend', async (original) => ({ ...await original<typeof backend>(), listOperations: vi.fn(), getBatchEdit: vi.fn(), cancelBatchEdit: vi.fn() }));
function status(profileId = 'p', operationId = 'batch'): BatchEditStatus {
  return { profileId, operationId, state: 'partial', stopped: true, errorCode: 'CANCELLED', items: [{ chromeId: 'a', title: '已完成项目', state: 'applied', errorCode: null }, { chromeId: 'b', title: '待执行项目', state: 'not_executed', errorCode: null }] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(backend.getBatchEdit).mockResolvedValue(status()); });
afterEach(cleanup);

it('keeps old operation lists compatible and marks only persisted batches for recovery', () => {
  const legacy = { operationId: 'old', state: 'applied', affected: 1, errorCode: null, conflicts: [] };
  expect(parseOperationList({ operations: [legacy] }).operations[0]?.isBatch).toBeUndefined();
  expect(parseOperationList({ operations: [{ ...legacy, isBatch: true }] }).operations[0]?.isBatch).toBe(true);
});

it('reopens persisted per-item status from read-only history after remount without applying', async () => {
  vi.mocked(backend.listOperations).mockResolvedValue({ operations: [
    { operationId: 'single', state: 'applied', affected: 1, errorCode: null, conflicts: [] },
    { operationId: 'batch', isBatch: true, state: 'partial', affected: 2, errorCode: 'CONFLICT', conflicts: [] },
  ] });
  const history = <HistoryWorkspace profileId="p" profileName="资料" revision={1} live={false} />;
  const first = render(history);
  fireEvent.click(await screen.findByRole('button', { name: '查看逐项回执' }));
  expect(await screen.findByText('未执行', { exact: true })).toBeVisible();
  expect(screen.getAllByRole('button', { name: '查看逐项回执' })).toHaveLength(1);
  first.unmount(); render(history);
  fireEvent.click(await screen.findByRole('button', { name: '查看逐项回执' }));
  expect(await screen.findByText('已执行', { exact: true })).toBeVisible();
  expect(backend.getBatchEdit).toHaveBeenLastCalledWith('p', 'batch');
});

it('rejects late operation and profile results, including an A to B to A visit', async () => {
  const old = deferred<BatchEditStatus>();
  vi.mocked(backend.getBatchEdit).mockReturnValueOnce(old.promise).mockResolvedValueOnce(status('q', 'other')).mockResolvedValueOnce(status());
  const view = render(<BatchReceipt profileId="p" operationId="batch" />);
  view.rerender(<BatchReceipt profileId="q" operationId="other" />);
  await waitFor(() => expect(backend.getBatchEdit).toHaveBeenCalledWith('q', 'other'));
  view.rerender(<BatchReceipt profileId="p" operationId="batch" />);
  await screen.findByText('批次已停止');
  await act(async () => old.resolve({ ...status(), items: [{ chromeId: 'old', title: '过期结果', state: 'applied', errorCode: null }] }));
  expect(screen.queryByText('过期结果')).toBeNull();
  expect(screen.getByText('待执行项目')).toBeVisible();
});

it('cancels once and ignores an older in-flight read without claiming an undo', async () => {
  const reading = deferred<BatchEditStatus>(); const cancelling = deferred<BatchEditStatus>();
  const initial: BatchEditStatus = { ...status(), state: 'applying', stopped: false, items: [{ chromeId: 'a', title: '执行中项目', state: 'in_flight', errorCode: null }, status().items[1]!] };
  vi.mocked(backend.getBatchEdit).mockReturnValue(reading.promise);
  vi.mocked(backend.cancelBatchEdit).mockReturnValue(cancelling.promise);
  render(<BatchReceipt profileId="p" operationId="batch" initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: '重新查询逐项回执' }));
  const stop = screen.getByRole('button', { name: '停止后续步骤' }); fireEvent.click(stop); fireEvent.click(stop);
  expect(backend.cancelBatchEdit).toHaveBeenCalledTimes(1);
  await act(async () => cancelling.resolve({ ...status(), state: 'uncertain', items: [{ ...initial.items[0], state: 'uncertain' }, initial.items[1]!] }));
  await act(async () => reading.resolve(initial));
  expect(screen.getByText('批次已停止')).toBeVisible();
  expect(screen.getByText('结果不确定')).toBeVisible();
  expect(screen.queryByRole('button', { name: '停止后续步骤' })).toBeNull();
  expect(screen.getByText(/停止不会撤销已执行的变更/)).toBeVisible();
});

it('keeps a retry available after a failed or mismatched status response', async () => {
  vi.mocked(backend.getBatchEdit).mockResolvedValueOnce(status('wrong')).mockResolvedValueOnce(status());
  render(<BatchReceipt profileId="p" operationId="batch" />);
  expect(await screen.findByText('无法读取回执，请重新查询。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重新查询逐项回执' }));
  expect(await screen.findByText('批次已停止')).toBeVisible();
});
