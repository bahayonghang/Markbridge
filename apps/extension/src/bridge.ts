import {
  encodeWireFrame, parseWireFrame, parseWireMessage, MAX_DEPTH, MAX_NODES,
  type BookmarkEvent, type BookmarkNode, type ErrorCode, type Receipt, type WireMessage,
} from '@markbridge/protocol';
import { parseStore, runSteps, statusReceipts, WRITE_KEY, type BookmarkPort } from './executor';

export const RECOVERY_ALARM = 'markbridge-recovery';
const AUTH_KEY = 'markbridge-auth';
const PENDING_KEY = 'markbridge-pending';
const INSTANCE_KEY = 'markbridge-instance';
type Auth = { port: number; profileId: string; credential: string };
type Pairing = Auth & { protocolVersion: 1; expiresAt: number };
export type ExtensionStatus = {
  state: 'unpaired' | 'connecting' | 'pending' | 'reconciling' | 'connected' | 'disconnected' | 'error';
  profileId: string | null; instanceId: string | null; nodeCount: number; errorCode: ErrorCode | null;
};

export function parsePairingCode(text: string, now = Date.now()): Pairing {
  if (text.length > 4096) throw new Error('INVALID_MESSAGE');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('INVALID_MESSAGE');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'credential,expiresAt,port,profileId,protocolVersion'
    || data.protocolVersion !== 1 || !Number.isInteger(data.port) || Number(data.port) < 1 || Number(data.port) > 65535
    || !Number.isSafeInteger(data.expiresAt) || Number(data.expiresAt) <= now || Number(data.expiresAt) > now + 120_000) {
    throw new Error('INVALID_MESSAGE');
  }
  // The existing wire schema owns identity, credential and Unicode limits.
  parseWireMessage({ protocolVersion: 1, type: 'pair', profileId: data.profileId, sessionId: 'validation',
    requestId: 'validation', seq: null, payload: { instanceId: 'validation', displayName: 'Chrome', credential: data.credential } });
  return data as Pairing;
}

