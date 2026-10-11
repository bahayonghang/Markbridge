import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWireFrame, parseWireFrame, type WireMessage } from '@markbridge/protocol';
import { ExtensionBridge, flattenTree, parsePairingCode, RECOVERY_ALARM } from './bridge';

class EventHub {
  listeners: ((...args: unknown[]) => unknown)[] = [];
  addListener = (listener: (...args: unknown[]) => unknown) => { this.listeners.push(listener); };
  emit(...args: unknown[]) { return this.listeners.map(listener => listener(...args)); }
}
class Socket {
  readyState = 0;
  sent: WireMessage[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  open() { this.readyState = 1; this.onopen?.(); }
  send(frame: string) { this.sent.push(parseWireFrame(frame)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(message: WireMessage) { this.onmessage?.({ data: encodeWireFrame(message) }); }
  reply(type: 'pair_result' | 'hello_result' | 'get_tree' | 'ping' | 'pong' | 'resync_required', payload: unknown = {}) {
    const base = type === 'pong' ? [...this.sent].reverse().find(message => message.type === 'ping')! : this.sent.at(-1)!;
    this.receive({ ...base, type, requestId: type === 'resync_required' ? null : base.requestId, seq: null, payload } as WireMessage);
  }
}
const tree: chrome.bookmarks.BookmarkTreeNode[] = [{ id: '0', title: '', syncing: false, children: [
  { id: '1', parentId: '0', index: 0, title: '栏', syncing: false, folderType: 'bookmarks-bar', children: [
    { id: '2', parentId: '1', index: 0, title: 'Example', syncing: false, url: 'https://example.test/?private=fixture', dateAdded: 1234, dateLastUsed: 5678 },
  ] },
] }];
const credential = 'a'.repeat(48);
const auth = { port: 49153, profileId: 'profile-a', credential };
const pairing = () => JSON.stringify({ ...auth, protocolVersion: 1, expiresAt: Date.now() + 120_000 });
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

function setup(localData: Record<string, unknown> = {}, sessionData: Record<string, unknown> = {}) {
  function storage(data: Record<string, unknown>) {
    return {
      setAccessLevel: vi.fn(async () => {}),
      get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value); }),
      remove: vi.fn(async (key: string) => { delete data[key]; }),
    };
  }
  const events = Object.fromEntries(['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'].map(name => [name, new EventHub()]));
  const api = {
    bookmarks: { ...events, getTree: vi.fn(async () => structuredClone(tree)), create: vi.fn(), update: vi.fn(), move: vi.fn(), remove: vi.fn(), removeTree: vi.fn() },
    storage: { local: storage(localData), session: storage(sessionData), sync: { set: vi.fn() } },
    alarms: { create: vi.fn(async () => {}), onAlarm: new EventHub() },
    runtime: { id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}`, onStartup: new EventHub(), onInstalled: new EventHub(), onMessage: new EventHub() },
  };
  const sockets: Socket[] = [];
  const urls: string[] = [];
  const bridge = new ExtensionBridge(api as unknown as typeof chrome, url => {
    urls.push(url); const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  return { api, events, sockets, urls, bridge, localData, sessionData };
}
async function authenticate(ctx: ReturnType<typeof setup>) {
  await ctx.bridge.start(); const socket = ctx.sockets.at(-1)!; socket.open();
  socket.reply('hello_result', { accepted: true, sourceEpoch: 1 }); await flush();
  return socket;
}
async function synchronize(ctx: ReturnType<typeof setup>) {
  const socket = await authenticate(ctx); socket.reply('get_tree'); await flush(); return socket;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T12:00:00Z')); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('pairing boundary', () => {
  it('rejects expiration, port scanning inputs, extra keys and invalid credentials', () => {
    expect(parsePairingCode(pairing())).toMatchObject(auth);
    for (const patch of [{ expiresAt: Date.now() }, { expiresAt: Date.now() + 120_001 }, { port: 0 }, { port: 65536 }, { credential: 'short' }, { profileId: '../bad' }, { url: 'ws://other' }, { protocolVersion: 2 }]) {
      expect(() => parsePairingCode(JSON.stringify({ ...JSON.parse(pairing()), ...patch }))).toThrow();
    }
  });
  it('stores long credentials locally only after desktop confirms; pending retries stop at expiry', async () => {
    const ctx = setup(); await ctx.bridge.start(); await ctx.bridge.command({ type: 'pair', code: pairing() });
    const socket = ctx.sockets[0]; socket.open();
    expect(socket.sent[0].type).toBe('pair');
    socket.reply('pair_result', { accepted: false, errorCode: 'UNPAIRED' }); await flush();
    expect(ctx.bridge.getStatus().state).toBe('pending'); expect(ctx.localData['markbridge-auth']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000); expect(ctx.sockets).toHaveLength(2);
    const second = ctx.sockets[1]; second.open(); second.reply('pair_result', { accepted: true, credential }); await flush();
    expect(ctx.localData['markbridge-auth']).toEqual(auth); expect(ctx.sessionData['markbridge-pending']).toBeUndefined();
    expect(second.sent.at(-1)?.type).toBe('hello'); expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/', 'ws://127.0.0.1:49153/']);
    expect(ctx.api.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(ctx.api.storage.sync.set).not.toHaveBeenCalled();
    second.reply('hello_result', { accepted: true, sourceEpoch: 1 }); await flush();
    expect(ctx.bridge.getStatus().state).toBe('reconciling');
  });
  it('does not retain an expired pending code or leave unauthenticated sockets open', async () => {
    const ctx = setup(); await ctx.bridge.start(); await ctx.bridge.command({ type: 'pair', code: pairing() });
    const first = ctx.sockets[0]; first.open(); await vi.advanceTimersByTimeAsync(5000); expect(first.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(120_000); expect(ctx.bridge.getStatus().state).toBe('unpaired');
    expect(ctx.sessionData['markbridge-pending']).toBeUndefined();
  });
  it('rejects wrong profile/session and failed credentials before reading the tree; alarm cannot replay', async () => {
    for (const failure of ['profile', 'session', 'credential']) {
      const ctx = setup({ 'markbridge-auth': auth }); await ctx.bridge.start(); const socket = ctx.sockets[0]; socket.open();
      if (failure === 'credential') socket.reply('hello_result', { accepted: false, sourceEpoch: 1, errorCode: 'UNPAIRED' });
      else socket.receive({ ...socket.sent[0], profileId: failure === 'profile' ? 'profile-b' : auth.profileId, sessionId: failure === 'session' ? 'wrong' : socket.sent[0].sessionId, type: 'hello_result', payload: { accepted: true, sourceEpoch: 1 } });
      await flush(); expect(ctx.api.bookmarks.getTree).not.toHaveBeenCalled(); expect(ctx.localData['markbridge-auth']).toBeUndefined();
      ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM }); await flush(); expect(ctx.sockets).toHaveLength(1);
    }
  });
  it('rejects content-script messages even when sender ID matches', async () => {
    const ctx = setup(); await ctx.bridge.start(); const respond = vi.fn();
    ctx.api.runtime.onMessage.emit({ type: 'pair', code: pairing() }, { id: 'extension-id', url: 'https://example.test/' }, respond);
    await flush(); expect(respond).not.toHaveBeenCalled(); expect(ctx.sockets).toHaveLength(0);
  });
});

describe('stable read-only synchronization', () => {
  it('registers before tree access, preserves roots and Chrome millisecond metadata', async () => {
    const ctx = setup({ 'markbridge-auth': auth });
    expect(Object.values(ctx.events).every(event => event.listeners.length === 1)).toBe(true);
    const socket = await synchronize(ctx);
    const snapshot = socket.sent.find(message => message.type === 'tree_full');
    expect(snapshot?.type).toBe('tree_full');
    if (snapshot?.type !== 'tree_full') throw new Error('missing snapshot');
    expect(snapshot.payload.nodes).toHaveLength(3);
    expect(snapshot.payload.nodes[1].folderType).toBe('bookmarks-bar');
    expect(snapshot.payload.nodes[2].dateAdded).toEqual({ source: 'chrome_api', unixMillis: 1234 });
    expect(snapshot.payload.nodes[2].dateLastUsed).toEqual({ source: 'chrome_api', unixMillis: 5678 });
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', nodeCount: 3 });
  });
  it('discards snapshots invalidated by events and sends barrier before later increments', async () => {
    const ctx = setup({ 'markbridge-auth': auth });
    ctx.api.bookmarks.getTree.mockImplementationOnce(async () => {
      ctx.events.onChanged.emit('2', { title: 'changed' }); return structuredClone(tree);
    });
    const socket = await synchronize(ctx);
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(2);
    expect(socket.sent.filter(message => message.type === 'event')).toHaveLength(0);
    const snapshot = socket.sent.find(message => message.type === 'tree_full');
    expect(snapshot?.type === 'tree_full' && snapshot.payload.barrierSeq).toBe(1);
    ctx.events.onChanged.emit('2', { title: 'later' });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'event', seq: 2, payload: { event: { kind: 'changed', chromeId: '2', title: 'later' } } });
  });
  it('bounds busy snapshots at three attempts and reconciles after the tree stops changing', async () => {
    const ctx = setup({ 'markbridge-auth': auth });
    ctx.api.bookmarks.getTree.mockImplementation(async () => { ctx.events.onChanged.emit('2', { title: 'busy' }); return structuredClone(tree); });
    const socket = await synchronize(ctx);
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(3); expect(socket.sent.some(message => message.type === 'tree_full')).toBe(false);
    expect(ctx.bridge.getStatus().state).toBe('reconciling');
    ctx.api.bookmarks.getTree.mockImplementation(async () => structuredClone(tree)); await vi.advanceTimersByTimeAsync(1000);
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
  });
  it('rejects incomplete full snapshots without reporting a successful send', async () => {
    for (const incomplete of [[], [{ id: '0', title: '', syncing: false }]]) {
      const ctx = setup({ 'markbridge-auth': auth }); ctx.api.bookmarks.getTree.mockResolvedValue(incomplete);
      const socket = await synchronize(ctx);
      expect(socket.sent.some(message => message.type === 'tree_full')).toBe(false); expect(ctx.bridge.getStatus().state).toBe('error');
    }
  });
  it('normalizes create/change/move/remove/reorder/import and never calls write APIs', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); const socket = await synchronize(ctx);
    ctx.events.onCreated.emit('3', { id: '3', parentId: '1', index: 1, title: 'new', url: 'https://new.test/' });
    ctx.events.onChanged.emit('3', { title: 'renamed', url: 'https://changed.test/' });
    ctx.events.onMoved.emit('3', { oldParentId: '1', oldIndex: 1, parentId: '0', index: 1 });
    ctx.events.onRemoved.emit('3', { parentId: '0', index: 1, node: { id: '3', parentId: '0', index: 1, title: 'renamed', url: 'https://changed.test/' } });
    ctx.events.onChildrenReordered.emit('1', { childIds: ['2'] }); ctx.events.onImportBegan.emit(); ctx.events.onImportEnded.emit(); await flush();
    const messages = socket.sent.filter(message => message.type === 'event');
    expect(messages.map(message => message.payload.event.kind)).toEqual(['created', 'changed', 'moved', 'removed', 'reordered', 'import_began', 'import_ended']);
    expect(messages.map(message => message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(socket.sent.at(-1)?.type).toBe('resync_required');
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
    socket.receive({ ...socket.sent[0], type: 'get_tree', requestId: 'desktop-import-tree', payload: {} }); await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-import-tree' });
    for (const method of ['create', 'update', 'move', 'remove', 'removeTree'] as const) expect(ctx.api.bookmarks[method]).not.toHaveBeenCalled();
  });
  it('rejects apply_operation while reconciling and writes only after the snapshot is live', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); const socket = await synchronize(ctx);
    socket.reply('resync_required', { reason: 'INVALID_TREE' }); await flush();
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
    expect(ctx.bridge.getStatus().state).toBe('reconciling');
    const create = { requestId: 'step-a', target: null, expectedBefore: null, expectedChildIds: null, payload: { kind: 'create' as const, parentId: '1', position: 0, title: 'Added', url: 'https://added.test/' } };
    socket.receive({ ...socket.sent[0], type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-a', sourceEpoch: 1, steps: [create] } });
    await flush();
    expect(ctx.bridge.getStatus().errorCode).toBe('READ_ONLY');
    expect(socket.sent.filter(message => message.type === 'operation_receipt')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ requestId: 'step-a', state: 'failed', errorCode: 'READ_ONLY' }) }),
    ]);
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();
    expect(ctx.localData['markbridge-auth']).toEqual(auth);
    socket.receive({ ...socket.sent[0], type: 'get_tree', requestId: 'desktop-resync-tree', payload: {} }); await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-resync-tree' });
    socket.receive({ ...socket.sent[0], type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-a', sourceEpoch: 2, steps: [create] } });
    await flush();
    expect(ctx.bridge.getStatus().errorCode).toBe('WRONG_PROFILE');
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();
    ctx.api.bookmarks.create.mockImplementation(async (details: chrome.bookmarks.CreateDetails) => {
      const writes = ctx.localData['markbridge-writes'] as { pending?: Array<{ phase?: string; kind?: string }> } | undefined;
      expect(writes?.pending?.some((item) => item.kind === 'create' && item.phase === 'marker')).toBe(true);
      return { id: '9', parentId: details.parentId, index: details.index, title: details.title, url: details.url, syncing: false };
    });
    socket.receive({ ...socket.sent[0], type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-live', sourceEpoch: 1, steps: [{ ...create, requestId: 'step-live' }] } });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.filter(message => message.type === 'operation_receipt' && message.payload.requestId === 'step-live')).toEqual([
      expect.objectContaining({ type: 'operation_receipt', payload: expect.objectContaining({ operationId: 'op-live', requestId: 'step-live', state: 'applied', errorCode: null }) }),
    ]);
    expect(ctx.localData['markbridge-writes']).toMatchObject({ receipts: [expect.objectContaining({ requestId: 'step-live', state: 'applied' })] });
    socket.receive({ ...socket.sent[0], type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-live', sourceEpoch: 1, steps: [{ ...create, requestId: 'step-live' }] } });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.filter(message => message.type === 'operation_receipt' && message.payload.requestId === 'step-live')).toHaveLength(2);
    const writes = ctx.api.bookmarks.getTree.mock.calls.length;
    socket.receive({ ...socket.sent[0], type: 'get_operation_status', requestId: 'status-1', payload: { operationId: 'op-live' } });
    await flush();
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(writes);
    expect(socket.sent.at(-1)).toMatchObject({ type: 'operation_receipt', payload: { requestId: 'step-live', state: 'applied' } });
  });
  it('bounds conversion depth and count and preserves dynamic managed roots', () => {
    expect(flattenTree([{ id: 'managed', title: 'managed', syncing: false, folderType: 'managed', unmodifiable: 'managed', children: [] }])[0]).toMatchObject({ folderType: 'managed', unmodifiable: 'managed' });
    const root: chrome.bookmarks.BookmarkTreeNode = { id: '0', title: '', syncing: false, children: [] }; let parent = root;
    for (let i = 1; i <= 256; i++) { const child = { id: String(i), title: '', syncing: false, children: [] }; parent.children = [child]; parent = child; }
    expect(() => flattenTree([root])).toThrow('LIMIT_EXCEEDED');
    expect(() => flattenTree(Array.from({ length: 100_001 }, (_, index) => ({ id: String(index), title: '', syncing: false })))).toThrow('LIMIT_EXCEEDED');
  });
});

describe('persistent recovery', () => {
  it('keeps heartbeat traffic under worker activity timeout and runs a five-minute full reconciliation', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); const socket = await synchronize(ctx);
    for (let i = 0; i < 15; i++) { await vi.advanceTimersByTimeAsync(20_000); socket.reply('pong'); await flush(); }
    expect(socket.sent.filter(message => message.type === 'ping')).toHaveLength(15);
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(1);
    expect(socket.sent.at(-1)?.type).toBe('resync_required');
    socket.receive({ ...socket.sent[0], type: 'get_tree', requestId: 'desktop-periodic-tree', payload: {} }); await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-periodic-tree' });
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(2);
    expect(ctx.api.alarms.create).toHaveBeenCalledWith(RECOVERY_ALARM, { periodInMinutes: 0.5 });
  });
  it('recovers after timer loss using alarm/startup and reinitialization; explicit reconnect uses new session', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); const socket = await synchronize(ctx);
    socket.close(); expect(ctx.bridge.getStatus().state).toBe('disconnected'); vi.clearAllTimers();
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM }); await flush(); expect(ctx.sockets).toHaveLength(2);
    ctx.sockets[1].close(); vi.clearAllTimers(); ctx.api.runtime.onStartup.emit(); await flush(); expect(ctx.sockets).toHaveLength(3);
    await ctx.bridge.command({ type: 'reconnect' }); expect(ctx.sockets).toHaveLength(4); expect(ctx.sockets[2].readyState).toBe(3);
    ctx.sockets[3].open(); expect(ctx.sockets[3].sent[0].sessionId).not.toBe(socket.sent[0].sessionId);
    const restarted = setup(ctx.localData, ctx.sessionData); await restarted.bridge.start(); restarted.sockets[0].open();
    expect(restarted.sockets[0].sent[0]).toMatchObject({ type: 'hello', payload: { instanceId: socket.sent[0].type === 'hello' ? socket.sent[0].payload.instanceId : '' } });
    expect(restarted.bridge.getStatus().state).toBe('connecting'); expect(restarted.api.bookmarks.getTree).not.toHaveBeenCalled();
  });
  it('coalesces periodic reconciliation and waits for the desktop request ID when both peers refresh', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); const socket = await synchronize(ctx);
    for (let i = 0; i < 15; i++) { await vi.advanceTimersByTimeAsync(20_000); socket.reply('pong'); await flush(); }
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM }); await flush();
    expect(socket.sent.filter(message => message.type === 'resync_required')).toHaveLength(1);
    const before = socket.sent.length;
    socket.reply('resync_required', { reason: 'INVALID_TREE' }); await flush();
    ctx.events.onChanged.emit('2', { title: 'during reconciliation' });
    expect(socket.sent).toHaveLength(before);
    socket.receive({ ...socket.sent[0], type: 'get_tree', requestId: 'desktop-overlap-tree', payload: {} }); await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-overlap-tree', payload: { barrierSeq: 1 } });
    ctx.events.onChanged.emit('2', { title: 'after reconciliation' });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'event', seq: 2 });
  });
  it('uses capped exponential retries and clears identity on explicit local forget', async () => {
    const ctx = setup({ 'markbridge-auth': auth }); await ctx.bridge.start();
    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      const count = ctx.sockets.length; ctx.sockets.at(-1)!.close(); await vi.advanceTimersByTimeAsync(seconds * 1000 - 1); expect(ctx.sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1); expect(ctx.sockets).toHaveLength(count + 1);
    }
    await ctx.bridge.command({ type: 'forget' }); ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM }); await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'unpaired', profileId: null }); expect(ctx.localData['markbridge-auth']).toBeUndefined();
  });
  it('rejects capture commands that do not come from the popup gesture', async () => {
    const ctx = setup(); await ctx.bridge.start();
    await expect(ctx.bridge.command({ type: 'capture' })).rejects.toThrow('INVALID_MESSAGE');
  });
});
