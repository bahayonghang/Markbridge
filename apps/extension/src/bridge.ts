import {
  BRIDGE_PORT_END,
  BRIDGE_PORT_START,
  encodeWireFrame,
  MAX_DEPTH,
  MAX_NODES,
  parseWireFrame,
  type BookmarkEvent,
  type BookmarkNode,
  type ErrorCode,
  type Receipt,
  type WireMessage,
} from '@markbridge/protocol';
import { parseStore, runSteps, statusReceipts, WRITE_KEY, type BookmarkPort } from './executor';

export const RECOVERY_ALARM = 'markbridge-recovery';
const PREFS_KEY = 'markbridge-bridge-prefs';
const INSTANCE_KEY = 'markbridge-instance';
const CANDIDATE_TIMEOUT_MS = 1500;
const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const;

type BridgePrefs = {
  lastPort: number | null;
  profileId: string | null;
  displayName: string | null;
  paused: boolean;
};

export type ExtensionStatus = {
  state: 'connecting' | 'reconciling' | 'connected' | 'paused' | 'disconnected' | 'error';
  profileId: string | null;
  displayName: string | null;
  instanceId: string | null;
  port: number | null;
  nodeCount: number;
  writePaused: boolean;
  errorCode: ErrorCode | null;
};

export function candidatePorts(
  lastPort: number | null,
  start = BRIDGE_PORT_START,
  end = BRIDGE_PORT_END,
): number[] {
  const ports: number[] = [];
  if (lastPort != null && Number.isInteger(lastPort) && lastPort >= start && lastPort <= end) {
    ports.push(lastPort);
  }
  for (let port = start; port <= end; port++) {
    if (port !== lastPort) ports.push(port);
  }
  return ports;
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function parsePrefs(value: unknown): BridgePrefs {
  if (!value || typeof value !== 'object') {
    return { lastPort: null, profileId: null, displayName: null, paused: false };
  }
  const raw = value as Record<string, unknown>;
  const lastPort = typeof raw.lastPort === 'number'
    && Number.isInteger(raw.lastPort)
    && raw.lastPort >= BRIDGE_PORT_START
    && raw.lastPort <= BRIDGE_PORT_END
    ? raw.lastPort
    : null;
  const profileId = isValidId(raw.profileId) && raw.profileId !== 'pending' ? raw.profileId : null;
  const displayName = typeof raw.displayName === 'string'
    && raw.displayName.trim().length > 0
    && raw.displayName.length <= 128
    ? raw.displayName
    : null;
  const paused = raw.paused === true;
  return { lastPort, profileId, displayName, paused };
}

export function flattenTree(roots: chrome.bookmarks.BookmarkTreeNode[], complete = false): BookmarkNode[] {
  const nodes: BookmarkNode[] = [];
  const stack = roots.map((node, position) => ({ node, position, depth: 1 })).reverse();
  while (stack.length) {
    const { node, position, depth } = stack.pop()!;
    if (depth > MAX_DEPTH || nodes.length >= MAX_NODES) throw new Error('LIMIT_EXCEEDED');
    if (complete && node.url === undefined && !Array.isArray(node.children)) throw new Error('INVALID_TREE');
    nodes.push({
      chromeId: node.id,
      parentId: node.parentId ?? null,
      position: node.index ?? position,
      title: node.title,
      kind: node.url === undefined ? 'folder' : 'bookmark',
      ...(node.url === undefined ? {} : { url: node.url }),
      ...(node.folderType === undefined ? {} : { folderType: node.folderType }),
      ...(node.unmodifiable === undefined ? {} : { unmodifiable: node.unmodifiable }),
      ...(node.dateAdded === undefined ? {} : { dateAdded: { source: 'chrome_api', unixMillis: node.dateAdded } }),
      ...(node.dateLastUsed === undefined ? {} : { dateLastUsed: { source: 'chrome_api', unixMillis: node.dateLastUsed } }),
    });
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index--) {
      stack.push({ node: node.children![index], position: index, depth: depth + 1 });
    }
  }
  return nodes;
}

