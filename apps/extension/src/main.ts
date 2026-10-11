import './style.css';
import type { ExtensionStatus } from './bridge';
import { CAPTURE_FAILURE, captureActivePage } from './capture';

const labels: Record<ExtensionStatus['state'], string> = {
  unpaired: '未配对', connecting: '正在连接本机桌面', pending: '等待桌面确认扩展身份',
  reconciling: '正在核对完整书签树', connected: '已连接 · 只读同步', disconnected: '连接断开 · 桌面保留只读缓存', error: '连接错误',
};
const status = document.querySelector<HTMLElement>('#status')!;
const details = document.querySelector<HTMLElement>('#details')!;
const error = document.querySelector<HTMLElement>('#error');
const pair = document.querySelector<HTMLButtonElement>('#pair');

function render(value: ExtensionStatus): void {
  status.textContent = labels[value.state];
  details.textContent = value.profileId ? `资料：${value.profileId} · 节点：${value.nodeCount}` : '';
  if (error) error.textContent = value.errorCode ? `错误代码：${value.errorCode}。请检查桌面连接设置。` : '';
  if (pair) pair.disabled = !['unpaired', 'error'].includes(value.state);
}
async function send(message: Record<string, unknown>): Promise<void> {
  try {
    const value = await chrome.runtime.sendMessage(message) as ExtensionStatus | { errorCode: string };
    if ('state' in value) render(value);
    else if (error) error.textContent = '操作失败。请检查配对串是否有效。';
  } catch {
    status.textContent = '扩展连接不可用';
    if (error) error.textContent = '请重新加载扩展后重试。';
  }
}
document.querySelector('#options')?.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
document.querySelector('#capture')?.addEventListener('click', () => {
  const output = document.querySelector<HTMLElement>('#capture-result');
  if (!output) return;
  output.textContent = '';
  void captureActivePage(chrome).then(
    (page) => { output.textContent = page.title ? `${page.title}\n${page.text}` : page.text; },
    () => { output.textContent = CAPTURE_FAILURE; },
  );
});
document.querySelector('#pair-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector<HTMLTextAreaElement>('#pairing-code')!;
  const code = input.value.trim(); input.value = '';
  void send({ type: 'pair', code });
});
document.querySelector('#reconnect')?.addEventListener('click', () => { void send({ type: 'reconnect' }); });
document.querySelector('#forget')?.addEventListener('click', () => { void send({ type: 'forget' }); });
void send({ type: 'status' });
setInterval(() => { void send({ type: 'status' }); }, 1000);
