import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('shows the identity for desktop verification and clears the ticket before messaging', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = '<p id="status"></p><p id="details"></p><p id="error"></p><form id="pair-form"><textarea id="pairing-code"></textarea><button id="pair"></button></form>';
  const value = { state: 'unpaired', instanceId: 'synthetic-instance', profileId: null, nodeCount: 0, errorCode: null };
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'pair') {
      expect((document.querySelector('#pairing-code') as HTMLTextAreaElement).value).toBe('');
      return { errorCode: 'INVALID_MESSAGE' };
    }
    return value;
  });
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-origin', sendMessage } });
  await import('./main');
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('#details')).toHaveTextContent('synthetic-instance');
  expect(document.querySelector('#details')).toHaveTextContent('chrome-extension://synthetic-origin');
  (document.querySelector('#pairing-code') as HTMLTextAreaElement).value = 'synthetic-expired-ticket';
  document.querySelector('#pair-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.querySelector('#error')).toHaveTextContent('在桌面重新生成后粘贴');
  expect(document.body).not.toHaveTextContent('INVALID_MESSAGE');
  expect(sendMessage).toHaveBeenCalledWith({ type: 'pair', code: 'synthetic-expired-ticket' });
});

it('does not forget pairing before explicit confirmation and lets the user keep it', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = '<p id="status"></p><p id="details"></p><p id="error"></p><button id="forget"></button><div id="forget-confirm" hidden><button id="forget-cancel"></button><button id="forget-accept"></button></div>';
  const sendMessage = vi.fn(async () => ({ state: 'connected', instanceId: 'synthetic-instance', profileId: 'synthetic-profile', nodeCount: 1, errorCode: null }));
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-origin', sendMessage } });
  await import('./main');
  document.querySelector<HTMLButtonElement>('#forget')!.click();
  expect(document.querySelector('#forget-cancel')).toHaveFocus();
  expect(sendMessage).not.toHaveBeenCalledWith({ type: 'forget' });
  document.querySelector<HTMLButtonElement>('#forget-cancel')!.click();
  expect(document.querySelector('#forget-confirm')).not.toBeVisible();
  expect(document.querySelector('#forget')).toHaveFocus();
  document.querySelector<HTMLButtonElement>('#forget')!.click();
  document.querySelector<HTMLButtonElement>('#forget-accept')!.click();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'forget' });
  expect(document.querySelector('#forget')).toHaveFocus();
});

it('directs unpaired popup users to the actual pairing settings', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = '<p id="status"></p><p id="details"></p><button id="options"></button>';
  const openOptionsPage = vi.fn();
  vi.stubGlobal('chrome', { runtime: {
    id: 'synthetic-origin', openOptionsPage,
    sendMessage: vi.fn(async () => ({ state: 'unpaired', instanceId: 'synthetic-instance', profileId: null, nodeCount: 0, errorCode: null })),
  } });
  await import('./main');
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('#details')).toHaveTextContent('打开配对设置');
  expect(document.querySelector('#details')).not.toHaveTextContent('在此粘贴');
  document.querySelector<HTMLButtonElement>('#options')!.click();
  expect(openOptionsPage).toHaveBeenCalledOnce();
});
