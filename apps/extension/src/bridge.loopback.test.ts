// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createTcpServer, type Socket as NetSocket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_PORT_END,
  BRIDGE_PORT_START,
  encodeWireFrame,
  OFFICIAL_EXTENSION_ORIGIN,
  parseWireFrame,
  type WireMessage,
} from '@markbridge/protocol';
import { ExtensionBridge, RECOVERY_ALARM } from './bridge';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, len]), payload]);
  }
  if (len < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer: Buffer): { frames: Array<{ opcode: number; payload: Buffer }>; rest: Buffer } {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLen = second & 0x7f;
    let cursor = offset + 2;
    if (payloadLen === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLen === 127) {
      if (cursor + 8 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (cursor + maskLen + payloadLen > buffer.length) break;
    let payload = buffer.subarray(cursor + maskLen, cursor + maskLen + payloadLen);
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      const unmasked = Buffer.allocUnsafe(payloadLen);
      for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i]! ^ mask[i % 4]!;
      payload = unmasked;
    }
    frames.push({ opcode, payload });
    offset = cursor + maskLen + payloadLen;
  }
  return { frames, rest: buffer.subarray(offset) };
}

type PeerConnection = {
  origin: string | undefined;
  send(message: WireMessage): void;
  close(): void;
  nextMessage(timeoutMs?: number): Promise<WireMessage>;
};

async function createLoopbackWsServer(port: number) {
  const connections: PeerConnection[] = [];
  const sockets = new Set<NetSocket>();
  const waiters: Array<(conn: PeerConnection) => void> = [];

  const server: Server = createServer((_req, res) => {
    res.writeHead(404).end();
  });

  server.on('upgrade', (req: IncomingMessage, socket: NetSocket) => {
    const origin = req.headers.origin;
    const key = req.headers['sec-websocket-key'];
    if (origin !== OFFICIAL_EXTENSION_ORIGIN || typeof key !== 'string' || req.url !== '/') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const inbox: WireMessage[] = [];
    const msgWaiters: Array<{ resolve: (msg: WireMessage) => void; reject: (err: Error) => void }> = [];

    const conn: PeerConnection = {
      origin,
      send(message) {
        if (!socket.destroyed) socket.write(encodeWsFrame(0x1, Buffer.from(encodeWireFrame(message), 'utf8')));
      },
      close() {
        if (!socket.destroyed) {
          socket.write(encodeWsFrame(0x8, Buffer.alloc(0)));
          socket.end();
        }
      },
      nextMessage(timeoutMs = 5000) {
        const queued = inbox.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('TIMEOUT_WAITING_FOR_WS_MESSAGE')), timeoutMs);
          msgWaiters.push({
            resolve: (msg) => { clearTimeout(timer); resolve(msg); },
            reject: (err) => { clearTimeout(timer); reject(err); },
          });
        });
      },
    };

    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const { frames, rest } = decodeWsFrames(pending);
      pending = rest;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          socket.end();
          continue;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeWsFrame(0xA, frame.payload));
          continue;
        }
        if (frame.opcode === 0x1) {
          const parsed = parseWireFrame(frame.payload.toString('utf8'));
          const waiter = msgWaiters.shift();
          if (waiter) waiter.resolve(parsed);
          else inbox.push(parsed);
        }
      }
    });

    socket.on('close', () => {
      sockets.delete(socket);
      while (msgWaiters.length) {
        msgWaiters.shift()!.reject(new Error('WS_SOCKET_CLOSED'));
      }
    });

    const waiter = waiters.shift();
    if (waiter) waiter(conn);
    else connections.push(conn);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    port,
    acceptConnection(timeoutMs = 5000): Promise<PeerConnection> {
      const existing = connections.shift();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TIMEOUT_WAITING_FOR_WS_CONNECT')), timeoutMs);
        waiters.push((conn) => { clearTimeout(timer); resolve(conn); });
      });
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createTcpServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findFreeBridgePorts(minCount = 2): Promise<number[]> {
  const free: number[] = [];
  for (let port = BRIDGE_PORT_START; port <= BRIDGE_PORT_END; port++) {
    if (await isPortFree(port)) free.push(port);
  }
  if (free.length < minCount) {
    throw new Error(`Expected at least ${minCount} free ports in ${BRIDGE_PORT_START}..${BRIDGE_PORT_END}`);
  }
  return free;
}

