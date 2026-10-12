import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MaintenanceReport } from '@markbridge/protocol';
import { confirmCleanup, inspectLibrary, previewCleanup, searchLibraryText } from '../../backend';
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

afterEach(() => cleanup());

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
