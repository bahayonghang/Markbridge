import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_FAILURE, captureActivePage, extractVisibleText } from './capture';

afterEach(() => { document.title = ''; document.body.replaceChildren(); });

describe('active page capture', () => {
  it('reads visible text and skips scripts, inputs, cookies, and other tabs', async () => {
    document.title = '当前页';
    document.cookie = 'session=secret-cookie';
    document.body.innerHTML = '<p>可见正文</p><script>secret()</script><input type="password" value="secret-password"><textarea>hidden-note</textarea>';
    const password = document.querySelector('input');
    if (password) password.value = 'secret-password';
    const page = extractVisibleText();
    expect(page).toEqual({ title: '当前页', text: '可见正文' });
    expect(page.text).not.toContain('secret');
    expect(JSON.stringify(page)).not.toContain('secret-cookie');
    expect(JSON.stringify(page)).not.toContain('http');

    const executed: number[] = [];
    const captured = await captureActivePage({
      tabs: { query: async () => [{ id: 7 }, { id: 8 }] },
      scripting: { executeScript: async (details) => { executed.push(details.target.tabId); return [{ result: page }]; } },
    }).catch((error: Error) => error);
    expect(captured).toMatchObject({ message: 'CAPTURE_UNAVAILABLE' });
    expect(executed).toEqual([]);

    const once = await captureActivePage({
      tabs: { query: async () => [{ id: 7 }] },
      scripting: { executeScript: async (details) => { executed.push(details.target.tabId); return [{ result: extractVisibleText() }]; } },
    });
    expect(once.text).toBe('可见正文');
    expect(executed).toEqual([7]);
    expect(extractVisibleText.toString()).not.toContain('cookie');
    expect(extractVisibleText.toString()).not.toContain('.value');
    const isolated = new Function('document', 'Node', `return (${extractVisibleText.toString()})()`);
    const nodeType = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
    const body = { nodeType: 1, tagName: 'BODY', childNodes: [
      { nodeType: 3, textContent: '可见正文' },
      { nodeType: 1, tagName: 'INPUT', childNodes: [{ nodeType: 3, textContent: 'secret-password' }] },
    ] };
    expect(isolated({ title: '当前页', body }, nodeType)).toEqual({ title: '当前页', text: '可见正文' });
    expect(CAPTURE_FAILURE).toBe('未能采集当前页。请在要采集的标签页上打开扩展后再试。');
  });
});
