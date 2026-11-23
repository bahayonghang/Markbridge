import './style.css';
import type { ExtensionStatus } from './bridge';
import { CAPTURE_FAILURE, captureActivePage } from './capture';

const labels: Record<ExtensionStatus['state'], string> = {
  connecting: '正在连接本机桌面',
  reconciling: '正在核对完整书签树 · 暂不可写',
  connected: '扩展已连接',
  paused: '同步已暂停',
  disconnected: '连接断开 · 桌面保留只读缓存',
  error: '连接错误',
};

const nextSteps: Record<ExtensionStatus['state'], string> = {
  connecting: '正在自动探测本机端口 49153–49160。请保持 Markbridge 桌面运行。',
  reconciling: '等待完整书签树核对完成。核对完成前不能修改书签。',
  connected: '以桌面“实时同步”状态为准。修改须先在桌面审查并确认。',
  paused: '已暂停自动重连。点击“重新连接”可恢复同步。',
  disconnected: '请打开 Markbridge 桌面，稍候将自动重连，或点击“重新连接”。离线修改不会排队。',
  error: '未能完成连接。请确认桌面端正常运行后点击“重新连接”。',
};

const status = document.querySelector<HTMLElement>('#status')!;
const details = document.querySelector<HTMLElement>('#details')!;
const writePaused = document.querySelector<HTMLElement>('#write-paused');
const error = document.querySelector<HTMLElement>('#error');
const pause = document.querySelector<HTMLButtonElement>('#pause');
let actionError = '';

function render(value: ExtensionStatus): void {
  status.textContent = labels[value.state];
  status.dataset.state = value.state;
  if (writePaused) writePaused.hidden = !value.writePaused;
  const ignoredNote = value.state === 'paused' && value.errorCode === 'PROFILE_IGNORED'
    ? '桌面端已忽略此资料，已停止自动重连；点击“重新连接”可恢复同步。'
    : '';
  const profileLine = value.displayName
    ? (value.profileId ? `资料：${value.displayName}（${value.profileId}）` : `资料：${value.displayName}`)
    : (value.profileId ? `资料：${value.profileId}` : '');
  const portLine = value.port != null ? `端口：127.0.0.1:${value.port}` : '';
  const nodeLine = value.profileId != null || value.state === 'connected' || value.nodeCount > 0
    ? `节点：${value.nodeCount}`
    : '';
  const writePausedLine = value.writePaused ? '写入保护：仅只读（桌面已暂停写入）' : '';
  details.textContent = [
    ignoredNote || nextSteps[value.state],
    profileLine,
    portLine,
    nodeLine,
    writePausedLine,
    value.instanceId ? `扩展身份：${value.instanceId}` : '',
    `扩展来源：chrome-extension://${chrome.runtime.id}`,
  ].filter(Boolean).join('\n');
  if (pause) pause.disabled = value.state === 'paused';
  if (error) {
    const hasFailure = value.state === 'error' || (value.errorCode != null && value.state !== 'paused');
    error.textContent = actionError || (hasFailure ? '连接未完成，请检查桌面端状态后点击“重新连接”。' : '');
  }
}

async function send(message: Record<string, unknown>): Promise<void> {
  if (message.type !== 'status') actionError = '';
  try {
    const value = await chrome.runtime.sendMessage(message) as ExtensionStatus | { errorCode: string };
    if ('state' in value) render(value);
    else if (error) {
      actionError = '操作未完成，请检查桌面端状态后重试。';
      error.textContent = actionError;
    }
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
document.querySelector('#reconnect')?.addEventListener('click', () => { void send({ type: 'reconnect' }); });
document.querySelector('#pause')?.addEventListener('click', () => { void send({ type: 'pause' }); });

void send({ type: 'status' });
setInterval(() => { void send({ type: 'status' }); }, 1000);
