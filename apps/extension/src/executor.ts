import { MAX_DEPTH, MAX_NODES, type BookmarkNode, type OperationState, type OperationStep, type Receipt } from '@markbridge/protocol';

export type Interrupt = 'before-effect' | 'after-effect' | 'before-ack' | 'after-ack' | null;
export const WRITE_KEY = 'markbridge-writes';
const MAX_RECEIPTS = 1000;

export type BookmarkPort = {
  getTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  create(bookmark: chrome.bookmarks.CreateDetails): Promise<chrome.bookmarks.BookmarkTreeNode>;
  update(id: string, changes: chrome.bookmarks.UpdateChanges): Promise<chrome.bookmarks.BookmarkTreeNode>;
  move(id: string, destination: chrome.bookmarks.MoveDestination): Promise<chrome.bookmarks.BookmarkTreeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
};

type PendingWrite = {
  operationId: string;
  requestId: string;
  kind: 'create' | 'delete' | 'update' | 'move' | 'reorder';
  phase: 'marker' | 'effect';
};

export type WriteStore = { pending: PendingWrite[]; receipts: Receipt[] };

export function emptyStore(): WriteStore {
  return { pending: [], receipts: [] };
}

export function parseStore(value: unknown): WriteStore | null {
  if (value == null) return emptyStore();
  if (typeof value !== 'object') return null;
  const data = value as { pending?: unknown; receipts?: unknown };
  if (!Array.isArray(data.pending) || !Array.isArray(data.receipts)) return null;
  return { pending: data.pending as PendingWrite[], receipts: data.receipts as Receipt[] };
}

let interrupt: Interrupt = null;
export function setWriteInterrupt(value: Interrupt): void {
  interrupt = value;
}

export function remember(store: WriteStore, body: Receipt): void {
  store.pending = store.pending.filter((item) => item.requestId !== body.requestId);
  store.receipts = store.receipts.filter((item) => item.requestId !== body.requestId);
  store.receipts.push(body);
  while (store.receipts.length > MAX_RECEIPTS) store.receipts.shift();
}

export async function runSteps(input: {
  port: BookmarkPort;
  store: WriteStore;
  operationId: string;
  steps: OperationStep[];
  interrupt?: Interrupt;
  save?: () => Promise<void>;
  send: (receipt: Receipt) => void;
}): Promise<void> {
  const pause = input.interrupt === undefined ? interrupt : input.interrupt;
  const save = input.save ?? (async () => {});
  const createdByRequest = new Map<string, string>();
  let stop = false;
  for (const step of input.steps) {
    if (stop) return;
    const stored = input.store.receipts.find((item) => item.requestId === step.requestId);
    if (stored) {
      rememberCreate(createdByRequest, step, stored);
      input.send(stored);
      if (stored.state !== 'applied') stop = true;
      continue;
    }
    const pending = input.store.pending.find((item) => item.requestId === step.requestId);
    if (pending && (pending.kind === 'create' || pending.kind === 'delete' || pending.phase === 'effect')) {
      const uncertain = receipt(input.operationId, step.requestId, 'uncertain', { errorCode: 'UNCERTAIN_WRITE' });
      remember(input.store, uncertain);
      await save();
      if (pause !== 'before-ack') input.send(uncertain);
      stop = true;
      continue;
    }
    const kind = step.payload.kind;
    input.store.pending.push({ operationId: input.operationId, requestId: step.requestId, kind, phase: 'marker' });
    await save();
    if (pause === 'before-effect') return;
    let body: Receipt;
    try {
      body = await executeStep(input.port, input.operationId, step, createdByRequest);
    } catch {
      body = receipt(input.operationId, step.requestId, 'uncertain', { errorCode: 'UNCERTAIN_WRITE' });
    }
    const current = input.store.pending.find((item) => item.requestId === step.requestId);
    if (current) current.phase = 'effect';
    await save();
    if (pause === 'after-effect') return;
    remember(input.store, body);
    rememberCreate(createdByRequest, step, body);
    await save();
    if (pause === 'before-ack') return;
    input.send(body);
    if (pause === 'after-ack') return;
    if (body.state !== 'applied') stop = true;
  }
}