export class ExtensionBridge {
  private prefs: BridgePrefs = { lastPort: null, profileId: null, displayName: null, paused: false };
  private instanceId = '';
  private socket: WebSocket | null = null;
  private sessionId = '';
  private authRequestId = '';
  private sentProfileId = 'pending';
  private activeProfileId: string | null = null;
  private activePort: number | null = null;
  private authenticated = false;
  private snapshotSent = false;
  private reconciliationRequested = false;
  private epoch = 1;
  private seq = 0;
  private changes = 0;
  private importing = false;
  private syncing = false;
  private syncRequested: string | null = null;
  private retry = 0;
  private stopped = false;
  private probing = false;
  private probeGeneration = 0;
  private probeUserInitiated = false;
  private probeQueue: number[] = [];
  private nodeCount = 0;
  private writePaused = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private authTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastReceived = 0;
  private lastSnapshot = 0;
  private incoming: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private status: ExtensionStatus = {
    state: 'disconnected',
    profileId: null,
    displayName: null,
    instanceId: null,
    port: null,
    nodeCount: 0,
    writePaused: false,
    errorCode: null,
  };

  constructor(private readonly api: typeof chrome, private readonly makeSocket = (url: string) => new WebSocket(url)) {
    // Listeners must exist before any asynchronous storage or tree access.
    api.bookmarks.onCreated.addListener((_id, node) => this.record(() => ({ kind: 'created', node: flattenTree([node])[0] })));
    api.bookmarks.onChanged.addListener((chromeId, info) => this.record(() => ({ kind: 'changed', chromeId, title: info.title, ...(info.url === undefined ? {} : { url: info.url }) })));
    api.bookmarks.onMoved.addListener((chromeId, info) => this.record(() => ({ kind: 'moved', chromeId, oldParentId: info.oldParentId, oldPosition: info.oldIndex, parentId: info.parentId, position: info.index })));
    api.bookmarks.onRemoved.addListener((chromeId, info) => this.record(() => ({ kind: 'removed', chromeId, parentId: info.parentId, position: info.index, subtree: flattenTree([info.node]) })));
    api.bookmarks.onChildrenReordered.addListener((parentId, info) => this.record(() => ({ kind: 'reordered', parentId, childIds: info.childIds })));
    api.bookmarks.onImportBegan.addListener(() => { this.importing = true; this.record(() => ({ kind: 'import_began' })); this.setStatus('reconciling'); });
    api.bookmarks.onImportEnded.addListener(() => { this.importing = false; this.record(() => ({ kind: 'import_ended' })); this.requestReconciliation(); });
    api.alarms.onAlarm.addListener(alarm => { if (alarm.name === RECOVERY_ALARM) void this.recover(); });
    api.runtime.onStartup.addListener(() => { void this.recover(); });
    api.runtime.onInstalled.addListener(() => { void this.recover(); });
    api.runtime.onMessage.addListener((message: unknown, sender, respond) => {
      if (sender.id !== api.runtime.id || !sender.url || ![api.runtime.getURL('index.html'), api.runtime.getURL('options.html')].includes(sender.url)) return false;
      void this.command(message).then(respond, () => respond({ errorCode: 'INVALID_MESSAGE' }));
      return true;
    });
    this.ready = this.initialize();
  }

  async start(): Promise<void> {
    await this.ready;
    if (this.prefs.paused || this.stopped) return;
    this.startProbe(false);
  }

  getStatus(): ExtensionStatus { return { ...this.status }; }

