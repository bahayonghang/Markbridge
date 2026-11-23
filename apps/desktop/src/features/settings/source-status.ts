import type { BridgeState } from '@markbridge/protocol';

export type Profile = BridgeState['profiles'][number];
export type Mirror = BridgeState['mirrors'][number];
export type Source = { kind: 'profile'; id: string; profile: Profile } | { kind: 'mirror'; id: string; mirror: Mirror };
export type SourceTarget = { kind: 'profile' | 'mirror'; id: string };
export type SourceRequest = SourceTarget & { request: number };

export const connectionLabels: Record<Profile['connection'], string> = {
  ignored: '已忽略 · 只读',
  connecting: '连接中 · 只读',
  reconciling: '核对中 · 只读',
  live: '实时同步',
  cached_read_only: '缓存 · 只读',
  local: '本地书签库',
  error: '连接错误 · 只读',
};

export const fileLabels: Record<Mirror['fileStatus'], string> = {
  current: '文件已同步',
  stale: '文件陈旧 · 保留缓存',
  unavailable: '文件不可用 · 保留缓存',
};

export function sourceFromToken(token: string, profiles: Profile[], mirrors: Mirror[]): Source | null {
  const profileId = token.startsWith('profile:') ? token.slice('profile:'.length) : '';
  const mirrorId = token.startsWith('mirror:') ? token.slice('mirror:'.length) : '';
  const profile = profiles.find((item) => item.profileId === profileId);
  if (profile) return { kind: 'profile', id: profile.profileId, profile };
  const mirror = mirrors.find((item) => item.mirrorSourceId === mirrorId);
  if (mirror) return { kind: 'mirror', id: mirror.mirrorSourceId, mirror };
  return null;
}

export function resolveSource(state: BridgeState | null, manual: string | null, focusMirrorId: string | null): Source | null {
  const profiles = state?.profiles ?? [];
  const mirrors = state?.mirrors ?? [];
  const tokens = [manual, focusMirrorId ? `mirror:${focusMirrorId}` : null];
  for (const token of tokens) {
    if (!token) continue;
    const source = sourceFromToken(token, profiles, mirrors);
    if (source) return source;
  }
  const activeLive = profiles.find((item) => !item.ignored && item.connection === 'live');
  if (activeLive) return { kind: 'profile', id: activeLive.profileId, profile: activeLive };
  const nonIgnored = profiles.find((item) => !item.ignored && item.connection !== 'ignored');
  if (nonIgnored) return { kind: 'profile', id: nonIgnored.profileId, profile: nonIgnored };
  if (profiles[0]) return { kind: 'profile', id: profiles[0].profileId, profile: profiles[0] };
  if (mirrors[0]) return { kind: 'mirror', id: mirrors[0].mirrorSourceId, mirror: mirrors[0] };
  return null;
}

export function profileNextStep(connection: Profile['connection'], writePaused = false): string {
  if (connection === 'live' && writePaused) {
    return '保持实时同步，已阻断写入 Chrome；本机标签与备注仍可编辑。';
  }
  switch (connection) {
    case 'live': return '已完成全树核对。写入 Chrome 前仍需审查并确认。';
    case 'local': return '本地专属书签库，由本机 SQLite 直接维护，不会同步或写回 Chrome。';
    case 'ignored': return '此资料已断开并忽略。缓存可继续浏览；点击「恢复连接」或在扩展中重新连接可恢复同步。';
    case 'connecting': return '正在建立本地连接并准备同步，请保持 Chrome 与扩展运行。';
    case 'reconciling': return '正在核对完整书签树。核对完成前不能写入，请等待状态变为实时同步。';
    case 'cached_read_only': return '请打开此资料所在的 Chrome 并启用扩展，扩展将自动探测本地端口恢复连接；也可点击「重新连接」。离线修改不会排队或自动回放。';
    case 'error': return '请检查此资料的扩展连接状态，再点击「重新连接」。缓存仍可浏览，未发送的修改不会排队。';
  }
}

export function listenerErrorMessage(errorCode: BridgeState['errorCode']): string {
  if (errorCode === 'PORT_EXHAUSTED') {
    return '本地端口 49153–49160 均已被占用，无法建立连接。请关闭占用端口的程序后点击「重试监听」。';
  }
  if (errorCode === 'CONFLICT') {
    return '本地端口监听发生冲突。请检查端口 49153–49160 是否被占用后点击「重试监听」。';
  }
  if (errorCode === 'STORAGE_ERROR') {
    return '本机存储不可用。请检查缓存权限及系统凭据服务是否已解锁，再重试。';
  }
  return '本地连接监听尚未启动。请点击「重试监听」尝试绑定可用端口。';
}

export function listenerPillLabel(errorCode: BridgeState['errorCode']): string {
  if (errorCode === 'PORT_EXHAUSTED') return '端口已占满 · 只读';
  if (errorCode === 'CONFLICT') return '监听冲突 · 只读';
  return '监听异常 · 只读';
}

export function connectionStatusLabels(
  state: BridgeState | null,
  error: 'startup' | 'event' | null,
  selectedProfile: Profile | undefined,
  selectedMirror: Mirror | undefined,
): { header: string; pill: string } {
  if (error === 'startup') return { header: '启动失败', pill: '启动失败' };
  if (error === 'event') return { header: '连接错误 · 只读', pill: '连接错误 · 只读' };
  if (!state) return { header: '正在加载', pill: '正在加载' };

  const listenerFault = state.port == null && state.errorCode != null;
  const liveCount = state.profiles.filter((item) => !item.ignored && item.connection === 'live').length;

  if (selectedProfile) {
    if (selectedProfile.ignored || selectedProfile.connection === 'ignored') {
      return { header: '已忽略 · 只读', pill: '已忽略 · 只读' };
    }
    if (selectedProfile.connection === 'live') {
      if (selectedProfile.writePaused) {
        return { header: '已暂停写入 · 只读', pill: '已暂停写入 · 只读' };
      }
      return {
        header: '已连接 Chrome',
        pill: liveCount > 1 ? `已连接 Chrome（${liveCount} 个）` : '已连接 Chrome',
      };
    }
    const header = selectedProfile.connection === 'cached_read_only' ? '未连接 · 只读' : connectionLabels[selectedProfile.connection];
    return { header, pill: listenerFault ? listenerPillLabel(state.errorCode) : header };
  }

  if (selectedMirror) {
    const header = `${fileLabels[selectedMirror.fileStatus]} · 只读`;
    return { header, pill: listenerFault ? listenerPillLabel(state.errorCode) : header };
  }

  if (listenerFault) {
    const label = listenerPillLabel(state.errorCode);
    return { header: label, pill: label };
  }
  if (state.port != null) {
    const label = `监听就绪 · :${state.port}`;
    return { header: label, pill: label };
  }
  return { header: '未连接 · 只读', pill: '未连接 · 只读' };
}

export function cacheTime(time: number | null): string {
  return time === null ? '尚无同步时间' : new Date(time).toLocaleString('zh-CN', { hour12: false });
}
