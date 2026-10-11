import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { WebPreviewState } from '@markbridge/protocol';
import { WebPreviewPanel } from './WebPreview';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

function state(patch: Partial<WebPreviewState> = {}): WebPreviewState {
  return {
    requestId: null, profileId: null, chromeId: null, url: null, currentUrl: null, phase: 'closed',
    canGoBack: false, canGoForward: false, notice: null, noticeMessage: null, ...patch,
  };
}

function panel(url: string | null = 'https://example.com/a', profileId = 'profile-a', profileName = '资料 A') {
  return render(<WebPreviewPanel profileId={profileId} profileName={profileName} chromeId="10" url={url} native />);
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'web_preview_state') return state();
    return state();
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('names the profile and selected url before opening the page', async () => {
  panel();
  expect(await screen.findByText('当前资料：资料 A')).toBeVisible();
  expect(screen.getByText('选中网址：https://example.com/a')).toBeVisible();
  expect(screen.getByText(/不读取 Chrome 的登录状态/)).toBeVisible();
  expect(screen.getByText(/关闭预览窗口后，当前资料的预览会话会保留/)).toBeVisible();
  expect(screen.getByRole('button', { name: '后退' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '前进' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '打开应用内网页' }));
  expect(invoke).toHaveBeenCalledWith('open_web_preview', expect.objectContaining({
    profileId: 'profile-a', chromeId: '10', url: 'https://example.com/a', requestId: expect.stringMatching(/^wp\d+$/),
  }));
});

it('enables history controls only for the open window of this profile', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'web_preview_state') {
      return state({
        profileId: 'profile-a', chromeId: '10', phase: 'ready', url: 'https://example.com/a',
        currentUrl: 'https://example.com/next', canGoBack: true, canGoForward: true,
      });
    }
    if (command === 'web_preview_action') {
      return state({
        profileId: 'profile-a', phase: 'ready', url: 'https://example.com/a',
        currentUrl: 'https://example.com/next', canGoBack: true, canGoForward: true,
      });
    }
    return state();
  });
  panel();
  expect(await screen.findByText('预览窗口网址：https://example.com/next')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '后退' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '前进' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '前进' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(invoke).toHaveBeenCalledWith('web_preview_action', { action: 'back' });
  expect(invoke).toHaveBeenCalledWith('web_preview_action', { action: 'forward' });
  expect(invoke).toHaveBeenCalledWith('web_preview_action', { action: 'reload' });
});

it('shows a chrome fallback when the webview cannot load the site', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'open_http_url') return null;
    return state({
      profileId: 'profile-a', phase: 'failed', url: 'https://example.com/a',
      notice: 'LOAD_FAILED', noticeMessage: '应用内网页没有打开。可以改用 Chrome。',
    });
  });
  panel();
  expect(await screen.findByText(/可以转到 Chrome/)).toBeVisible();
  expect(screen.getByText('应用内网页没有打开。可以改用 Chrome。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '在 Chrome 中打开' }));
  expect(invoke).toHaveBeenCalledWith('open_http_url', { url: 'https://example.com/a' });
});

it('does not open a non-http bookmark in the preview window', () => {
  panel('javascript:alert(1)');
  expect(screen.getByRole('button', { name: '打开应用内网页' })).toBeDisabled();
  expect(screen.getByText('仅打开 http 或 https 链接。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '打开应用内网页' }));
  expect(invoke).not.toHaveBeenCalledWith('open_web_preview', expect.anything());
});

it('clears the profile session only after confirmation', async () => {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'clear_web_preview_session') {
      return state({ profileId: 'profile-a', phase: 'closed', notice: 'SESSION_CLEARED', noticeMessage: '已清除此资料的预览会话' });
    }
    return state();
  });
  panel();
  fireEvent.click(await screen.findByRole('button', { name: '清除此资料的预览会话' }));
  expect(invoke).not.toHaveBeenCalledWith('clear_web_preview_session', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: '确认清除预览会话' }));
  expect(invoke).toHaveBeenCalledWith('clear_web_preview_session', expect.objectContaining({
    profileId: 'profile-a', requestId: expect.stringMatching(/^wp\d+$/),
  }));
  expect(await screen.findByText('已清除此资料的预览会话')).toBeVisible();
});

it('ignores a late open after a newer close', async () => {
  let resolveOpen: ((value: WebPreviewState) => void) | undefined;
  const openWindow = state({ phase: 'ready', profileId: 'profile-a', url: 'https://example.com/a', currentUrl: 'https://example.com/a' });
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === 'open_web_preview') return new Promise<WebPreviewState>((resolve) => { resolveOpen = resolve; });
    if (command === 'web_preview_action') return Promise.resolve(state({ phase: 'closed', profileId: 'profile-a' }));
    return Promise.resolve(openWindow);
  });
  panel();
  expect(await screen.findByText('应用内网页已打开')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '打开应用内网页' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  await act(async () => { resolveOpen?.(state({ phase: 'ready', profileId: 'profile-a', url: 'https://example.com/late', currentUrl: 'https://example.com/late' })); });
  expect(screen.queryByText('预览窗口网址：https://example.com/late')).toBeNull();
  expect(screen.getByText('尚未打开应用内网页。')).toBeVisible();
});

it('shows an event for another profile without treating it as the selection', async () => {
  let emit: (payload: unknown) => void = () => {};
  vi.mocked(listen).mockImplementation(async (_name, handler) => {
    emit = (payload) => { handler({ event: 'web-preview', id: 1, payload }); };
    return () => {};
  });
  panel();
  await screen.findByText('尚未打开应用内网页。');
  act(() => {
    emit(state({ profileId: 'profile-b', phase: 'ready', url: 'https://example.com/b', currentUrl: 'https://example.com/b' }));
  });
  expect(screen.getByText('预览窗口当前属于另一个资料。')).toBeVisible();
  expect(screen.getByText('选中网址：https://example.com/a')).toBeVisible();
  expect(screen.getByRole('button', { name: '后退' })).toBeDisabled();
});
