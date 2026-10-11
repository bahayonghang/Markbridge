export const CAPTURE_FAILURE = '未能采集当前页。请在要采集的标签页上打开扩展后再试。';

export interface PageCapture {
  title: string;
  text: string;
}

export function extractVisibleText(): PageCapture {
  const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT']);
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      if (value.trim()) parts.push(value);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (skipped.has(element.tagName)) return;
    for (const child of element.childNodes) visit(child);
  };
  if (document.body) visit(document.body);
  return { title: document.title, text: parts.join(' ').replace(/\s+/g, ' ').trim() };
}

interface CaptureApi {
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>> };
  scripting: { executeScript(details: { target: { tabId: number }; func: typeof extractVisibleText }): Promise<Array<{ result?: PageCapture }>> };
}

export async function captureActivePage(api: CaptureApi): Promise<PageCapture> {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs.length === 1 ? tabs[0]?.id : undefined;
  if (tabId == null) throw new Error('CAPTURE_UNAVAILABLE');
  const [injected] = await api.scripting.executeScript({ target: { tabId }, func: extractVisibleText });
  const result = injected?.result;
  if (!result || typeof result.title !== 'string' || typeof result.text !== 'string') throw new Error('CAPTURE_UNAVAILABLE');
  return { title: result.title, text: result.text };
}