class EventHub {
  listeners: ((...args: unknown[]) => unknown)[] = [];
  addListener = (listener: (...args: unknown[]) => unknown) => { this.listeners.push(listener); };
  emit(...args: unknown[]) { return this.listeners.map(listener => listener(...args)); }
}

const tree: chrome.bookmarks.BookmarkTreeNode[] = [{
  id: '0',
  title: '',
  syncing: false,
  children: [{
    id: '1',
    parentId: '0',
    index: 0,
    title: '栏',
    syncing: false,
    folderType: 'bookmarks-bar',
    children: [{
      id: '2',
      parentId: '1',
      index: 0,
      title: 'Loopback Bookmark',
      syncing: false,
      url: 'https://example.test/loopback',
    }],
  }],
}];

function createMockChrome(localData: Record<string, unknown> = {}) {
  const events = Object.fromEntries(
    ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'].map(
      name => [name, new EventHub()],
    ),
  );
  return {
    bookmarks: {
      ...events,
      getTree: vi.fn(async () => structuredClone(tree)),
      create: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
    },
    storage: {
      local: {
        setAccessLevel: vi.fn(async () => {}),
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, localData[key]])),
        ),
        set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(localData, value); }),
        remove: vi.fn(async (key: string) => { delete localData[key]; }),
      },
      sync: { set: vi.fn() },
    },
    alarms: { create: vi.fn(async () => {}), onAlarm: new EventHub() },
    runtime: {
      id: 'dfgpiejnjammdmmmdpdaembpclmgdbpf',
      getURL: (path: string) => `${OFFICIAL_EXTENSION_ORIGIN}/${path}`,
      onStartup: new EventHub(),
      onInstalled: new EventHub(),
      onMessage: new EventHub(),
    },
  };
}

