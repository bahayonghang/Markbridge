import { useEffect, useRef, useState } from 'react';
import type { ContentPreview } from '@markbridge/protocol';
import { cancelContentPreview, readContentPreview } from '../../backend';
import { isHttpUrl } from '../library/model';

const DEBOUNCE_MS = 200;
let nextRequest = 0;

export type PreviewView =
  | { phase: 'loading' }
  | { phase: 'message'; message: string }
  | { phase: 'ready'; preview: ContentPreview };

export function useContentPreview(profileId: string, chromeId: string, url: string | null) {
  const [view, setView] = useState<PreviewView>({ phase: 'loading' });
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const requestRef = useRef<string | null>(null);
  const http = isHttpUrl(url);

  useEffect(() => {
    const current = ++generation.current;
    const previous = requestRef.current;
    requestRef.current = null;
    if (previous) void cancelContentPreview(previous).catch(() => {});
    if (!http) {
      setView({ phase: 'message', message: url ? '仅预览 http 或 https 页面' : '此条目没有可预览的网页地址' });
      return;
    }
    const requestId = `pv${nextRequest}`;
    nextRequest += 1;
    let alive = true;
    setView({ phase: 'loading' });
    const timer = window.setTimeout(() => {
      if (!alive || generation.current !== current) return;
      requestRef.current = requestId;
      setView({ phase: 'loading' });
      void readContentPreview(profileId, chromeId, requestId).then(
        (preview) => {
          if (!alive || generation.current !== current || preview.requestId !== requestId || preview.profileId !== profileId || preview.chromeId !== chromeId) return;
          if (preview.status === 'cancelled') {
            setView({ phase: 'message', message: '已取消' });
            return;
          }
          setView({ phase: 'ready', preview });
        },
        () => {
          if (!alive || generation.current !== current) return;
          setView({ phase: 'message', message: '页面响应无效' });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (requestRef.current === requestId) {
        requestRef.current = null;
        void cancelContentPreview(requestId).catch(() => {});
      }
    };
  }, [profileId, chromeId, url, http, nonce]);

  function refresh(): void {
    setNonce((value) => value + 1);
  }

  function cancel(): void {
    generation.current += 1;
    const requestId = requestRef.current;
    requestRef.current = null;
    if (requestId) void cancelContentPreview(requestId).catch(() => {});
    setView({ phase: 'message', message: '已取消' });
  }

  return { view, refresh, cancel, http };
}