  private async initialize(): Promise<void> {
    await this.api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const local = await this.api.storage.local.get([PREFS_KEY, INSTANCE_KEY]);
    this.instanceId = isValidId(local[INSTANCE_KEY]) ? local[INSTANCE_KEY] : crypto.randomUUID();
    this.prefs = parsePrefs(local[PREFS_KEY]);
    await this.api.storage.local.set({ [INSTANCE_KEY]: this.instanceId });
    await this.api.alarms.create(RECOVERY_ALARM, { periodInMinutes: 0.5 });
    if (this.prefs.paused) {
      this.stopped = true;
      this.setStatus('paused');
    } else {
      this.stopped = false;
      this.setStatus('disconnected');
    }
  }

  private async savePrefs(): Promise<void> {
    await this.api.storage.local.set({ [PREFS_KEY]: { ...this.prefs } });
  }

  async command(value: unknown): Promise<ExtensionStatus> {
    await this.ready;
    if (!value || typeof value !== 'object') throw new Error('INVALID_MESSAGE');
    const message = value as Record<string, unknown>;
    if (message.type === 'status' && Object.keys(message).length === 1) return this.getStatus();
    if (message.type === 'reconnect' && Object.keys(message).length === 1) {
      this.prefs = { ...this.prefs, paused: false };
      await this.savePrefs();
      this.disconnect();
      this.probing = false;
      this.stopped = false;
      this.retry = 0;
      this.startProbe(true);
      return this.getStatus();
    }
    if (message.type === 'pause' && Object.keys(message).length === 1) {
      await this.enterPaused(null);
      return this.getStatus();
    }
    throw new Error('INVALID_MESSAGE');
  }

  private setStatus(state: ExtensionStatus['state'], errorCode: ErrorCode | null = null): void {
    this.status = {
      state,
      profileId: this.activeProfileId ?? this.prefs.profileId,
      displayName: this.prefs.displayName,
      instanceId: this.instanceId || null,
      port: this.activePort,
      nodeCount: this.nodeCount,
      writePaused: this.writePaused,
      errorCode,
    };
  }

  private async recover(): Promise<void> {
    await this.ready;
    if (this.prefs.paused || this.stopped) return;
    if (!this.socket && !this.probing) {
      this.startProbe(false);
    } else if (this.authenticated && Date.now() - this.lastSnapshot >= 300_000) {
      this.requestReconciliation();
    }
  }

  private startProbe(userInitiated: boolean): void {
    if (this.socket || this.probing || this.stopped || this.prefs.paused) return;
    clearTimeout(this.retryTimer);
    const generation = ++this.probeGeneration;
    this.probing = true;
    this.probeUserInitiated = userInitiated;
    this.probeQueue = candidatePorts(this.prefs.lastPort);
    this.probeNext(generation);
  }

