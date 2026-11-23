import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_PORT_START,
  encodeWireFrame,
  parseWireFrame,
  type WireMessage,
} from '@markbridge/protocol';
import { candidatePorts, ExtensionBridge, flattenTree, RECOVERY_ALARM } from './bridge';
import * as bridgeModule from './bridge';

class EventHub {
  listeners: ((...args: unknown[]) => unknown)[] = [];
  addListener = (listener: (...args: unknown[]) => unknown) => { this.listeners.push(listener); };
  emit(...args: unknown[]) { return this.listeners.map(listener => listener(...args)); }
}

class Socket {
  readyState = 0;
  sent: WireMessage[] = [];
  resolvedProfileId: string | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public readonly url: string) {}
  open() { this.readyState = 1; this.onopen?.(); }
  send(frame: string) { this.sent.push(parseWireFrame(frame)); }
  fail() { this.readyState = 3; this.onerror?.(); this.onclose?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(message: WireMessage) {
    if (message.type === 'hello_result' && message.payload.accepted && message.payload.profileId) {
      this.resolvedProfileId = message.payload.profileId;
    }
    this.onmessage?.({ data: encodeWireFrame(message) });
  }
  reply(type: 'hello_result' | 'get_tree' | 'ping' | 'pong' | 'resync_required' | 'pause_sync' | 'write_policy', payload: unknown = {}) {
    const base = type === 'pong'
      ? [...this.sent].reverse().find(message => message.type === 'ping')!
      : this.sent.at(-1)!;
    const requestId = type === 'resync_required'
      ? null
      : type === 'pause_sync'
        ? 'pause-1'
        : type === 'write_policy'
          ? 'wp-1'
          : type === 'get_tree'
            ? (base.requestId ?? 'tree-1')
            : base.requestId;
    this.receive({ ...base, profileId: this.resolvedProfileId ?? base.profileId, type, requestId, seq: null, payload } as WireMessage);
  }
}

const tree: chrome.bookmarks.BookmarkTreeNode[] = [{ id: '0', title: '', syncing: false, children: [
  { id: '1', parentId: '0', index: 0, title: '栏', syncing: false, folderType: 'bookmarks-bar', children: [
    { id: '2', parentId: '1', index: 0, title: 'Example', syncing: false, url: 'https://example.test/?private=fixture', dateAdded: 1234, dateLastUsed: 5678 },
  ] },
] }];

const DEFAULT_PROFILE = 'profile-a';
const DEFAULT_DISPLAY_NAME = 'Chrome 资料 1';

async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

