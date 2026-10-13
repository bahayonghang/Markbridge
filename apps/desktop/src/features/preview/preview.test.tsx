import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ContentPreview } from '@markbridge/protocol';
import { ContentPreviewPanel } from './ContentPreview';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const gif = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function preview(patch: Partial<ContentPreview> & Pick<ContentPreview, 'requestId' | 'chromeId' | 'status'>): ContentPreview {
  return {
    profileId: 'profile-a',
    bookmarkId: 'bookmark-a',
    title: null,
    summary: null,
    summarySource: null,
    image: null,
    imageFailure: null,
    imageFailureMessage: null,
    fetchedAt: null,
    cacheLabel: null,
    failure: null,
    failureMessage: null,
    ...patch,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.mocked(isTauri).mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it('shows a title, a description summary, and a source image', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    if (command === 'cancel_content_preview') return null;
    const requestId = String((raw as { requestId?: string }).requestId);
    return preview({
      requestId, chromeId: '10', status: 'ready', title: 'Page A', summary: '摘要 A', summarySource: 'description',
      image: { mediaType: 'image/gif', dataBase64: gif, sourceLabel: 'og:image' },
    });
  });
  render(<ContentPreviewPanel profileId="profile-a" chromeId="10" url="https://allowed.test/a" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('Page A')).toBeVisible();
  expect(screen.getByText('摘要 A')).toBeVisible();
  expect(screen.getByRole('img', { name: '来源图片 og:image' })).toHaveAttribute('src', `data:image/gif;base64,${gif}`);
  expect(screen.queryByText('没有来源图片')).toBeNull();
});

it('shows an empty image state and a failure reason', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    if (command === 'cancel_content_preview') return null;
    const requestId = String((raw as { requestId?: string } | undefined)?.requestId);
    return preview({ requestId, chromeId: '11', status: 'ready', title: 'No Image', summary: '只有文字', summarySource: 'description' });
  });
  const view = render(<ContentPreviewPanel profileId="profile-a" chromeId="11" url="https://allowed.test/b" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('没有来源图片')).toBeVisible();
  view.rerender(<ContentPreviewPanel profileId="profile-a" chromeId="12" url="https://allowed.test/missing" />);
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    if (command === 'cancel_content_preview') return null;
    const requestId = (raw as { requestId?: string }).requestId ?? 'pv1';
    return preview({ requestId, chromeId: '12', status: 'failed', failure: 'TIMED_OUT', failureMessage: '抓取超过 10 秒' });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('抓取超过 10 秒')).toBeVisible();
  expect(screen.queryByText('No Image')).toBeNull();
});

it('keeps the latest selection when older previews resolve late', async () => {
  const pending = new Map<string, (value: ContentPreview) => void>();
  vi.mocked(invoke).mockImplementation((command: string, raw?: unknown) => {
    if (command === 'cancel_content_preview') return Promise.resolve(null);
    const args = raw as { requestId: string; chromeId: string };
    return new Promise<ContentPreview>((resolve) => { pending.set(args.requestId, resolve); });
  });
  const view = render(<ContentPreviewPanel profileId="profile-a" chromeId="10" url="https://allowed.test/a" />);
  for (let index = 0; index < 20; index += 1) {
    const chromeId = index % 2 === 0 ? '10' : '11';
    const url = chromeId === '10' ? 'https://allowed.test/a' : 'https://allowed.test/b';
    view.rerender(<ContentPreviewPanel profileId="profile-a" chromeId={chromeId} url={url} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  }
  const entries = [...pending.entries()];
  expect(entries.length).toBeGreaterThanOrEqual(20);
  const last = entries[entries.length - 1];
  for (const [requestId, resolve] of entries.slice(0, -1)) {
    resolve(preview({ requestId, chromeId: '10', status: 'ready', title: `旧标题 ${requestId}`, summary: '旧摘要' }));
  }
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText(/旧标题/)).toBeNull();
  last[1](preview({ requestId: last[0], chromeId: '11', status: 'ready', title: 'No Image', summary: '只有文字' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('No Image')).toBeVisible();
  expect(screen.queryByText(/旧标题/)).toBeNull();
});

it('shows a cache time label and ignores a cancelled payload', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string, raw?: unknown) => {
    if (command === 'cancel_content_preview') return null;
    const requestId = String((raw as { requestId?: string }).requestId);
    return preview({
      requestId, chromeId: '11', status: 'cached', title: 'No Image', summary: '只有文字',
      cacheLabel: '离线缓存 · 1970-01-01 00:00 UTC', fetchedAt: 0,
    });
  });
  render(<ContentPreviewPanel profileId="profile-a" chromeId="11" url="https://allowed.test/b" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('离线缓存 · 1970-01-01 00:00 UTC')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByText('已取消')).toBeVisible();
  expect(screen.queryByText('No Image')).toBeNull();
  expect(invoke).toHaveBeenCalledWith('cancel_content_preview', expect.objectContaining({ requestId: expect.stringMatching(/^pv\d+$/) }));
});

it('does not fetch a non-http bookmark url', async () => {
  render(<ContentPreviewPanel profileId="profile-a" chromeId="26" url="javascript:alert(1)" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText('仅预览 http 或 https 页面')).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'content_preview')).toBe(false);
});

it('R05 cancels on unmount and cancels a request before the debounce has fired', async () => {
  vi.mocked(invoke).mockImplementation(async () => null);
  const first = render(<ContentPreviewPanel profileId="profile-a" chromeId="10" url="https://allowed.test/a" />);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(invoke).not.toHaveBeenCalledWith('content_preview', expect.anything());
  first.unmount();
  const second = render(<ContentPreviewPanel profileId="profile-a" chromeId="10" url="https://allowed.test/a" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  second.unmount();
  expect(invoke).toHaveBeenCalledWith('cancel_content_preview', expect.objectContaining({ requestId: expect.stringMatching(/^pv\d+$/) }));
});

it('R05 renders cached untrusted text without injecting markup', async () => {
  const payload = '<img src=x onerror="alert(1)"><script>bad()</script>';
  vi.mocked(invoke).mockImplementation(async (command, raw) => command === 'content_preview' ? preview({ requestId: (raw as { requestId: string }).requestId, chromeId: '10', status: 'cached', title: '缓存页面', summary: payload, fetchedAt: 1791800000000 }) : null);
  render(<ContentPreviewPanel profileId="profile-a" chromeId="10" url="https://allowed.test/a" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(screen.getByText(payload)).toBeVisible();
  expect(screen.getByText(/离线缓存/)).toHaveTextContent('2026');
  expect(document.querySelector('.content-preview script, .content-preview img')).toBeNull();
});
