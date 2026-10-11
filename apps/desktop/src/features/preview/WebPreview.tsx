import { useEffect, useRef, useState } from 'react';
import type { WebPreviewState } from '@markbridge/protocol';
import {
  clearWebPreviewSession, openHttpUrl, openWebPreview, subscribeWebPreview, webPreviewAction, webPreviewState,
} from '../../backend';
import { isHttpUrl } from '../library/model';

let nextRequest = 0;

function closedState(): WebPreviewState {
  return {
    requestId: null, profileId: null, chromeId: null, url: null, currentUrl: null, phase: 'closed',
    canGoBack: false, canGoForward: false, notice: null, noticeMessage: null,
  };
}

export function WebPreviewPanel({ profileId, profileName, chromeId, url, native }: {
  profileId: string;
  profileName: string;
  chromeId: string;
  url: string | null;
  native: boolean;
}) {
  const [view, setView] = useState<WebPreviewState>(closedState);
  const [local, setLocal] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenProfile, setSeenProfile] = useState(profileId);
  const generation = useRef(0);
  const events = useRef(0);
  if (seenProfile !== profileId) {
    setSeenProfile(profileId);
    setConfirmClear(false);
    setLocal(null);
  }

  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    let stop = () => {};
    void webPreviewState().then((state) => { if (alive) setView(state); }, () => {});
    const pending = subscribeWebPreview((state) => {
      events.current += 1;
      if (alive) setView(state);
    });
    void pending.then((unlisten) => {
      if (typeof unlisten !== 'function') return;
      if (!alive) unlisten();
      else stop = unlisten;
    });
    return () => {
      alive = false;
      stop();
    };
  }, [native]);

  async function run(work: () => Promise<WebPreviewState>, failure: string) {
    const current = ++generation.current;
    setBusy(true);
    setLocal(null);
    try {
      const seen = events.current;
      const next = await work();
      if (generation.current !== current) return null;
      if (events.current === seen) setView(next);
      return next;
    } catch {
      if (generation.current === current) setLocal(failure);
      return null;
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const http = isHttpUrl(url);
  const windowOpen = view.phase !== 'closed' && view.profileId !== null;
  const sameProfile = view.profileId === profileId;
  const controls = native && !busy && windowOpen && sameProfile;
  const failed = sameProfile && (view.phase === 'failed' || view.phase === 'blocked');

  return (
    <section className="web-preview" aria-label="应用内网页">
      <h4>应用内网页</h4>
      <p>当前资料：{profileName}</p>
      <p className="library-detail-url">选中网址：{url ?? '无'}</p>
      <p>应用内网页会打开所选网址，并运行该站点自己的脚本。这里的登录只保存在当前资料的预览会话里，不读取 Chrome 的登录状态。不是每个网站都能在这里打开。</p>
      <p>关闭预览窗口后，当前资料的预览会话会保留。清除后，该资料的预览 Cookie 和本地存储会被删除。主窗口和其他资料使用各自的存储。</p>
      {view.phase === 'closed' && <p role="status">尚未打开应用内网页。</p>}
      {view.phase === 'loading' && sameProfile && <p role="status">正在打开应用内网页</p>}
      {view.phase === 'ready' && sameProfile && <p role="status">应用内网页已打开</p>}
      {windowOpen && <p className="library-detail-url">预览窗口网址：{view.currentUrl ?? view.url ?? '尚未载入'}</p>}
      {windowOpen && !sameProfile && <p role="status">预览窗口当前属于另一个资料。</p>}
      {failed && <p role="status">此网站没有在应用内网页中打开。可以转到 Chrome。应用不保证该网站或 Chrome 登录状态可用。</p>}
      {view.noticeMessage && <p role="status">{view.noticeMessage}</p>}
      {local && <p role="status">{local}</p>}
      {!http && <p className="secondary">仅打开 http 或 https 链接。</p>}
      <div className="edit-actions">
        <button type="button" disabled={!native || busy || !http} onClick={() => {
          if (!url) return;
          const requestId = `wp${nextRequest}`;
          nextRequest += 1;
          void run(() => openWebPreview(profileId, chromeId, requestId, url), '应用内网页没有打开。可以改用 Chrome。');
        }}>打开应用内网页</button>
        <button type="button" disabled={!controls || !view.canGoBack} onClick={() => { void run(() => webPreviewAction('back'), '应用内网页没有后退。'); }}>后退</button>
        <button type="button" disabled={!controls || !view.canGoForward} onClick={() => { void run(() => webPreviewAction('forward'), '应用内网页没有前进。'); }}>前进</button>
        <button type="button" disabled={!controls} onClick={() => { void run(() => webPreviewAction('reload'), '应用内网页没有刷新。'); }}>刷新</button>
        <button type="button" disabled={!native || !windowOpen} onClick={() => { void run(() => webPreviewAction('close'), '预览窗口没有关闭。'); }}>关闭预览</button>
        <button type="button" disabled={!native || busy} onClick={() => { setConfirmClear(true); }}>清除此资料的预览会话</button>
        {confirmClear && <button type="button" disabled={!native || busy} onClick={() => {
          const requestId = `wp${nextRequest}`;
          nextRequest += 1;
          setConfirmClear(false);
          void run(() => clearWebPreviewSession(profileId, requestId), '预览会话没有清除。').then((next) => {
            if (next && next.notice !== 'SESSION_CLEARED' && next.notice !== 'SESSION_BUSY') {
              setLocal('已清除此资料的预览会话');
            }
          });
        }}>确认清除预览会话</button>}
        <button type="button" disabled={!native || !http} onClick={() => {
          if (!url) return;
          void openHttpUrl(url).catch(() => { setLocal('没有转到 Chrome。'); });
        }}>在 Chrome 中打开</button>
      </div>
    </section>
  );
}