function setup(
  localData: Record<string, unknown> = {},
  options: { openPorts?: number[]; sessionData?: Record<string, unknown> } = {},
) {
  function storage(data: Record<string, unknown>) {
    return {
      setAccessLevel: vi.fn(async () => {}),
      get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value); }),
      remove: vi.fn(async (key: string) => { delete data[key]; }),
    };
  }
  const sessionData = options.sessionData ?? {};
  const events = Object.fromEntries(['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'].map(name => [name, new EventHub()]));
  const api = {
    bookmarks: { ...events, getTree: vi.fn(async () => structuredClone(tree)), create: vi.fn(), update: vi.fn(), move: vi.fn(), remove: vi.fn(), removeTree: vi.fn() },
    storage: { local: storage(localData), session: storage(sessionData), sync: { set: vi.fn() } },
    alarms: { create: vi.fn(async () => {}), onAlarm: new EventHub() },
    runtime: { id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}`, onStartup: new EventHub(), onInstalled: new EventHub(), onMessage: new EventHub() },
  };
  const sockets: Socket[] = [];
  const urls: string[] = [];
  const openPorts = new Set(options.openPorts ?? [BRIDGE_PORT_START]);
  const bridge = new ExtensionBridge(api as unknown as typeof chrome, url => {
    urls.push(url);
    const socket = new Socket(url);
    sockets.push(socket);
    const port = Number(new URL(url).port);
    if (options.openPorts && !openPorts.has(port)) {
      queueMicrotask(() => { if (socket.readyState === 0) socket.fail(); });
    }
    return socket as unknown as WebSocket;
  });
  return { api, events, sockets, urls, bridge, localData, sessionData, openPorts };
}

function helloResult(
  socket: Socket,
  overrides: Partial<{
    accepted: boolean;
    profileId: string | null;
    displayName: string | null;
    sourceEpoch: number;
    writePaused: boolean;
    errorCode: string | null;
  }> = {},
) {
  const hello = socket.sent[0]!;
  const accepted = overrides.accepted ?? true;
  const profileId = overrides.profileId !== undefined ? overrides.profileId : (accepted ? DEFAULT_PROFILE : null);
  const displayName = overrides.displayName !== undefined ? overrides.displayName : (accepted ? DEFAULT_DISPLAY_NAME : null);
  socket.receive({
    protocolVersion: 1,
    type: 'hello_result',
    profileId: profileId ?? hello.profileId,
    sessionId: hello.sessionId,
    requestId: hello.requestId,
    seq: null,
    payload: {
      accepted,
      profileId,
      displayName,
      sourceEpoch: overrides.sourceEpoch ?? 1,
      writePaused: overrides.writePaused ?? false,
      errorCode: overrides.errorCode ?? null,
    },
  } as WireMessage);
}

async function authenticate(
  ctx: ReturnType<typeof setup>,
  overrides: Parameters<typeof helloResult>[1] = {},
) {
  await ctx.bridge.start();
  await flush();
  const socket = ctx.sockets.at(-1)!;
  socket.open();
  helloResult(socket, overrides);
  await flush();
  return socket;
}

async function synchronize(
  ctx: ReturnType<typeof setup>,
  overrides: Parameters<typeof helloResult>[1] = {},
) {
  const socket = await authenticate(ctx, overrides);
  socket.reply('get_tree');
  await flush();
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('zero-click port probing and anti-bounce', () => {
  it('removes legacy pairing helpers and commands', () => {
    expect('parsePairingCode' in bridgeModule).toBe(false);
  });

  it('orders candidate ports with valid lastPort first and deduplicates 49153..49160', () => {
    expect(candidatePorts(null)).toEqual([49153, 49154, 49155, 49156, 49157, 49158, 49159, 49160]);
    expect(candidatePorts(49155)).toEqual([49155, 49153, 49154, 49156, 49157, 49158, 49159, 49160]);
    expect(candidatePorts(49160)).toEqual([49160, 49153, 49154, 49155, 49156, 49157, 49158, 49159]);
    expect(candidatePorts(12345)).toEqual([49153, 49154, 49155, 49156, 49157, 49158, 49159, 49160]);
  });

  it('auto-probes 49153-49160, skips unreachable 49153-49154, connects to 49155, and reaches connected state', async () => {
    const ctx = setup({}, { openPorts: [49155] });
    await ctx.bridge.start();
    await flush();
    expect(ctx.urls).toEqual([
      'ws://127.0.0.1:49153/',
      'ws://127.0.0.1:49154/',
      'ws://127.0.0.1:49155/',
    ]);
    const socket = ctx.sockets.at(-1)!;
    socket.open();
    expect(socket.sent[0]).toMatchObject({
      type: 'hello',
      profileId: 'pending',
      payload: {
        instanceId: expect.any(String),
        userInitiated: false,
      },
    });
    helloResult(socket, { accepted: true, profileId: 'p-49155', displayName: '工作资料', writePaused: false });
    await flush();
    expect(ctx.api.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(ctx.api.storage.sync.set).not.toHaveBeenCalled();
    expect(ctx.localData['markbridge-bridge-prefs']).toEqual({
      lastPort: 49155,
      profileId: 'p-49155',
      displayName: '工作资料',
      paused: false,
    });
    expect(ctx.bridge.getStatus()).toMatchObject({
      state: 'reconciling',
      profileId: 'p-49155',
      displayName: '工作资料',
      port: 49155,
      writePaused: false,
    });
    socket.reply('get_tree');
    await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({
      state: 'connected',
      profileId: 'p-49155',
      displayName: '工作资料',
      port: 49155,
      nodeCount: 3,
      writePaused: false,
      errorCode: null,
    });
  });

  it('times out hanging candidate ports after 1500ms before advancing to the next port', async () => {
    const ctx = setup(); // manual sockets: never emit onerror/onclose unless closed or timed out
    await ctx.bridge.start();
    await flush();
    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/']);
    await vi.advanceTimersByTimeAsync(1499);
    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/']);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.sockets[0]!.readyState).toBe(3);
    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/', 'ws://127.0.0.1:49154/']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/', 'ws://127.0.0.1:49154/', 'ws://127.0.0.1:49155/']);
    const socket = ctx.sockets[2]!;
    socket.open();
    helloResult(socket, { accepted: true, profileId: 'p-timeout', displayName: '超时回落' });
    await flush();
    socket.reply('get_tree');
    await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', port: 49155, profileId: 'p-timeout' });
  });

  it('recovers across port rollover (49155 -> 49156) trying lastPort first without duplicates', async () => {
    const ctx = setup({}, { openPorts: [49155] });
    const socket1 = await synchronize(ctx, { profileId: 'p-roll', displayName: '日常资料' });
    expect(ctx.bridge.getStatus().port).toBe(49155);

    ctx.openPorts.clear();
    ctx.openPorts.add(49156);
    ctx.urls.length = 0;
    socket1.close();
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'disconnected', port: null });

    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.urls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(ctx.urls).toEqual([
      'ws://127.0.0.1:49155/',
      'ws://127.0.0.1:49153/',
      'ws://127.0.0.1:49154/',
      'ws://127.0.0.1:49156/',
    ]);
    const socket2 = ctx.sockets.at(-1)!;
    socket2.open();
    expect(socket2.sent[0]).toMatchObject({
      type: 'hello',
      profileId: 'p-roll',
      payload: { userInitiated: false },
    });
    helloResult(socket2, { profileId: 'p-roll', displayName: '日常资料' });
    await flush();
    socket2.reply('get_tree');
    await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({
      state: 'connected',
      profileId: 'p-roll',
      displayName: '日常资料',
      port: 49156,
      nodeCount: 3,
    });
    expect(ctx.localData['markbridge-bridge-prefs']).toMatchObject({ lastPort: 49156, paused: false });
  });

  it('uses capped exponential backoff [1,2,4,8,16,30]s after full port sweeps fail', async () => {
    const ctx = setup({}, { openPorts: [] });
    await ctx.bridge.start();
    await flush();
    expect(ctx.urls).toHaveLength(8);
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'disconnected', port: null });

    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      const before = ctx.urls.length;
      await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
      expect(ctx.urls).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(ctx.urls).toHaveLength(before + 8);
    }
  });

  it('persists paused on PauseSync(PROFILE_IGNORED) and ignores alarms/startup until user reconnect', async () => {
    const ctx = setup({}, { openPorts: [49155] });
    const socket = await synchronize(ctx, { profileId: 'p-ign', displayName: '个人资料' });

    socket.reply('pause_sync', { reason: 'PROFILE_IGNORED' });
    socket.close();
    await flush();

    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'paused', port: null, errorCode: 'PROFILE_IGNORED' });
    expect(ctx.localData['markbridge-bridge-prefs']).toMatchObject({
      lastPort: 49155,
      profileId: 'p-ign',
      displayName: '个人资料',
      paused: true,
    });

    const countBefore = ctx.sockets.length;
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    ctx.api.runtime.onStartup.emit();
    ctx.api.runtime.onInstalled.emit();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(ctx.sockets).toHaveLength(countBefore);

    // Persisted pause survives worker restart.
    const restarted = setup(ctx.localData, { openPorts: [49155] });
    await restarted.bridge.start();
    restarted.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    restarted.api.runtime.onStartup.emit();
    await flush();
    expect(restarted.bridge.getStatus()).toMatchObject({ state: 'paused', profileId: 'p-ign', displayName: '个人资料' });
    expect(restarted.sockets).toHaveLength(0);

    // Explicit user reconnect clears paused and sends userInitiated: true.
    await restarted.bridge.command({ type: 'reconnect' });
    await flush();
    expect(restarted.sockets).toHaveLength(1);
    const reconnected = restarted.sockets[0]!;
    reconnected.open();
    expect(reconnected.sent[0]).toMatchObject({
      type: 'hello',
      profileId: 'p-ign',
      payload: { userInitiated: true },
    });
    helloResult(reconnected, { profileId: 'p-ign', displayName: '个人资料' });
    await flush();
    reconnected.reply('get_tree');
    await flush();
    expect(restarted.bridge.getStatus()).toMatchObject({ state: 'connected', port: 49155, errorCode: null });
    expect(restarted.localData['markbridge-bridge-prefs']).toMatchObject({ paused: false });
  });

  it('persists paused on HelloResult(PROFILE_IGNORED) and stops probing remaining ports', async () => {
    const ctx = setup({}, { openPorts: [49153, 49154] });
    await ctx.bridge.start();
    await flush();
    const first = ctx.sockets[0]!;
    first.open();
    helloResult(first, { accepted: false, profileId: null, displayName: null, errorCode: 'PROFILE_IGNORED' });
    await flush();

    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/']);
    expect(first.readyState).toBe(3);
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'paused', port: null, errorCode: 'PROFILE_IGNORED' });
    expect(ctx.localData['markbridge-bridge-prefs']).toMatchObject({ paused: true });
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    ctx.api.runtime.onStartup.emit();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(ctx.urls).toEqual(['ws://127.0.0.1:49153/']);
  });

  it('handles pause command cleanly and keeps background retries userInitiated: false after a failed reconnect sweep', async () => {
    const ctx = setup({}, { openPorts: [49153] });
    await synchronize(ctx);

    const paused = await ctx.bridge.command({ type: 'pause' });
    expect(paused).toMatchObject({ state: 'paused', port: null });
    expect(ctx.sockets[0]!.readyState).toBe(3);
    expect(ctx.localData['markbridge-bridge-prefs']).toMatchObject({ paused: true });

    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(ctx.sockets).toHaveLength(1);

    // Trigger user reconnect while all ports are unreachable: sweep #1 uses userInitiated=true, subsequent backoff uses false.
    ctx.openPorts.clear();
    await ctx.bridge.command({ type: 'reconnect' });
    await flush();
    expect(ctx.sockets).toHaveLength(9);

    ctx.openPorts.add(49153);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    const retrySocket = ctx.sockets.at(-1)!;
    retrySocket.open();
    expect(retrySocket.sent[0]).toMatchObject({
      type: 'hello',
      payload: { userInitiated: false },
    });
  });

  it('propagates writePaused in ExtensionStatus and blocks apply_operation with WRITE_PAUSED', async () => {
    const ctx = setup({}, { openPorts: [49153] });
    const socket = await authenticate(ctx, { writePaused: true, profileId: 'p-ro', displayName: '只读资料' });
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'reconciling', writePaused: true, displayName: '只读资料' });
    socket.reply('get_tree');
    await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', writePaused: true, nodeCount: 3 });

    const create = {
      requestId: 'step-wp',
      target: null,
      expectedBefore: null,
      expectedChildIds: null,
      payload: { kind: 'create' as const, parentId: '1', position: 0, title: 'Blocked', url: 'https://blocked.test/' },
    };
    socket.receive({
      ...socket.sent[0]!,
      profileId: socket.resolvedProfileId!,
      type: 'apply_operation',
      payload: { expectedRevision: 0, operationId: 'op-wp', sourceEpoch: 1, steps: [create] },
    });
    await flush();
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'operation_receipt',
      payload: { operationId: 'op-wp', requestId: 'step-wp', state: 'failed', errorCode: 'WRITE_PAUSED' },
    });
  });

  it('toggles writePaused live via write_policy without reconnect (true -> false -> true)', async () => {
    const ctx = setup({}, { openPorts: [49153] });
    ctx.api.bookmarks.create.mockImplementation(async (details: chrome.bookmarks.CreateDetails) => ({
      id: '9',
      parentId: details.parentId,
      index: details.index,
      title: details.title,
      url: details.url,
      syncing: false,
    }));
    const socket = await synchronize(ctx, { writePaused: true, profileId: 'p-wp-live', displayName: '读写切换资料' });
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', writePaused: true });

    const step = (requestId: string) => ({
      requestId,
      target: null,
      expectedBefore: null,
      expectedChildIds: null,
      payload: { kind: 'create' as const, parentId: '1', position: 0, title: 'Live Policy', url: 'https://policy.test/' },
    });

    socket.receive({
      ...socket.sent[0]!,
      profileId: socket.resolvedProfileId!,
      type: 'apply_operation',
      payload: { expectedRevision: 0, operationId: 'op-wp-1', sourceEpoch: 1, steps: [step('step-wp-1')] },
    });
    await flush();
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'operation_receipt',
      payload: { operationId: 'op-wp-1', requestId: 'step-wp-1', state: 'failed', errorCode: 'WRITE_PAUSED' },
    });

    // Live write_policy(false) unpauses writes on the same connection without reconnect.
    socket.reply('write_policy', { writePaused: false });
    await flush();
    expect(ctx.sockets).toHaveLength(1);
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', writePaused: false, errorCode: null });

    socket.receive({
      ...socket.sent[0]!,
      profileId: socket.resolvedProfileId!,
      type: 'apply_operation',
      payload: { expectedRevision: 0, operationId: 'op-wp-2', sourceEpoch: 1, steps: [step('step-wp-2')] },
    });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'operation_receipt',
      payload: { operationId: 'op-wp-2', requestId: 'step-wp-2', state: 'applied', errorCode: null },
    });

    // Live write_policy(true) re-pauses writes on the same connection.
    socket.reply('write_policy', { writePaused: true });
    await flush();
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', writePaused: true, errorCode: null });

    socket.receive({
      ...socket.sent[0]!,
      profileId: socket.resolvedProfileId!,
      type: 'apply_operation',
      payload: { expectedRevision: 0, operationId: 'op-wp-3', sourceEpoch: 1, steps: [step('step-wp-3')] },
    });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'operation_receipt',
      payload: { operationId: 'op-wp-3', requestId: 'step-wp-3', state: 'failed', errorCode: 'WRITE_PAUSED' },
    });
  });

  it('rejects wrong profile/session and rejected hello before reading the tree; alarm cannot replay', async () => {
    for (const failure of ['profile', 'session', 'rejected'] as const) {
      const ctx = setup({
        'markbridge-bridge-prefs': { lastPort: 49153, profileId: 'profile-a', displayName: 'Chrome 资料 1', paused: false },
      }, { openPorts: [49153] });
      await ctx.bridge.start();
      await flush();
      const socket = ctx.sockets[0]!;
      socket.open();
      if (failure === 'rejected') {
        helloResult(socket, { accepted: false, profileId: null, displayName: null, errorCode: 'WRONG_PROFILE' });
      } else {
        socket.receive({
          ...socket.sent[0]!,
          profileId: failure === 'profile' ? 'profile-b' : 'profile-a',
          sessionId: failure === 'session' ? 'wrong-session' : socket.sent[0]!.sessionId,
          type: 'hello_result',
          payload: { accepted: true, profileId: 'profile-a', displayName: 'Chrome', sourceEpoch: 1, writePaused: false, errorCode: null },
        });
      }
      await flush();
      expect(ctx.api.bookmarks.getTree).not.toHaveBeenCalled();
      expect(ctx.bridge.getStatus().state).toBe('error');
      ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
      await flush();
      expect(ctx.sockets).toHaveLength(1);
    }
  });

  it('rejects content-script messages even when sender ID matches and rejects legacy pair/forget/capture commands', async () => {
    const ctx = setup();
    await ctx.bridge.start();
    const respond = vi.fn();
    ctx.api.runtime.onMessage.emit({ type: 'reconnect' }, { id: 'extension-id', url: 'https://example.test/' }, respond);
    await flush();
    expect(respond).not.toHaveBeenCalled();
    await expect(ctx.bridge.command({ type: 'pair', code: '{}' })).rejects.toThrow('INVALID_MESSAGE');
    await expect(ctx.bridge.command({ type: 'forget' })).rejects.toThrow('INVALID_MESSAGE');
    await expect(ctx.bridge.command({ type: 'capture' })).rejects.toThrow('INVALID_MESSAGE');
  });
});

describe('stable read-only synchronization', () => {
  it('registers before tree access, preserves roots and Chrome millisecond metadata', async () => {
    const ctx = setup();
    expect(Object.values(ctx.events).every(event => event.listeners.length === 1)).toBe(true);
    const socket = await synchronize(ctx);
    const snapshot = socket.sent.find(message => message.type === 'tree_full');
    expect(snapshot?.type).toBe('tree_full');
    if (snapshot?.type !== 'tree_full') throw new Error('missing snapshot');
    expect(snapshot.payload.nodes).toHaveLength(3);
    expect(snapshot.payload.nodes[1]!.folderType).toBe('bookmarks-bar');
    expect(snapshot.payload.nodes[2]!.dateAdded).toEqual({ source: 'chrome_api', unixMillis: 1234 });
    expect(snapshot.payload.nodes[2]!.dateLastUsed).toEqual({ source: 'chrome_api', unixMillis: 5678 });
    expect(ctx.bridge.getStatus()).toMatchObject({ state: 'connected', nodeCount: 3 });
  });

  it('discards snapshots invalidated by events and sends barrier before later increments', async () => {
    const ctx = setup();
    ctx.api.bookmarks.getTree.mockImplementationOnce(async () => {
      ctx.events.onChanged.emit('2', { title: 'changed' });
      return structuredClone(tree);
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
    const ctx = setup();
    ctx.api.bookmarks.getTree.mockImplementation(async () => { ctx.events.onChanged.emit('2', { title: 'busy' }); return structuredClone(tree); });
    const socket = await synchronize(ctx);
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(3);
    expect(socket.sent.some(message => message.type === 'tree_full')).toBe(false);
    expect(ctx.bridge.getStatus().state).toBe('reconciling');
    ctx.api.bookmarks.getTree.mockImplementation(async () => structuredClone(tree));
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
  });

  it('rejects incomplete full snapshots without reporting a successful send', async () => {
    for (const incomplete of [[], [{ id: '0', title: '', syncing: false }]]) {
      const ctx = setup();
      ctx.api.bookmarks.getTree.mockResolvedValue(incomplete);
      const socket = await synchronize(ctx);
      expect(socket.sent.some(message => message.type === 'tree_full')).toBe(false);
      expect(ctx.bridge.getStatus().state).toBe('error');
    }
  });

  it('normalizes create/change/move/remove/reorder/import and never calls write APIs', async () => {
    const ctx = setup();
    const socket = await synchronize(ctx);
    ctx.events.onCreated.emit('3', { id: '3', parentId: '1', index: 1, title: 'new', url: 'https://new.test/' });
    ctx.events.onChanged.emit('3', { title: 'renamed', url: 'https://changed.test/' });
    ctx.events.onMoved.emit('3', { oldParentId: '1', oldIndex: 1, parentId: '0', index: 1 });
    ctx.events.onRemoved.emit('3', { parentId: '0', index: 1, node: { id: '3', parentId: '0', index: 1, title: 'renamed', url: 'https://changed.test/' } });
    ctx.events.onChildrenReordered.emit('1', { childIds: ['2'] });
    ctx.events.onImportBegan.emit();
    ctx.events.onImportEnded.emit();
    await flush();
    const messages = socket.sent.filter(message => message.type === 'event');
    expect(messages.map(message => message.payload.event.kind)).toEqual(['created', 'changed', 'moved', 'removed', 'reordered', 'import_began', 'import_ended']);
    expect(messages.map(message => message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(socket.sent.at(-1)?.type).toBe('resync_required');
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'get_tree', requestId: 'desktop-import-tree', payload: {} });
    await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-import-tree' });
    for (const method of ['create', 'update', 'move', 'remove', 'removeTree'] as const) expect(ctx.api.bookmarks[method]).not.toHaveBeenCalled();
  });

  it('rejects apply_operation while reconciling and writes only after the snapshot is live', async () => {
    const ctx = setup();
    const socket = await synchronize(ctx);
    socket.reply('resync_required', { reason: 'INVALID_TREE' });
    await flush();
    expect(socket.sent.filter(message => message.type === 'tree_full')).toHaveLength(1);
    expect(ctx.bridge.getStatus().state).toBe('reconciling');
    const create = { requestId: 'step-a', target: null, expectedBefore: null, expectedChildIds: null, payload: { kind: 'create' as const, parentId: '1', position: 0, title: 'Added', url: 'https://added.test/' } };
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-a', sourceEpoch: 1, steps: [create] } });
    await flush();
    expect(ctx.bridge.getStatus().errorCode).toBe('READ_ONLY');
    expect(socket.sent.filter(message => message.type === 'operation_receipt')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ requestId: 'step-a', state: 'failed', errorCode: 'READ_ONLY' }) }),
    ]);
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();

    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'get_tree', requestId: 'desktop-resync-tree', payload: {} });
    await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-resync-tree' });
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-a', sourceEpoch: 2, steps: [create] } });
    await flush();
    expect(ctx.bridge.getStatus().errorCode).toBe('WRONG_PROFILE');
    expect(ctx.api.bookmarks.create).not.toHaveBeenCalled();

    ctx.api.bookmarks.create.mockImplementation(async (details: chrome.bookmarks.CreateDetails) => {
      const writes = ctx.localData['markbridge-writes'] as { pending?: Array<{ phase?: string; kind?: string }> } | undefined;
      expect(writes?.pending?.some((item) => item.kind === 'create' && item.phase === 'marker')).toBe(true);
      return { id: '9', parentId: details.parentId, index: details.index, title: details.title, url: details.url, syncing: false };
    });
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-live', sourceEpoch: 1, steps: [{ ...create, requestId: 'step-live' }] } });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.filter(message => message.type === 'operation_receipt' && message.payload.requestId === 'step-live')).toEqual([
      expect.objectContaining({ type: 'operation_receipt', payload: expect.objectContaining({ operationId: 'op-live', requestId: 'step-live', state: 'applied', errorCode: null }) }),
    ]);
    expect(ctx.localData['markbridge-writes']).toMatchObject({ receipts: [expect.objectContaining({ requestId: 'step-live', state: 'applied' })] });

    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'apply_operation', payload: { expectedRevision: 0, operationId: 'op-live', sourceEpoch: 1, steps: [{ ...create, requestId: 'step-live' }] } });
    await flush();
    expect(ctx.api.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(socket.sent.filter(message => message.type === 'operation_receipt' && message.payload.requestId === 'step-live')).toHaveLength(2);

    const writes = ctx.api.bookmarks.getTree.mock.calls.length;
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'get_operation_status', requestId: 'status-1', payload: { operationId: 'op-live' } });
    await flush();
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(writes);
    expect(socket.sent.at(-1)).toMatchObject({ type: 'operation_receipt', payload: { requestId: 'step-live', state: 'applied' } });
  });

  it('bounds conversion depth and count and preserves dynamic managed roots', () => {
    expect(flattenTree([{ id: 'managed', title: 'managed', syncing: false, folderType: 'managed', unmodifiable: 'managed', children: [] }])[0]).toMatchObject({ folderType: 'managed', unmodifiable: 'managed' });
    const root: chrome.bookmarks.BookmarkTreeNode = { id: '0', title: '', syncing: false, children: [] };
    let parent = root;
    for (let i = 1; i <= 256; i++) {
      const child = { id: String(i), title: '', syncing: false, children: [] };
      parent.children = [child];
      parent = child;
    }
    expect(() => flattenTree([root])).toThrow('LIMIT_EXCEEDED');
    expect(() => flattenTree(Array.from({ length: 100_001 }, (_, index) => ({ id: String(index), title: '', syncing: false })))).toThrow('LIMIT_EXCEEDED');
  });
});

describe('persistent recovery', () => {
  it('keeps heartbeat traffic under worker activity timeout and runs a five-minute full reconciliation', async () => {
    const ctx = setup();
    const socket = await synchronize(ctx);
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      socket.reply('pong');
      await flush();
    }
    expect(socket.sent.filter(message => message.type === 'ping')).toHaveLength(15);
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(1);
    expect(socket.sent.at(-1)?.type).toBe('resync_required');
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'get_tree', requestId: 'desktop-periodic-tree', payload: {} });
    await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-periodic-tree' });
    expect(ctx.api.bookmarks.getTree).toHaveBeenCalledTimes(2);
    expect(ctx.api.alarms.create).toHaveBeenCalledWith(RECOVERY_ALARM, { periodInMinutes: 0.5 });
  });

  it('recovers after timer loss using alarm/startup and reinitialization; explicit reconnect uses new session', async () => {
    const ctx = setup({}, { openPorts: [49153] });
    const socket = await synchronize(ctx);
    ctx.openPorts.clear();
    socket.close();
    await flush();
    expect(ctx.bridge.getStatus().state).toBe('disconnected');
    vi.clearAllTimers();
    const afterCloseCount = ctx.sockets.length;
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    await flush();
    expect(ctx.sockets.length).toBeGreaterThan(afterCloseCount);
    vi.clearAllTimers();
    const afterAlarmCount = ctx.sockets.length;
    ctx.api.runtime.onStartup.emit();
    await flush();
    expect(ctx.sockets.length).toBeGreaterThan(afterAlarmCount);
    ctx.openPorts.add(49153);
    await ctx.bridge.command({ type: 'reconnect' });
    await flush();
    const latest = ctx.sockets.at(-1)!;
    expect(ctx.sockets.at(-2)!.readyState).toBe(3);
    latest.open();
    expect(latest.sent[0]!.sessionId).not.toBe(socket.sent[0]!.sessionId);

    const restarted = setup(ctx.localData, { openPorts: [49153] });
    await restarted.bridge.start();
    await flush();
    restarted.sockets[0]!.open();
    expect(restarted.sockets[0]!.sent[0]).toMatchObject({
      type: 'hello',
      payload: { instanceId: socket.sent[0]!.type === 'hello' ? socket.sent[0]!.payload.instanceId : '' },
    });
    expect(restarted.bridge.getStatus().state).toBe('connecting');
    expect(restarted.api.bookmarks.getTree).not.toHaveBeenCalled();
  });

  it('coalesces periodic reconciliation and waits for the desktop request ID when both peers refresh', async () => {
    const ctx = setup();
    const socket = await synchronize(ctx);
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      socket.reply('pong');
      await flush();
    }
    ctx.api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    await flush();
    expect(socket.sent.filter(message => message.type === 'resync_required')).toHaveLength(1);
    const before = socket.sent.length;
    socket.reply('resync_required', { reason: 'INVALID_TREE' });
    await flush();
    ctx.events.onChanged.emit('2', { title: 'during reconciliation' });
    expect(socket.sent).toHaveLength(before);
    socket.receive({ ...socket.sent[0]!, profileId: socket.resolvedProfileId!, type: 'get_tree', requestId: 'desktop-overlap-tree', payload: {} });
    await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'tree_full', requestId: 'desktop-overlap-tree', payload: { barrierSeq: 1 } });
    ctx.events.onChanged.emit('2', { title: 'after reconciliation' });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'event', seq: 2 });
  });
});
