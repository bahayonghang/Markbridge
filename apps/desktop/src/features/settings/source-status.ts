import type { BridgeState } from '@markbridge/protocol';

export type SourceTarget = { kind: 'profile' | 'mirror'; id: string };
export type SourceRequest = SourceTarget & { request: number };
export const connectionLabels: Record<BridgeState['profiles'][number]['connection'], string> = {
  unpaired: '未配对 · 只读', connecting: '连接中 · 只读', reconciling: '核对中 · 只读',
  live: '实时同步', cached_read_only: '缓存 · 只读', error: '连接错误 · 只读',
};
export const fileLabels: Record<BridgeState['mirrors'][number]['fileStatus'], string> = {
  current: '文件已同步', stale: '文件陈旧 · 保留缓存', unavailable: '文件不可用 · 保留缓存',
};
export function profileNextStep(connection: BridgeState['profiles'][number]['connection']): string {
  switch (connection) {
    case 'live': return '已完成全树核对。写入 Chrome 前仍需审查并确认。';
    case 'unpaired': return '此资料已取消配对。缓存可继续浏览；要恢复连接，请生成新的配对串。';
    case 'connecting': return '请保持 Chrome 与扩展运行，等待连接。若没有进展，可在扩展选项页重新连接。';
    case 'reconciling': return '正在核对完整书签树。核对完成前不能写入，请等待状态变为实时同步。';
    case 'cached_read_only': return '请打开此资料所在的 Chrome 并启用扩展，然后重新连接。离线操作不会排队或自动回放。';
    case 'error': return '请检查此资料的扩展连接状态，再重新连接。缓存仍可浏览，未发送的修改不会排队。';
  }
}
export function cacheTime(time: number | null): string {
  return time === null ? '尚无同步时间' : new Date(time).toLocaleString('zh-CN', { hour12: false });
}