export function statusReceipts(store: WriteStore, operationId: string, requestId: string): Receipt[] {
  const found = store.receipts.filter((item) => item.operationId === operationId);
  if (found.length > 0) return found;
  const pending = store.pending.filter((item) => item.operationId === operationId);
  if (pending.length > 0) return pending.map((item) => receipt(operationId, item.requestId, 'uncertain', { errorCode: 'UNCERTAIN_WRITE' }));
  return [receipt(operationId, requestId, 'uncertain', { errorCode: 'UNCERTAIN_WRITE' })];
}

function rememberCreate(createdByRequest: Map<string, string>, step: OperationStep, body: Receipt): void {
  if (step.payload.kind === 'create' && body.state === 'applied' && body.after?.chromeId) createdByRequest.set(step.requestId, body.after.chromeId);
}

async function executeStep(port: BookmarkPort, operationId: string, step: OperationStep, createdByRequest: Map<string, string>): Promise<Receipt> {
  const nodes = flatten(await port.getTree());
  const byId = new Map(nodes.map((node) => [node.chromeId, node]));
  if (step.payload.kind === 'create') {
    let parentId = step.payload.parentId;
    if (!byId.has(parentId)) {
      const mapped = createdByRequest.get(parentId);
      if (!mapped) return receipt(operationId, step.requestId, 'failed', { errorCode: 'CONFLICT' });
      parentId = mapped;
    }
    const parent = byId.get(parentId);
    if (!parent || !canCreate(parent, byId)) return receipt(operationId, step.requestId, 'failed', { errorCode: 'PROTECTED_NODE' });
    const created = await port.create({ parentId, index: step.payload.position, title: step.payload.title, ...(step.payload.url ? { url: step.payload.url } : {}) });
    const after = flatten([created])[0];
    return after ? receipt(operationId, step.requestId, 'applied', { after }) : receipt(operationId, step.requestId, 'uncertain', { errorCode: 'UNCERTAIN_WRITE' });
  }
  const target = step.target ? byId.get(step.target) : undefined;
  if (!target || !same(target, step.expectedBefore)) return receipt(operationId, step.requestId, 'failed', { errorCode: 'CONFLICT', before: target ?? null });
  if (step.payload.kind === 'update') {
    if (fixed(target) || underManaged(target, byId)) return receipt(operationId, step.requestId, 'failed', { errorCode: 'PROTECTED_NODE', before: target });
    const updated = await port.update(target.chromeId, { ...(step.payload.title != null ? { title: step.payload.title } : {}), ...(step.payload.url != null ? { url: step.payload.url } : {}) });
    return receipt(operationId, step.requestId, 'applied', { before: target, after: flatten([updated])[0] ?? null });
  }
  if (step.payload.kind === 'move') {
    if (!canMove(target, byId) || contains(byId, target.chromeId, step.payload.parentId)) return receipt(operationId, step.requestId, 'failed', { errorCode: contains(byId, target.chromeId, step.payload.parentId) ? 'INVALID_TREE' : 'PROTECTED_NODE', before: target });
    const parent = byId.get(step.payload.parentId);
    if (!parent || !canCreate(parent, byId)) return receipt(operationId, step.requestId, 'failed', { errorCode: 'PROTECTED_NODE', before: target });
    const moved = await port.move(target.chromeId, { parentId: step.payload.parentId, index: step.payload.position });
    return receipt(operationId, step.requestId, 'applied', { before: target, after: flatten([moved])[0] ?? null });
  }
  if (step.payload.kind === 'reorder') {
    const parent = byId.get(step.target ?? '');
    const current = children(nodes, step.target ?? '').map((node) => node.chromeId);
    if (!parent || !canCreate(parent, byId) || parent.parentId == null || !sameIds(current, step.expectedChildIds ?? [])) {
      return receipt(operationId, step.requestId, 'failed', { errorCode: parent && fixed(parent) ? 'PROTECTED_NODE' : 'CONFLICT', before: parent ?? null, beforeChildIds: current });
    }
    for (let index = 0; index < step.payload.childIds.length; index += 1) {
      await port.move(step.payload.childIds[index]!, { parentId: parent.chromeId, index });
    }
    const afterIds = children(flatten(await port.getTree()), parent.chromeId).map((node) => node.chromeId);
    const applied = sameIds(afterIds, step.payload.childIds) && afterIds.join() === step.payload.childIds.join();
    return receipt(operationId, step.requestId, applied ? 'applied' : 'failed', { before: parent, after: parent, beforeChildIds: current, afterChildIds: afterIds, errorCode: applied ? null : 'CONFLICT' });
  }
  if (!canMove(target, byId)) return receipt(operationId, step.requestId, 'failed', { errorCode: 'PROTECTED_NODE', before: target });
  if (target.kind === 'folder') await port.removeTree(target.chromeId);
  else await port.remove(target.chromeId);
  return receipt(operationId, step.requestId, 'applied', { before: target, after: null });
}

