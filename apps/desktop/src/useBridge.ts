import { useCallback, useEffect, useRef, useState } from 'react';
import type { BridgeState } from '@markbridge/protocol';
import { getBridgeState, getStartupState, subscribeBridgeState } from './backend';

export function useBridge() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [error, setError] = useState<'startup' | 'event' | null>(null);
  const active = useRef(false);
  const revision = useRef(-1);
  const accept = useCallback((next: BridgeState) => {
    if (!active.current || next.revision <= revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    active.current = true;
    revision.current = -1;
    const receive = (next: BridgeState) => { if (!disposed) accept(next); };
    async function initialize() {
      try {
        unsubscribe = await subscribeBridgeState(receive, () => {
          if (!disposed) setError('event');
        });
        if (disposed) { unsubscribe(); return; }
        await getStartupState();
        if (!disposed) receive(await getBridgeState());
      } catch { if (!disposed) setError('startup'); }
    }
    void initialize();
    return () => {
      disposed = true;
      active.current = false;
      unsubscribe?.();
    };
  }, [accept]);

  return { state, error, accept };
}
