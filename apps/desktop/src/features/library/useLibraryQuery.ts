import { useEffect, useRef, useState } from 'react';
import type { LibraryQuery, LibraryQueryPage } from '@markbridge/protocol';
import { readCacheQuery } from '../../backend';

export function useLibraryQuery(profileId: string | null, revision: number, identity: string, filters: Omit<LibraryQuery, 'offset' | 'limit' | 'expectedRevision' | 'expectedSourceEpoch'>) {
  const [page, setPage] = useState<LibraryQueryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([profileId, revision, identity, filters, refresh]);
  const currentKey = useRef(key);
  const inFlight = useRef(false);
  const requestGeneration = useRef(0);
  const [seenKey, setSeenKey] = useState(key);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  currentKey.current = key;
  if (seenKey !== key) {
    requestGeneration.current += 1;
    setSeenKey(key);
    setPage(null);
    setFailed(false);
    inFlight.current = false;
  }
  useEffect(() => {
    if (!profileId) { setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    inFlight.current = true;
    void readCacheQuery(profileId, { ...filtersRef.current, offset: 0, limit: 200, expectedRevision: null, expectedSourceEpoch: null }).then(
      (next) => { if (!cancelled && currentKey.current === key) setPage(next); },
      () => { if (!cancelled && currentKey.current === key) setFailed(true); },
    ).finally(() => { if (!cancelled && currentKey.current === key) { setBusy(false); inFlight.current = false; } });
    return () => { cancelled = true; };
  }, [profileId, key]);

  async function loadMore(toEnd = false): Promise<string | null> {
    if (!profileId || !page || page.nextOffset == null || inFlight.current) return null;
    const stamp = key;
    const generation = requestGeneration.current;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    let merged = page;
    try {
      do {
        const next = await readCacheQuery(profileId, { ...filtersRef.current, offset: merged.nextOffset!, limit: 200, expectedRevision: merged.revision, expectedSourceEpoch: merged.sourceEpoch });
        if (currentKey.current !== stamp || requestGeneration.current !== generation) return null;
        if (next.revision !== merged.revision || next.sourceEpoch !== merged.sourceEpoch || next.offset !== merged.items.length) throw 'CONFLICT';
        const ids = new Set(merged.items.map((node) => node.chromeId));
        if (next.items.some((node) => ids.has(node.chromeId))) throw 'CONFLICT';
        merged = { ...next, offset: 0, items: [...merged.items, ...next.items] };
        setPage(merged);
      } while (toEnd && merged.nextOffset != null);
      return merged.items.at(-1)?.chromeId ?? null;
    } catch (error) {
      if (currentKey.current === stamp && requestGeneration.current === generation) {
        if (error === 'CONFLICT') { setRestarted(true); setRefresh((value) => value + 1); }
        else setFailed(true);
      }
      return null;
    } finally {
      if (currentKey.current === stamp && requestGeneration.current === generation) { setBusy(false); inFlight.current = false; }
    }
  }
  return { page, busy, failed, restarted, loadMore, generation: refresh, refresh: () => setRefresh((value) => value + 1) };
}