function receipt(operationId: string, requestId: string, state: OperationState, extra: Partial<Receipt> = {}): Receipt {
  return { operationId, requestId, state, before: extra.before ?? null, after: extra.after ?? null, beforeChildIds: extra.beforeChildIds ?? null, afterChildIds: extra.afterChildIds ?? null, errorCode: extra.errorCode ?? null };
}

function flatten(roots: chrome.bookmarks.BookmarkTreeNode[]): BookmarkNode[] {
  const nodes: BookmarkNode[] = [];
  const stack = roots.map((node, position) => ({ node, position, depth: 1 })).reverse();
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > MAX_DEPTH || nodes.length >= MAX_NODES) throw new Error('LIMIT_EXCEEDED');
    nodes.push({
      chromeId: current.node.id,
      parentId: current.node.parentId ?? null,
      position: current.node.index ?? current.position,
      title: current.node.title,
      kind: current.node.url === undefined ? 'folder' : 'bookmark',
      ...(current.node.url === undefined ? {} : { url: current.node.url }),
      ...(current.node.folderType === undefined ? {} : { folderType: current.node.folderType }),
      ...(current.node.unmodifiable === undefined ? {} : { unmodifiable: current.node.unmodifiable }),
    });
    for (let index = (current.node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({ node: current.node.children![index]!, position: index, depth: current.depth + 1 });
    }
  }
  return nodes;
}

function children(nodes: BookmarkNode[], parentId: string): BookmarkNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort((left, right) => left.position - right.position || left.chromeId.localeCompare(right.chromeId));
}

function fixed(node: BookmarkNode): boolean {
  return node.parentId == null || node.folderType != null || node.unmodifiable === 'managed';
}

function underManaged(node: BookmarkNode, byId: Map<string, BookmarkNode>): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (!seen.add(parentId)) return true;
    const parent = byId.get(parentId);
    if (!parent) return true;
    if (parent.folderType === 'managed' || parent.unmodifiable === 'managed') return true;
    parentId = parent.parentId ?? null;
  }
  return false;
}

function canMove(node: BookmarkNode, byId: Map<string, BookmarkNode>): boolean {
  return !fixed(node) && !underManaged(node, byId);
}

function canCreate(parent: BookmarkNode, byId: Map<string, BookmarkNode>): boolean {
  return parent.kind === 'folder' && parent.folderType !== 'managed' && parent.unmodifiable == null && !underManaged(parent, byId);
}

function contains(byId: Map<string, BookmarkNode>, ancestor: string, node: string): boolean {
  if (ancestor === node) return true;
  let parentId = byId.get(node)?.parentId ?? null;
  const seen = new Set<string>();
  while (parentId) {
    if (parentId === ancestor) return true;
    if (!seen.add(parentId)) return true;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function same(actual: BookmarkNode | undefined, expected: BookmarkNode | null | undefined): boolean {
  if (!actual || !expected) return false;
  return actual.chromeId === expected.chromeId && actual.parentId === expected.parentId && actual.position === expected.position && actual.kind === expected.kind && actual.title === expected.title && (actual.url ?? null) === (expected.url ?? null) && (actual.folderType ?? null) === (expected.folderType ?? null) && (actual.unmodifiable ?? null) === (expected.unmodifiable ?? null);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
