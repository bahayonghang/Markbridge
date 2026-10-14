import type { InstalledFontCatalog } from '@markbridge/protocol';
import { listInstalledFonts } from '../../backend';

// Owned by the mounted GeneralSettings instance, never module-global or persisted.
export function createFontCatalogSession(load: () => Promise<InstalledFontCatalog> = listInstalledFonts) {
  let cached: InstalledFontCatalog | null = null;
  let pending: Promise<InstalledFontCatalog> | null = null;
  let generation = 0;
  let pendingGeneration = 0;
  let consumers = 0;
  let queued: { generation: number; promise: Promise<InstalledFontCatalog> } | null = null;
  function read(refresh = false): Promise<InstalledFontCatalog> {
    // A reopened picker waits for the cancelled native job, then starts a fresh census.
    // The physical IPC stays single-flight even though its old UI result is discarded.
    if (pending) {
      if (pendingGeneration === generation) return pending;
      if (queued?.generation === generation) return queued.promise;
      const waitingGeneration = generation;
      const promise = pending.then(result => waitingGeneration === generation ? read(refresh) : result);
      queued = { generation, promise };
      return promise;
    }
    if (!refresh && cached) return Promise.resolve(cached);
    const request = ++generation;
    pendingGeneration = request;
    pending = load().catch((): InstalledFontCatalog => ({ status: 'unavailable', reason: 'enumeration_failed' })).then(result => {
      if (request === generation) cached = result.status === 'ready' ? result : null;
      pending = null;
      return result;
    });
    return pending;
  }
  return {
    peek: () => cached,
    read,
    retain() { consumers += 1; },
    release() {
      consumers -= 1;
      // React StrictMode immediately remounts an effect; it is still the same open picker.
      queueMicrotask(() => { if (consumers === 0) generation += 1; });
    },
    cancelPending() { generation += 1; },
  };
}
export type FontCatalogSession = ReturnType<typeof createFontCatalogSession>;
