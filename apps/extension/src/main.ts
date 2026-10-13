import './style.css';
import type { ExtensionStatus } from './bridge';
import { CAPTURE_FAILURE, captureActivePage } from './capture';

const labels: Record<ExtensionStatus['state'], string> = {
  unpaired: '未配对', connecting: '正在连接本机桌面', pending: '等待桌面确认扩展身份',
  reconciling: '正在核对完整书签树 · 暂不可写', connected: '扩展已连接', disconnected: '连接断开 · 桌面保留只读缓存', error: '连接错误',
};
const status = document.querySelector<HTMLElement>('#status')!;
const details = document.querySelector<HTMLElement>('#details')!;
const error = document.querySelector<HTMLElement>('#error');
const pair = document.querySelector<HTMLButtonElement>('#pair');
let actionError = '';
const nextSteps: Record<ExtensionStatus['state'], string> = {
  unpaired: pair ? '请在桌面启动连接并生成配对串，然后在此粘贴。' : '请在桌面启动连接并生成配对串，再点击“打开配对设置”粘贴。',
  connecting: '请保持桌面运行，检查桌面的本机连接已启动。',
  pending: '请回到桌面核对下方扩展身份，再点击“确认此扩展”。',
  reconciling: '等待完整书签树核对完成。核对完成前不能修改书签。',
  connected: '以桌面“实时同步”状态为准。修改须先在桌面审查并确认。',
  disconnected: '请打开 Markbridge 桌面，然后重新连接。离线修改不会排队。',
  error: '配对串可能已到期或被取消。请在桌面重新生成；若已有配对，先尝试重新连接。',
};

function render(value: ExtensionStatus): void {
  status.textContent = labels[value.state];
  details.textContent = [nextSteps[value.state], value.instanceId ? `扩展身份：${value.instanceId}` : '', `扩展来源：chrome-extension://${chrome.runtime.id}`, value.profileId ? `资料：${value.profileId} · 节点：${value.nodeCount}` : ''].filter(Boolean).join('\n');
  if (error) error.textContent = actionError || (value.errorCode ? '连接未完成。请检查桌面提示，必要时重新生成配对串。' : '');
  if (pair) pair.disabled = !['unpaired', 'error'].includes(value.state);
}
async function send(message: Record<string, unknown>): Promise<void> {
  if (message.type !== 'status') actionError = '';
  try {
    const value = await chrome.runtime.sendMessage(message) as ExtensionStatus | { errorCode: string };
    if ('state' in value) render(value);
    else if (error) { actionError = '操作未完成。配对串可能已到期或无效，请在桌面重新生成后粘贴。'; error.textContent = actionError; }
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
document.querySelector('#forget')?.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#forget-confirm')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#forget-cancel')?.focus();
});
document.querySelector('#forget-cancel')?.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#forget-confirm')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#forget')?.focus();
});
document.querySelector('#forget-accept')?.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#forget-confirm')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#forget')?.focus();
  void send({ type: 'forget' });
});
void send({ type: 'status' });
setInterval(() => { void send({ type: 'status' }); }, 1000);
