import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiagnosticSaveResult } from '@markbridge/protocol';
import { saveDiagnostics } from '../../backend';
import { DiagnosticExport } from './DiagnosticExport';

vi.mock('../../backend', () => ({ saveDiagnostics: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('requires an explicit click, distinguishes cancellation and allows retry', async () => {
  vi.mocked(saveDiagnostics).mockResolvedValueOnce({ status: 'cancelled', errorCode: null }).mockResolvedValueOnce({ status: 'saved', errorCode: null });
  render(<DiagnosticExport native />);
  const button = screen.getByRole('button', { name: '导出诊断 JSON' });
  expect(saveDiagnostics).not.toHaveBeenCalled();
  expect(screen.getByText(/不含书签内容/)).toBeVisible();
  fireEvent.click(button);
  await screen.findByText('已取消保存，没有生成诊断文件。');
  expect(screen.queryByText('诊断文件已保存到所选位置。')).not.toBeInTheDocument();
  fireEvent.click(button);
  await screen.findByText('诊断文件已保存到所选位置。');
  expect(saveDiagnostics).toHaveBeenCalledTimes(2);
  expect(saveDiagnostics).toHaveBeenCalledWith();
});

it.each(['reported', 'rejected'] as const)('keeps %s failure private and retryable', async (failure) => {
  const mocked = vi.mocked(saveDiagnostics);
  if (failure === 'reported') mocked.mockResolvedValueOnce({ status: 'failed', errorCode: 'STORAGE_ERROR' });
  else mocked.mockRejectedValueOnce(new Error('C:/private sk-secret Authorization: Bearer raw-body'));
  mocked.mockResolvedValueOnce({ status: 'saved', errorCode: null });
  const view = render(<DiagnosticExport native />);
  const button = screen.getByRole('button', { name: '导出诊断 JSON' });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('诊断文件未保存。');
  expect(view.container).not.toHaveTextContent('sk-secret');
  expect(view.container).not.toHaveTextContent('C:/private');
  fireEvent.click(button);
  await screen.findByText('诊断文件已保存到所选位置。');
});

it('locks the native save until completion and drops a result after unmount', async () => {
  let finish!: (value: DiagnosticSaveResult) => void;
  vi.mocked(saveDiagnostics).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const view = render(<DiagnosticExport native />);
  const button = screen.getByRole('button', { name: '导出诊断 JSON' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(saveDiagnostics).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('请在系统对话框选择保存位置。');
  view.unmount();
  await act(async () => { finish({ status: 'saved', errorCode: null }); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('disables browser preview without submitting an export', async () => {
  render(<DiagnosticExport native={false} />);
  const button = screen.getByRole('button', { name: '导出诊断 JSON' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  await waitFor(() => expect(saveDiagnostics).not.toHaveBeenCalled());
});
