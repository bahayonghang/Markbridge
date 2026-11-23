import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ExtensionStatus } from './bridge';
import { CAPTURE_FAILURE } from './capture';

const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const optionsHtml = readFileSync(resolve(__dirname, '../options.html'), 'utf8');

function mountBody(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('extension status UI (popup & options)', () => {
  it('removes all legacy pairing inputs, forget confirms, and 120s copy from index.html and options.html', () => {
    for (const html of [indexHtml, optionsHtml]) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const selector of ['#pair-form', '#pairing-code', '#pair', '#forget', '#forget-confirm', '#forget-cancel', '#forget-accept']) {
        expect(doc.querySelector(selector)).toBeNull();
      }
      expect(html).not.toMatch(/120\s*秒|配对串|开始配对|清除本机配对|打开配对设置/);
      expect(doc.querySelector('#status')).not.toBeNull();
      expect(doc.querySelector('#details')).not.toBeNull();
      expect(doc.querySelector('#reconnect')).not.toBeNull();
      expect(doc.querySelector('#pause')).not.toBeNull();
    }
    const popupDoc = new DOMParser().parseFromString(indexHtml, 'text/html');
    expect(popupDoc.querySelector('#capture')).not.toBeNull();
    expect(popupDoc.querySelector('#capture-result')).not.toBeNull();
    const optionsDoc = new DOMParser().parseFromString(optionsHtml, 'text/html');
    expect(optionsDoc.querySelector('#capture')).toBeNull();
  });

  it('renders connected profile displayName, 127.0.0.1:<port>, nodeCount, and writePaused indicator', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mountBody(indexHtml);
    const liveStatus: ExtensionStatus = {
      state: 'connected',
      profileId: 'p-1',
      displayName: '工作资料',
      instanceId: 'synthetic-instance',
      port: 49155,
      nodeCount: 42,
      writePaused: true,
      errorCode: null,
    };
    const sendMessage = vi.fn(async () => liveStatus);
    vi.stubGlobal('chrome', { runtime: { id: 'synthetic-origin', sendMessage, openOptionsPage: vi.fn() } });
    await import('./main');
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('#status')).toHaveTextContent('已连接');
    expect(document.querySelector('#details')).toHaveTextContent('工作资料');
    expect(document.querySelector('#details')).toHaveTextContent('127.0.0.1:49155');
    expect(document.querySelector('#details')).toHaveTextContent('42');
    expect(document.querySelector('#write-paused')).toBeVisible();
    expect(document.querySelector('#details')).toHaveTextContent('只读');
    expect(document.querySelector('#pause')).not.toBeDisabled();
  });

  it('renders connecting, paused, disconnected, and error states cleanly and triggers #reconnect / #pause', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mountBody(optionsHtml);

    let current: ExtensionStatus = {
      state: 'connecting',
      profileId: null,
      displayName: null,
      instanceId: 'synthetic-instance',
      port: 49153,
      nodeCount: 0,
      writePaused: false,
      errorCode: null,
    };
    const sendMessage = vi.fn(async (msg: { type: string }) => {
      if (msg.type === 'pause') {
        current = {
          ...current,
          state: 'paused',
          port: null,
          profileId: 'p-1',
          displayName: 'Chrome 资料 1',
          errorCode: null,
        };
      } else if (msg.type === 'reconnect') {
        current = {
          ...current,
          state: 'connected',
          port: 49156,
          profileId: 'p-1',
          displayName: 'Chrome 资料 1',
          nodeCount: 15,
          writePaused: false,
          errorCode: null,
        };
      }
      return current;
    });
    vi.stubGlobal('chrome', { runtime: { id: 'synthetic-origin', sendMessage } });
    await import('./main');
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('#status')).toHaveTextContent('正在连接');
    expect(document.querySelector('#details')).toHaveTextContent('127.0.0.1:49153');
    expect(document.querySelector('#write-paused')).not.toBeVisible();

    document.querySelector<HTMLButtonElement>('#pause')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pause' });
    expect(document.querySelector('#status')).toHaveTextContent('已暂停');
    expect(document.querySelector('#pause')).toBeDisabled();
    expect(document.querySelector('#details')).not.toHaveTextContent('127.0.0.1:');

    document.querySelector<HTMLButtonElement>('#reconnect')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'reconnect' });
    expect(document.querySelector('#status')).toHaveTextContent('已连接');
    expect(document.querySelector('#details')).toHaveTextContent('127.0.0.1:49156');
    expect(document.querySelector('#details')).toHaveTextContent('15');
    expect(document.querySelector('#pause')).not.toBeDisabled();

    // Error state shows safe guidance without leaking raw pairing copy.
    current = {
      ...current,
      state: 'error',
      port: null,
      errorCode: 'WRONG_PROFILE',
    };
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('#status')).toHaveTextContent('连接错误');
    expect(document.querySelector('#error')).not.toBeEmptyDOMElement();
    expect(document.body.textContent).not.toMatch(/配对串|120\s*秒|WRONG_PROFILE/);
  });

  it('preserves active-tab page capture in popup without failing when options omits #capture', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mountBody(indexHtml);
    const executeScript = vi.fn(async () => [{ result: { title: '示例标题', text: '页面正文' } }]);
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'synthetic-origin',
        sendMessage: vi.fn(async () => ({
          state: 'disconnected',
          profileId: null,
          displayName: null,
          instanceId: 'synthetic-instance',
          port: null,
          nodeCount: 0,
          writePaused: false,
          errorCode: null,
        } satisfies ExtensionStatus)),
        openOptionsPage: vi.fn(),
      },
      tabs: { query: vi.fn(async () => [{ id: 12 }]) },
      scripting: { executeScript },
    });
    await import('./main');
    await vi.advanceTimersByTimeAsync(0);

    document.querySelector<HTMLButtonElement>('#capture')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#capture-result')).toHaveTextContent('示例标题');
    expect(document.querySelector('#capture-result')).toHaveTextContent('页面正文');

    executeScript.mockRejectedValueOnce(new Error('denied'));
    document.querySelector<HTMLButtonElement>('#capture')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#capture-result')).toHaveTextContent(CAPTURE_FAILURE);
  });
});