export function flattenTree(roots: chrome.bookmarks.BookmarkTreeNode[], complete = false): BookmarkNode[] {
  const nodes: BookmarkNode[] = [];
  const stack = roots.map((node, position) => ({ node, position, depth: 1 })).reverse();
  while (stack.length) {
    const { node, position, depth } = stack.pop()!;
    if (depth > MAX_DEPTH || nodes.length >= MAX_NODES) throw new Error('LIMIT_EXCEEDED');
    if (complete && node.url === undefined && !Array.isArray(node.children)) throw new Error('INVALID_TREE');
    nodes.push({ chromeId: node.id, parentId: node.parentId ?? null, position: node.index ?? position,
      title: node.title, kind: node.url === undefined ? 'folder' : 'bookmark',
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
  private auth: Auth | null = null;
  private pending: Pairing | null = null;
  private instanceId = '';
  private socket: WebSocket | null = null;
  private sessionId = '';
  private authRequestId = '';
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
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private authTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastReceived = 0;
  private lastSnapshot = 0;
  private incoming: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private status: ExtensionStatus = { state: 'unpaired', profileId: null, instanceId: null, nodeCount: 0, errorCode: null };

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

  async start(): Promise<void> { await this.ready; this.connect(); }
  getStatus(): ExtensionStatus { return { ...this.status }; }

  private async initialize(): Promise<void> {
    await this.api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await this.api.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const local = await this.api.storage.local.get([AUTH_KEY, INSTANCE_KEY]);
    this.instanceId = typeof local[INSTANCE_KEY] === 'string' ? local[INSTANCE_KEY] : crypto.randomUUID();
    await this.api.storage.local.set({ [INSTANCE_KEY]: this.instanceId });
    if (local[AUTH_KEY]) {
      const value = local[AUTH_KEY];
      try {
        const checked = parsePairingCode(JSON.stringify({ ...value, protocolVersion: 1, expiresAt: Date.now() + 120_000 }));
        this.auth = { port: checked.port, profileId: checked.profileId, credential: checked.credential };
      } catch { await this.api.storage.local.remove(AUTH_KEY); }
    }
    const session = await this.api.storage.session.get(PENDING_KEY);
    if (session[PENDING_KEY]) {
      try { this.pending = parsePairingCode(JSON.stringify(session[PENDING_KEY])); }
      catch { await this.api.storage.session.remove(PENDING_KEY); }
    }
    await this.api.alarms.create(RECOVERY_ALARM, { periodInMinutes: 0.5 });
    this.setStatus(this.auth || this.pending ? 'disconnected' : 'unpaired');
  }

  async command(value: unknown): Promise<ExtensionStatus> {
    await this.ready;
    if (!value || typeof value !== 'object') throw new Error('INVALID_MESSAGE');
    const message = value as Record<string, unknown>;
    if (message.type === 'status' && Object.keys(message).length === 1) return this.getStatus();
    if (message.type === 'pair' && typeof message.code === 'string' && Object.keys(message).length === 2) {
      if (this.auth) throw new Error('CONFLICT');
      const pending = parsePairingCode(message.code);
      this.disconnect(); this.pending = pending; this.stopped = false; this.retry = 0;
      await this.api.storage.session.set({ [PENDING_KEY]: pending });
      this.connect();
    } else if (message.type === 'reconnect' && Object.keys(message).length === 1) {
      this.disconnect(); this.stopped = false; this.retry = 0; this.connect();
    } else if (message.type === 'forget' && Object.keys(message).length === 1) {
      this.disconnect(); this.auth = null; this.pending = null; this.stopped = true;
      await this.api.storage.local.remove(AUTH_KEY); await this.api.storage.session.remove(PENDING_KEY);
      this.setStatus('unpaired');
    } else throw new Error('INVALID_MESSAGE');
    return this.getStatus();
  }

  private setStatus(state: ExtensionStatus['state'], errorCode: ErrorCode | null = null): void {
    this.status = { ...this.status, state, errorCode, instanceId: this.instanceId || null, profileId: (this.auth ?? this.pending)?.profileId ?? null };
  }
  private async recover(): Promise<void> {
    await this.ready;
    if (!this.socket) this.connect();
    else if (this.authenticated && Date.now() - this.lastSnapshot >= 300_000) this.requestReconciliation();
  }
  private connect(): void {
    if (this.socket || this.stopped) return;
    if (this.pending && this.pending.expiresAt <= Date.now()) {
      this.pending = null; void this.api.storage.session.remove(PENDING_KEY); this.setStatus('unpaired', 'UNPAIRED');
    }
    const identity = this.auth ?? this.pending;
    if (!identity) return;
    clearTimeout(this.retryTimer);
    this.sessionId = crypto.randomUUID(); this.seq = 0; this.setStatus('connecting');
    let socket: WebSocket;
    try { socket = this.makeSocket(`ws://127.0.0.1:${identity.port}/`); }
    catch { this.scheduleRetry(); return; }
    this.socket = socket;
    this.authTimer = setTimeout(() => { if (this.socket === socket && !this.authenticated) this.disconnectAndRetry(); }, 5000);
    socket.onopen = () => { if (this.socket !== socket) return; this.sendAuth(); };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.incoming = this.incoming.then(async () => {
        if (this.socket !== socket) return;
        try {
          if (typeof event.data !== 'string') throw new Error('INVALID_MESSAGE');
          await this.receive(parseWireFrame(event.data));
        } catch { await this.reject('INVALID_MESSAGE'); }
      });
    };
    socket.onerror = () => { if (this.socket === socket) this.disconnectAndRetry(); };
    socket.onclose = () => { if (this.socket === socket) this.disconnectAndRetry(); };
  }
  private sendAuth(): void {
    const identity = this.auth ?? this.pending;
    if (!identity) return;
    this.authRequestId = crypto.randomUUID();
    const base = this.envelope(this.auth ? 'hello' : 'pair', this.authRequestId);
    if (this.auth) this.send({ ...base, type: 'hello', payload: { instanceId: this.instanceId, credential: identity.credential } });
    else this.send({ ...base, type: 'pair', payload: { instanceId: this.instanceId, credential: identity.credential, displayName: 'Chrome' } });
  }
  private envelope<T extends WireMessage['type']>(type: T, requestId: string | null = null) {
    return { protocolVersion: 1, profileId: (this.auth ?? this.pending)!.profileId, sessionId: this.sessionId, type, requestId, seq: null };
  }
  private send(message: WireMessage): void {
    if (this.socket?.readyState !== 1) throw new Error('UNPAIRED');
    this.socket.send(encodeWireFrame(message));
  }
  private async receive(message: WireMessage): Promise<void> {
    const identity = this.auth ?? this.pending;
    if (!identity || message.profileId !== identity.profileId || message.sessionId !== this.sessionId) { await this.reject('WRONG_PROFILE'); return; }
    this.lastReceived = Date.now();
    if (message.type === 'pair_result' && !this.authenticated && this.pending && message.requestId === this.authRequestId) {
      if (!message.payload.accepted) {
        if (message.payload.errorCode === 'UNPAIRED' && this.pending.expiresAt > Date.now()) {
          this.disconnectAndRetry(); this.setStatus('pending');
        } else await this.reject(message.payload.errorCode ?? 'UNPAIRED');
        return;
      }
      if (!message.payload.credential) { await this.reject('INVALID_MESSAGE'); return; }
      this.auth = { port: this.pending.port, profileId: identity.profileId, credential: message.payload.credential };
      await this.api.storage.local.set({ [AUTH_KEY]: this.auth });
      this.pending = null; await this.api.storage.session.remove(PENDING_KEY); this.sendAuth(); return;
    }
    if (message.type === 'hello_result' && !this.authenticated && this.auth && message.requestId === this.authRequestId) {
      if (!message.payload.accepted) { await this.reject(message.payload.errorCode ?? 'UNPAIRED'); return; }
      this.authenticated = true; this.epoch = message.payload.sourceEpoch; this.retry = 0;
      clearTimeout(this.authTimer); this.setStatus('reconciling');
      this.heartbeat = setInterval(() => {
        try {
          if (Date.now() - this.lastReceived > 45_000) { this.disconnectAndRetry(); return; }
          this.send({ ...this.envelope('ping', crypto.randomUUID()), payload: {} });
          if (Date.now() - this.lastSnapshot >= 300_000) this.requestReconciliation();
        } catch { this.disconnectAndRetry(); }
      }, 20_000);
      return;
    }
    if (!this.authenticated) { await this.reject('UNPAIRED'); return; }
    switch (message.type) {
      case 'get_tree': this.reconciliationRequested = false; await this.reconcile(message.requestId!); return;
      // The desktop follows this notice with its correlated get_tree command.
      case 'resync_required': this.reconciliationRequested = true; this.snapshotSent = false; this.setStatus('reconciling'); return;
      case 'ping': this.send({ ...this.envelope('pong', message.requestId), payload: {} }); return;
      case 'pong': return;
      case 'apply_operation': await this.applyWrites(message); return;
      case 'get_operation_status': await this.reportStatus(message); return;
      default: await this.reject('READ_ONLY');
    }
  }
  private record(event: () => BookmarkEvent): void {
    this.changes++; this.seq++;
    if (!this.authenticated || !this.snapshotSent || this.syncing) return;
    try { this.send({ ...this.envelope('event'), seq: this.seq, payload: { sourceEpoch: this.epoch, event: event() } }); }
    catch { this.disconnectAndRetry(); }
  }
  private requestReconciliation(): void {
    if (!this.authenticated || this.reconciliationRequested || this.syncing) return;
    this.reconciliationRequested = true; this.snapshotSent = false; this.setStatus('reconciling');
    try { this.send({ ...this.envelope('resync_required'), payload: { reason: 'INVALID_TREE' } }); }
    catch { this.disconnectAndRetry(); }
  }
  private async reconcile(requestId: string): Promise<void> {
    if (!this.authenticated || !this.socket) return;
    if (this.syncing) { this.syncRequested = requestId; return; }
    clearTimeout(this.syncTimer);
    this.snapshotSent = false;
    this.syncing = true; this.setStatus('reconciling');
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
        this.send({ ...this.envelope('tree_full', requestId), payload: { sourceEpoch: this.epoch, barrierSeq: this.seq, revision: this.seq, nodes } });
        this.snapshotSent = true;
        this.status.nodeCount = nodes.length; this.lastSnapshot = Date.now(); this.setStatus('connected');
        return;
      }
      this.syncTimer = setTimeout(() => { void this.reconcile(requestId); }, 1000);
    } catch {
      this.disconnectAndRetry(); this.setStatus('error', 'INVALID_TREE');
    } finally {
      this.syncing = false;
      const next = this.syncRequested; this.syncRequested = null;
      if (next && this.authenticated) void this.reconcile(next);
    }
  }
  private disconnect(): void {
    clearTimeout(this.authTimer); clearTimeout(this.retryTimer); clearTimeout(this.syncTimer); clearInterval(this.heartbeat);
    this.authenticated = false; this.snapshotSent = false; this.reconciliationRequested = false;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onclose = null; socket.onerror = null; socket.close(); }
  }
  private disconnectAndRetry(): void { this.disconnect(); this.setStatus('disconnected'); this.scheduleRetry(); }
  private scheduleRetry(): void {
    if (this.stopped || (!this.auth && !this.pending)) return;
    const seconds = [1, 2, 4, 8, 16, 30][Math.min(this.retry++, 5)];
    const delay = seconds * 1000 * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(() => this.connect(), this.pending ? Math.max(0, Math.min(delay, this.pending.expiresAt - Date.now())) : delay);
  }
  private canWrite(): boolean {
    return this.authenticated && this.snapshotSent && !this.importing && this.status.state === 'connected' && this.socket?.readyState === 1;
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
      this.sendReceipt({ operationId: message.payload.operationId, requestId: step.requestId, state, before: null, after: null, beforeChildIds: null, afterChildIds: null, errorCode });
    }
  }
  private async applyWrites(message: Extract<WireMessage, { type: 'apply_operation' }>): Promise<void> {
    if (!this.canWrite()) { this.failSteps(message, 'failed', 'READ_ONLY'); return; }
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
    this.disconnect(); this.stopped = true; this.auth = null; this.pending = null;
    await this.api.storage.local.remove(AUTH_KEY); await this.api.storage.session.remove(PENDING_KEY);
    this.setStatus('error', errorCode);
  }
}