  private probeNext(generation: number): void {
    if (generation !== this.probeGeneration || this.stopped || this.prefs.paused || this.authenticated) {
      this.probing = false;
      return;
    }
    const port = this.probeQueue.shift();
    if (port === undefined) {
      this.probing = false;
      this.probeUserInitiated = false;
      this.activePort = null;
      this.setStatus('disconnected');
      this.scheduleRetry();
      return;
    }
    clearTimeout(this.authTimer);
    this.activePort = port;
    this.sessionId = crypto.randomUUID();
    this.seq = 0;
    this.setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = this.makeSocket(`ws://127.0.0.1:${port}/`);
    } catch {
      this.probeNext(generation);
      return;
    }
    this.socket = socket;
    let settled = false;
    const advance = () => {
      if (settled) return;
      settled = true;
      clearTimeout(this.authTimer);
      if (this.socket === socket) {
        this.socket = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try { socket.close(); } catch { /* ignore */ }
      }
      if (generation === this.probeGeneration && !this.authenticated && !this.stopped && !this.prefs.paused) {
        this.probeNext(generation);
      }
    };
    this.authTimer = setTimeout(() => {
      if (this.socket === socket && !this.authenticated) advance();
    }, CANDIDATE_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket || generation !== this.probeGeneration) return;
      this.sendHello();
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      let parsed: WireMessage | null = null;
      try {
        if (typeof event.data !== 'string') throw new Error('INVALID_MESSAGE');
        parsed = parseWireFrame(event.data);
      } catch {
        // Handled in serialized incoming chain below.
      }
      const pauseSignal = this.matchPauseSignal(parsed);
      if (pauseSignal !== null) {
        settled = true;
        this.applyPausedState(pauseSignal);
        this.incoming = this.incoming.then(async () => {
          await this.savePrefs();
        });
        return;
      }
      this.incoming = this.incoming.then(async () => {
        if (this.socket !== socket) return;
        try {
          if (!parsed) throw new Error('INVALID_MESSAGE');
          const wasAuthenticated = this.authenticated;
          await this.receive(parsed, port);
          if (!wasAuthenticated && this.authenticated) settled = true;
        } catch {
          if (!this.authenticated) advance();
          else await this.reject('INVALID_MESSAGE');
        }
      });
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      if (!this.authenticated) advance();
      else this.disconnectAndRetry();
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if (!this.authenticated) advance();
      else this.disconnectAndRetry();
    };
  }

  private sendHello(): void {
    this.authRequestId = crypto.randomUUID();
    this.sentProfileId = this.prefs.profileId ?? 'pending';
    this.send({
      protocolVersion: 1,
      profileId: this.sentProfileId,
      sessionId: this.sessionId,
      type: 'hello',
      requestId: this.authRequestId,
      seq: null,
      payload: {
        instanceId: this.instanceId,
        ...(this.prefs.displayName ? { displayNameHint: this.prefs.displayName } : {}),
        userInitiated: this.probeUserInitiated,
      },
    });
  }

  private envelope<T extends WireMessage['type']>(type: T, requestId: string | null = null) {
    return {
      protocolVersion: 1,
      profileId: this.activeProfileId ?? this.sentProfileId,
      sessionId: this.sessionId,
      type,
      requestId,
      seq: null,
    };
  }

  private send(message: WireMessage): void {
    if (this.socket?.readyState !== 1) throw new Error('UNPAIRED');
    this.socket.send(encodeWireFrame(message));
  }

  private async receive(message: WireMessage, port: number): Promise<void> {
    this.lastReceived = Date.now();
    if (!this.authenticated) {
      if (
        message.type !== 'hello_result'
        || message.sessionId !== this.sessionId
        || message.requestId !== this.authRequestId
      ) {
        await this.reject(message.sessionId !== this.sessionId ? 'WRONG_PROFILE' : 'UNPAIRED');
        return;
      }
      if (!message.payload.accepted) {
        if (message.profileId !== this.sentProfileId) {
          await this.reject('WRONG_PROFILE');
          return;
        }
        const code = message.payload.errorCode ?? 'UNPAIRED';
        if (code === 'PROFILE_IGNORED') {
          await this.enterPaused('PROFILE_IGNORED');
          return;
        }
        await this.reject(code);
        return;
      }
      const resolvedProfile = message.payload.profileId;
      if (!resolvedProfile || resolvedProfile === 'pending' || message.profileId !== resolvedProfile) {
        await this.reject('WRONG_PROFILE');
        return;
      }
      this.activeProfileId = resolvedProfile;
      this.writePaused = message.payload.writePaused;
      this.prefs = {
        lastPort: port,
        profileId: resolvedProfile,
        displayName: message.payload.displayName ?? this.prefs.displayName,
        paused: false,
      };
      await this.savePrefs();
      this.authenticated = true;
      this.probing = false;
      this.probeUserInitiated = false;
      this.epoch = message.payload.sourceEpoch;
      this.retry = 0;
      clearTimeout(this.authTimer);
      this.setStatus('reconciling');
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        try {
          if (Date.now() - this.lastReceived > 45_000) { this.disconnectAndRetry(); return; }
          this.send({ ...this.envelope('ping', crypto.randomUUID()), payload: {} });
          if (Date.now() - this.lastSnapshot >= 300_000) this.requestReconciliation();
        } catch { this.disconnectAndRetry(); }
      }, 20_000);
      return;
    }

    if (message.profileId !== this.activeProfileId || message.sessionId !== this.sessionId) {
      await this.reject('WRONG_PROFILE');
      return;
    }

    switch (message.type) {
      case 'get_tree': this.reconciliationRequested = false; await this.reconcile(message.requestId!); return;
      // The desktop follows this notice with its correlated get_tree command.
      case 'resync_required': this.reconciliationRequested = true; this.snapshotSent = false; this.setStatus('reconciling'); return;
      case 'pause_sync': await this.enterPaused(message.payload.reason); return;
      case 'write_policy': this.writePaused = message.payload.writePaused; this.setStatus(this.status.state); return;
      case 'ping': this.send({ ...this.envelope('pong', message.requestId), payload: {} }); return;
      case 'pong': return;
      case 'apply_operation': await this.applyWrites(message); return;
      case 'get_operation_status': await this.reportStatus(message); return;
      default: await this.reject('READ_ONLY');
    }
  }

  private matchPauseSignal(message: WireMessage | null): ErrorCode | null {
    if (!message) return null;
    if (
      message.type === 'pause_sync'
      && this.authenticated
      && message.profileId === this.activeProfileId
      && message.sessionId === this.sessionId
    ) {
      return message.payload.reason;
    }
    if (
      message.type === 'hello_result'
      && !this.authenticated
      && message.sessionId === this.sessionId
      && message.requestId === this.authRequestId
      && message.profileId === this.sentProfileId
      && !message.payload.accepted
      && message.payload.errorCode === 'PROFILE_IGNORED'
    ) {
      return message.payload.errorCode;
    }
    return null;
  }

  private applyPausedState(errorCode: ErrorCode | null): void {
    this.probing = false;
    this.probeUserInitiated = false;
    this.stopped = true;
    this.prefs = { ...this.prefs, paused: true };
    this.disconnect();
    this.activePort = null;
    this.setStatus('paused', errorCode);
  }

  private async enterPaused(errorCode: ErrorCode | null): Promise<void> {
    this.applyPausedState(errorCode);
    await this.savePrefs();
  }

  private record(event: () => BookmarkEvent): void {
    this.changes++;
    this.seq++;
    if (!this.authenticated || !this.snapshotSent || this.syncing) return;
    try { this.send({ ...this.envelope('event'), seq: this.seq, payload: { sourceEpoch: this.epoch, event: event() } }); }
    catch { this.disconnectAndRetry(); }
  }

  private requestReconciliation(): void {
    if (!this.authenticated || this.reconciliationRequested || this.syncing) return;
    this.reconciliationRequested = true;
    this.snapshotSent = false;
    this.setStatus('reconciling');
    try { this.send({ ...this.envelope('resync_required'), payload: { reason: 'INVALID_TREE' } }); }
    catch { this.disconnectAndRetry(); }
  }

  private async reconcile(requestId: string): Promise<void> {
    if (!this.authenticated || !this.socket) return;
    if (this.syncing) { this.syncRequested = requestId; return; }
    clearTimeout(this.syncTimer);
    this.snapshotSent = false;
    this.syncing = true;
    this.setStatus('reconciling');
    const socket = this.socket;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.importing) break;
        const before = this.changes;
        const roots = await this.api.bookmarks.getTree();
        if (socket !== this.socket || !this.authenticated) return;
        if (before !== this.changes || this.importing) continue;
        if (roots.length === 0) throw new Error('INVALID_TREE');
        const nodes = flattenTree(roots, true);
        this.send({
          ...this.envelope('tree_full', requestId),
          payload: { sourceEpoch: this.epoch, barrierSeq: this.seq, revision: this.seq, nodes },
        });
        this.snapshotSent = true;
        this.nodeCount = nodes.length;
        this.lastSnapshot = Date.now();
        this.setStatus('connected');
        return;
      }
      this.syncTimer = setTimeout(() => { void this.reconcile(requestId); }, 1000);
    } catch {
      this.disconnectAndRetry();
      this.setStatus('error', 'INVALID_TREE');
    } finally {
      this.syncing = false;
      const next = this.syncRequested;
      this.syncRequested = null;
      if (next && this.authenticated) void this.reconcile(next);
    }
  }

  private disconnect(): void {
    this.probeGeneration += 1;
    clearTimeout(this.authTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.syncTimer);
    clearInterval(this.heartbeat);
    this.authenticated = false;
    this.snapshotSent = false;
    this.reconciliationRequested = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try { socket.close(); } catch { /* ignore */ }
    }
  }

  private disconnectAndRetry(): void {
    this.disconnect();
    this.probing = false;
    this.activePort = null;
    if (this.stopped || this.prefs.paused) return;
    this.setStatus('disconnected');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.prefs.paused) return;
    const seconds = BACKOFF_SECONDS[Math.min(this.retry++, BACKOFF_SECONDS.length - 1)]!;
    const delay = seconds * 1000 * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(() => this.startProbe(false), delay);
  }

  private canWrite(): boolean {
    return (
      this.authenticated
      && this.snapshotSent
      && !this.importing
      && this.status.state === 'connected'
      && this.socket?.readyState === 1
    );
  }

  private sendReceipt(receipt: Receipt): void {
    try { this.send({ ...this.envelope('operation_receipt', receipt.requestId), payload: receipt }); }
    catch { /* A lost ack stays unresolved until the desktop queries status. */ }
  }

  private async loadWrites() {
    const stored = await this.api.storage.local.get(WRITE_KEY);
    return parseStore(stored[WRITE_KEY]);
  }

  private failSteps(message: Extract<WireMessage, { type: 'apply_operation' }>, state: 'failed' | 'uncertain', errorCode: ErrorCode): void {
    this.setStatus(this.status.state, errorCode);
    for (const step of message.payload.steps) {
      this.sendReceipt({
        operationId: message.payload.operationId,
        requestId: step.requestId,
        state,
        before: null,
        after: null,
        beforeChildIds: null,
        afterChildIds: null,
        errorCode,
      });
    }
  }

  private async applyWrites(message: Extract<WireMessage, { type: 'apply_operation' }>): Promise<void> {
    if (!this.canWrite()) { this.failSteps(message, 'failed', 'READ_ONLY'); return; }
    if (this.writePaused) { this.failSteps(message, 'failed', 'WRITE_PAUSED'); return; }
    if (message.payload.sourceEpoch !== this.epoch) { this.failSteps(message, 'failed', 'WRONG_PROFILE'); return; }
    const store = await this.loadWrites();
    if (!store) { this.failSteps(message, 'uncertain', 'UNCERTAIN_WRITE'); return; }
    await runSteps({
      port: this.api.bookmarks as unknown as BookmarkPort,
      store,
      operationId: message.payload.operationId,
      steps: [...message.payload.steps],
      save: async () => { await this.api.storage.local.set({ [WRITE_KEY]: store }); },
      send: (receipt) => this.sendReceipt(receipt),
    });
    await this.api.storage.local.set({ [WRITE_KEY]: store });
  }

  private async reportStatus(message: Extract<WireMessage, { type: 'get_operation_status' }>): Promise<void> {
    if (!this.canWrite()) { this.setStatus(this.status.state, 'READ_ONLY'); return; }
    const store = await this.loadWrites();
    if (!store) { this.setStatus(this.status.state, 'UNCERTAIN_WRITE'); return; }
    const requestId = message.requestId ?? message.payload.operationId;
    for (const receipt of statusReceipts(store, message.payload.operationId, requestId)) this.sendReceipt(receipt);
  }

  private async reject(errorCode: ErrorCode): Promise<void> {
    this.disconnect();
    this.probing = false;
    this.probeUserInitiated = false;
    this.stopped = true;
    this.activePort = null;
    this.setStatus('error', errorCode);
  }
}
