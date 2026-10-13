import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MaintenanceReport } from '@markbridge/protocol';
import { cancelLinkCheck, checkLinks, confirmCleanup, inspectLibrary, previewCleanup, searchLibraryText } from '../../backend';
import { MaintenanceDesk } from './MaintenanceDesk';

vi.mock('../../backend', () => ({
  inspectLibrary: vi.fn(),
  checkLinks: vi.fn(),
  cancelLinkCheck: vi.fn(),
  previewCleanup: vi.fn(),
  confirmCleanup: vi.fn(),
  searchLibraryText: vi.fn(),
  applyEdit: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function report(): MaintenanceReport {
  return {
    profileId: 'profile-a',
    sourceEpoch: 1,
    revision: 4,
    requestId: 'mnt-1',
    duplicates: [{
      normalizedUrl: 'https://example.com/a',
      members: [
        { bookmarkId: 'bm-10', chromeId: '10', title: '保留页', url: 'https://example.com/a', tags: ['阅读'], note: '保留备注' },
        { bookmarkId: 'bm-11', chromeId: '11', title: '重复页', url: 'https://example.com/a', tags: ['稍后'], note: '另一备注' },
      ],
    }],
    links: [],
    cleanup: null,
    running: false,
    failure: null,
    failureMessage: null,
  };
}

function preview(): MaintenanceReport {
  return {
    ...report(),
    failure: 'CANCELLED',
    failureMessage: '未确认清理。没有删除书签。',
    cleanup: {
      keeper: { bookmarkId: 'bm-10', chromeId: '10', title: '保留页', url: 'https://example.com/a', tags: ['阅读'], note: '保留备注' },
      removals: [{ bookmarkId: 'bm-11', chromeId: '11', title: '重复页', url: 'https://example.com/a', tags: ['稍后'], note: '另一备注' }],
      metadata: {
        tagUnion: ['稍后', '阅读'],
        noteConflicts: [{ bookmarkId: 'bm-11', chromeId: '11', note: '另一备注' }],
        keeperNote: '保留备注',
        handling: '保留项备注保持不变。标签取并集。摘要不合并。',
      },
      operationId: null,
      operationState: null,
    },
  };
}

it('does not inspect, check, preview, confirm, or search on mount', () => {
  render(<MaintenanceDesk profileId="profile-a" revision={4} live chromeIds={['10', '11']} />);
  expect(inspectLibrary).not.toHaveBeenCalled();
  expect(previewCleanup).not.toHaveBeenCalled();
  expect(confirmCleanup).not.toHaveBeenCalled();
  expect(searchLibraryText).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
});

it('shows keeper, removals, tag union, and note conflict before confirm', async () => {
  vi.mocked(inspectLibrary).mockResolvedValue(report());
  vi.mocked(previewCleanup).mockResolvedValue(preview());
  render(<MaintenanceDesk profileId="profile-a" revision={4} live chromeIds={['10', '11']} />);
  fireEvent.click(screen.getByRole('button', { name: '检查重复' }));
  expect(await screen.findByRole('radio', { name: '保留页' })).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: '保留页' }));
  fireEvent.click(screen.getByRole('button', { name: '预览清理' }));
  expect(await screen.findByText('保留项 保留页')).toBeVisible();
  expect(screen.getByText('移除 重复页')).toBeVisible();
  expect(screen.getByText('标签并集 稍后、阅读')).toBeVisible();
  expect(screen.getByText('备注冲突 另一备注')).toBeVisible();
  expect(confirmCleanup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认清理' }));
  expect(confirmCleanup).toHaveBeenCalledWith('profile-a', 4, ['10', '11'], '10', true, false);
});

it('R07 cancels an in-flight link check, rejects its late result and can retry', async () => {
  let finish!: (value: MaintenanceReport) => void;
  vi.mocked(checkLinks).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(cancelLinkCheck).mockResolvedValue(undefined);
  render(<MaintenanceDesk profileId="profile-a" revision={4} live chromeIds={['10', '11']} />);
  fireEvent.click(screen.getByRole('button', { name: '检查链接' }));
  expect(screen.getByRole('button', { name: '取消检查' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '取消检查' }));
  expect(cancelLinkCheck).toHaveBeenCalledOnce();
  await act(async () => finish({ ...report(), links: [{ bookmarkId: 'bm-10', chromeId: '10', url: 'https://example.com/a', verdict: 'candidate', checks: 2, httpStatus: 404 }] }));
  expect(screen.queryByRole('list', { name: '链接检查结果' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '检查链接' })).toBeEnabled();
  expect(confirmCleanup).not.toHaveBeenCalled();
});

it('R07 duplicate inspection does not claim cached link rows were freshly checked', async () => {
  vi.mocked(inspectLibrary).mockResolvedValue({
    ...report(),
    duplicates: [],
    links: [{ bookmarkId: 'bm-10', chromeId: '10', url: 'https://example.com/a', verdict: 'unknown', checks: 0, httpStatus: null }],
  });
  render(<MaintenanceDesk profileId="profile-a" revision={4} live chromeIds={['10']} />);
  fireEvent.click(screen.getByRole('button', { name: '检查重复' }));
  expect(await screen.findByText('检查完成，没有重复候选。')).toBeVisible();
  expect(screen.queryByText('链接检查完成。')).not.toBeInTheDocument();
  expect(screen.getByText(/已有链接状态，本次没有重新检查网址/)).toBeVisible();
  expect(screen.getByText('尚未检查')).toBeVisible();
  expect(checkLinks).not.toHaveBeenCalled();
});

it('R07 shows 403, 429 and timeout as unknown and cannot confirm a stale or offline cleanup', async () => {
  vi.mocked(checkLinks).mockResolvedValue({ ...report(), links: [403, 429, null].map((httpStatus, index) => ({ bookmarkId: 'bm-' + index, chromeId: String(index), url: 'https://example.com/' + index, verdict: 'unknown', checks: 1, httpStatus })) });
  vi.mocked(inspectLibrary).mockResolvedValue(report());
  vi.mocked(previewCleanup).mockResolvedValue(preview());
  const view = render(<MaintenanceDesk profileId="profile-a" revision={4} live={false} chromeIds={['10', '11']} />);
  fireEvent.click(screen.getByRole('button', { name: '检查链接' }));
  expect(await screen.findAllByText('状态未知')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '检查重复' }));
  fireEvent.click(await screen.findByRole('radio', { name: '保留页' }));
  fireEvent.click(screen.getByRole('button', { name: '预览清理' }));
  await screen.findByText('保留项 保留页');
  expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  view.rerender(<MaintenanceDesk profileId="profile-a" revision={5} live chromeIds={['10', '11']} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled());
  expect(screen.getByText(/资料已变化/)).toBeVisible();
});

it('R07 ignores a preview returning after revision changes', async () => {
  let finish!: (value: MaintenanceReport) => void;
  vi.mocked(inspectLibrary).mockResolvedValue(report());
  vi.mocked(previewCleanup).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<MaintenanceDesk profileId="profile-a" revision={4} live chromeIds={['10', '11']} />);
  fireEvent.click(screen.getByRole('button', { name: '检查重复' }));
  fireEvent.click(await screen.findByRole('radio', { name: '保留页' }));
  fireEvent.click(screen.getByRole('button', { name: '预览清理' }));
  view.rerender(<MaintenanceDesk profileId="profile-a" revision={5} live chromeIds={['10', '11']} />);
  await act(async () => finish(preview()));
  expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  expect(screen.queryByText('保留项 保留页')).not.toBeInTheDocument();
});