async function waitForStatus(
  bridge: ExtensionBridge,
  predicate: (status: ReturnType<ExtensionBridge['getStatus']>) => boolean,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = bridge.getStatus();
    if (predicate(status)) return status;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for status; last=${JSON.stringify(bridge.getStatus())}`);
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
});

describe('real loopback WebSocket joint integration', () => {
  it('completes handshake, GetTree -> TreeFull, writePaused, PauseSync anti-bounce, and userInitiated reconnect over real loopback WebSockets', async () => {
    const freePorts = await findFreeBridgePorts(3);
    // Pick a port after at least one free lower port so ECONNREFUSED skipping is exercised over real TCP.
    const port1 = freePorts[Math.min(2, freePorts.length - 1)]!;
    const server1 = await createLoopbackWsServer(port1);
    cleanups.push(() => server1.close());

    const localData: Record<string, unknown> = {};
    const api = createMockChrome(localData);
    const probedUrls: string[] = [];
    const bridge = new ExtensionBridge(api as unknown as typeof chrome, url => {
      probedUrls.push(url);
      return Reflect.construct(WebSocket, [url, { headers: { origin: OFFICIAL_EXTENSION_ORIGIN } }]) as WebSocket;
    });
    cleanups.push(() => bridge.command({ type: 'pause' }).then(() => undefined, () => undefined));

    await bridge.start();
    const conn1 = await server1.acceptConnection();
    expect(conn1.origin).toBe(OFFICIAL_EXTENSION_ORIGIN);
    expect(probedUrls).toContain(`ws://127.0.0.1:${port1}/`);
    expect(probedUrls.indexOf(`ws://127.0.0.1:${freePorts[0]!}/`)).toBeLessThan(
      probedUrls.indexOf(`ws://127.0.0.1:${port1}/`),
    );

    const hello = await conn1.nextMessage();
    expect(hello.type).toBe('hello');
    if (hello.type !== 'hello') throw new Error('expected hello');
    expect(hello.payload.userInitiated).toBe(false);

    const profileId = 'p:loopback-1';
    conn1.send({
      protocolVersion: 1,
      type: 'hello_result',
      profileId,
      sessionId: hello.sessionId,
      requestId: hello.requestId,
      seq: null,
      payload: {
        accepted: true,
        profileId,
        displayName: '实机回环资料',
        sourceEpoch: 1,
        writePaused: true,
        errorCode: null,
      },
    });

    await waitForStatus(bridge, s => s.state === 'reconciling' && s.writePaused === true);

    conn1.send({
      protocolVersion: 1,
      type: 'get_tree',
      profileId,
      sessionId: hello.sessionId,
      requestId: 'tree-loop-1',
      seq: null,
      payload: {},
    });

    const snapshot = await conn1.nextMessage();
    expect(snapshot.type).toBe('tree_full');
    expect(snapshot.requestId).toBe('tree-loop-1');
    if (snapshot.type !== 'tree_full') throw new Error('expected tree_full');
    expect(snapshot.payload.nodes).toHaveLength(3);

    const live = await waitForStatus(bridge, s => s.state === 'connected');
    expect(live).toMatchObject({
      state: 'connected',
      profileId,
      displayName: '实机回环资料',
      port: port1,
      nodeCount: 3,
      writePaused: true,
      errorCode: null,
    });

    // Write-paused protects Chrome bookmarks even over a real live loopback socket.
    conn1.send({
      protocolVersion: 1,
      type: 'apply_operation',
      profileId,
      sessionId: hello.sessionId,
      requestId: 'op-req-1',
      seq: null,
      payload: {
        operationId: 'op-loop-wp',
        sourceEpoch: 1,
        expectedRevision: 0,
        steps: [{
          requestId: 'step-loop-wp',
          target: null,
          expectedBefore: null,
          expectedChildIds: null,
          payload: { kind: 'create', parentId: '1', position: 0, title: 'Blocked', url: 'https://blocked.test/' },
        }],
      },
    });
    const receipt = await conn1.nextMessage();
    expect(receipt).toMatchObject({
      type: 'operation_receipt',
      payload: { operationId: 'op-loop-wp', requestId: 'step-loop-wp', state: 'failed', errorCode: 'WRITE_PAUSED' },
    });
    expect(api.bookmarks.create).not.toHaveBeenCalled();

    // PauseSync anti-bounce + immediate close transitions cleanly to paused without bouncing back.
    conn1.send({
      protocolVersion: 1,
      type: 'pause_sync',
      profileId,
      sessionId: hello.sessionId,
      requestId: 'pause-loop-1',
      seq: null,
      payload: { reason: 'PROFILE_IGNORED' },
    });
    conn1.close();

    const paused = await waitForStatus(bridge, s => s.state === 'paused');
    expect(paused).toMatchObject({ state: 'paused', port: null, errorCode: 'PROFILE_IGNORED' });
    expect(localData['markbridge-bridge-prefs']).toMatchObject({
      lastPort: port1,
      profileId,
      displayName: '实机回环资料',
      paused: true,
    });

    const beforeAlarms = probedUrls.length;
    api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    api.runtime.onStartup.emit();
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(probedUrls).toHaveLength(beforeAlarms);

    // Explicit user reconnect clears paused and sends userInitiated: true, restoring live sync.
    await bridge.command({ type: 'reconnect' });
    const conn2 = await server1.acceptConnection();
    const hello2 = await conn2.nextMessage();
    expect(hello2.type).toBe('hello');
    if (hello2.type !== 'hello') throw new Error('expected second hello');
    expect(hello2.payload.userInitiated).toBe(true);
    expect(hello2.sessionId).not.toBe(hello.sessionId);

    conn2.send({
      protocolVersion: 1,
      type: 'hello_result',
      profileId,
      sessionId: hello2.sessionId,
      requestId: hello2.requestId,
      seq: null,
      payload: {
        accepted: true,
        profileId,
        displayName: '实机回环资料',
        sourceEpoch: 1,
        writePaused: false,
        errorCode: null,
      },
    });
    conn2.send({
      protocolVersion: 1,
      type: 'get_tree',
      profileId,
      sessionId: hello2.sessionId,
      requestId: 'tree-loop-2',
      seq: null,
      payload: {},
    });
    const snapshot2 = await conn2.nextMessage();
    expect(snapshot2).toMatchObject({ type: 'tree_full', requestId: 'tree-loop-2' });

    const reconnected = await waitForStatus(bridge, s => s.state === 'connected' && s.writePaused === false);
    expect(reconnected).toMatchObject({ state: 'connected', port: port1, writePaused: false, nodeCount: 3 });
  }, 15_000);

  it('recovers across real loopback port rollover and handles HelloResult(PROFILE_IGNORED) anti-bounce', async () => {
    const freePorts = await findFreeBridgePorts(2);
    const portA = freePorts[0]!;
    const portB = freePorts[1]!;
    const serverA = await createLoopbackWsServer(portA);
    let serverAOpen = true;
    cleanups.push(async () => { if (serverAOpen) await serverA.close(); });

    const localData: Record<string, unknown> = {};
    const api = createMockChrome(localData);
    const probedUrls: string[] = [];
    const bridge = new ExtensionBridge(api as unknown as typeof chrome, url => {
      probedUrls.push(url);
      return Reflect.construct(WebSocket, [url, { headers: { origin: OFFICIAL_EXTENSION_ORIGIN } }]) as WebSocket;
    });
    cleanups.push(() => bridge.command({ type: 'pause' }).then(() => undefined, () => undefined));

    await bridge.start();
    const connA = await serverA.acceptConnection();
    const helloA = await connA.nextMessage();
    if (helloA.type !== 'hello') throw new Error('expected helloA');

    const profileId = 'p:rollover-real';
    connA.send({
      protocolVersion: 1,
      type: 'hello_result',
      profileId,
      sessionId: helloA.sessionId,
      requestId: helloA.requestId,
      seq: null,
      payload: {
        accepted: true,
        profileId,
        displayName: '切换端口资料',
        sourceEpoch: 1,
        writePaused: false,
        errorCode: null,
      },
    });
    connA.send({
      protocolVersion: 1,
      type: 'get_tree',
      profileId,
      sessionId: helloA.sessionId,
      requestId: 'tree-roll-1',
      seq: null,
      payload: {},
    });
    await connA.nextMessage();
    await waitForStatus(bridge, s => s.state === 'connected' && s.port === portA);

    // Simulate desktop restarting on a different port in 49153..=49160.
    const serverB = await createLoopbackWsServer(portB);
    cleanups.push(() => serverB.close());
    await serverA.close();
    serverAOpen = false;
    probedUrls.length = 0;

    const connB1 = await serverB.acceptConnection();
    expect(probedUrls[0]).toBe(`ws://127.0.0.1:${portA}/`);
    expect(probedUrls).toContain(`ws://127.0.0.1:${portB}/`);

    const helloB1 = await connB1.nextMessage();
    if (helloB1.type !== 'hello') throw new Error('expected helloB1');
    expect(helloB1.payload.userInitiated).toBe(false);

    // Desktop rejects background hello because profile was ignored while offline.
    connB1.send({
      protocolVersion: 1,
      type: 'hello_result',
      profileId,
      sessionId: helloB1.sessionId,
      requestId: helloB1.requestId,
      seq: null,
      payload: {
        accepted: false,
        profileId: null,
        displayName: null,
        sourceEpoch: 1,
        writePaused: false,
        errorCode: 'PROFILE_IGNORED',
      },
    });
    connB1.close();

    const paused = await waitForStatus(bridge, s => s.state === 'paused');
    expect(paused).toMatchObject({ state: 'paused', port: null, errorCode: 'PROFILE_IGNORED' });
    expect(localData['markbridge-bridge-prefs']).toMatchObject({ paused: true });

    const urlCount = probedUrls.length;
    api.alarms.onAlarm.emit({ name: RECOVERY_ALARM });
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(probedUrls).toHaveLength(urlCount);

    await bridge.command({ type: 'reconnect' });
    const connB2 = await serverB.acceptConnection();
    const helloB2 = await connB2.nextMessage();
    if (helloB2.type !== 'hello') throw new Error('expected helloB2');
    expect(helloB2.payload.userInitiated).toBe(true);
    connB2.send({
      protocolVersion: 1,
      type: 'hello_result',
      profileId,
      sessionId: helloB2.sessionId,
      requestId: helloB2.requestId,
      seq: null,
      payload: {
        accepted: true,
        profileId,
        displayName: '切换端口资料',
        sourceEpoch: 1,
        writePaused: false,
        errorCode: null,
      },
    });
    connB2.send({
      protocolVersion: 1,
      type: 'get_tree',
      profileId,
      sessionId: helloB2.sessionId,
      requestId: 'tree-roll-2',
      seq: null,
      payload: {},
    });
    const snapB2 = await connB2.nextMessage();
    expect(snapB2).toMatchObject({ type: 'tree_full', requestId: 'tree-roll-2' });

    const liveB = await waitForStatus(bridge, s => s.state === 'connected' && s.port === portB);
    expect(liveB).toMatchObject({ state: 'connected', port: portB, displayName: '切换端口资料', nodeCount: 3 });
  }, 15_000);
});
