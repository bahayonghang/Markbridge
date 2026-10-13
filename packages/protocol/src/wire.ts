import validate from './generated/wire-message.validator.js';
import type { BookmarkNode, TreeSnapshot, WireMessage } from './generated/wire-message';

export type * from './generated/wire-message';
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_NODES = 100_000;
export const MAX_DEPTH = 256;

function invalid(code = 'INVALID_MESSAGE'): never { throw new Error(code); }

function validUnicode(value: unknown): void {
  if (typeof value === 'string') {
    // Rust strings cannot represent unpaired UTF-16 surrogates.
    if (/[\uD800-\uDFFF]/u.test(value)) invalid();
  } else if (Array.isArray(value)) {
    for (const item of value) validUnicode(item);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) validUnicode(item);
  }
}
function validateNode(node: BookmarkNode): void {
  if (node.kind === 'folder' ? node.url != null : node.url == null || node.folderType != null) invalid('INVALID_TREE');
}
function validateIds(ids: string[]): void {
  if (ids.length > MAX_NODES || new Set(ids).size !== ids.length) invalid();
}
export function validateTree(snapshot: TreeSnapshot): void {
  if (snapshot.nodes.length > MAX_NODES) invalid('LIMIT_EXCEEDED');
  const nodes = new Map<string, BookmarkNode>();
  const positions = new Set<string>();
  for (const node of snapshot.nodes) {
    validateNode(node);
    const position = JSON.stringify([node.parentId ?? null, node.position]);
    if (nodes.has(node.chromeId) || positions.has(position)) invalid('INVALID_TREE');
    nodes.set(node.chromeId, node);
    positions.add(position);
  }
  const depths = new Map<string, number>();
  for (const node of snapshot.nodes) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = node;
    let base = 0;
    for (;;) {
      const known = depths.get(current.chromeId);
      if (known !== undefined) { base = known; break; }
      if (seen.has(current.chromeId)) invalid('INVALID_TREE');
      seen.add(current.chromeId);
      chain.push(current.chromeId);
      if (chain.length > MAX_DEPTH) invalid('LIMIT_EXCEEDED');
      if (current.parentId == null) break;
      const parent = nodes.get(current.parentId);
      if (!parent || parent.kind !== 'folder') invalid('INVALID_TREE');
      current = parent;
    }
    if (base + chain.length > MAX_DEPTH) invalid('LIMIT_EXCEEDED');
    chain.reverse().forEach((id, index) => depths.set(id, base + index + 1));
  }
}
export function parseWireMessage(value: unknown): WireMessage {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { invalid(); }
  if (encoded === undefined) invalid();
  if (new TextEncoder().encode(encoded).byteLength > MAX_FRAME_BYTES) invalid('FRAME_TOO_LARGE');
  if (!validate(value)) invalid();
  validUnicode(value);
  const event = value.type === 'event';
  const command = !event && value.type !== 'resync_required';
  if ((value.requestId !== null) !== command || (value.seq !== null) !== event) invalid();
  if (value.type === 'tree_full') validateTree(value.payload);
  if (value.type === 'event') {
    const change = value.payload.event;
    if (change.kind === 'created') validateNode(change.node);
    if (change.kind === 'removed') for (const node of change.subtree) validateNode(node);
    if (change.kind === 'reordered') validateIds(change.childIds);
  }
  if (value.type === 'operation_receipt') {
    if (value.payload.before) validateNode(value.payload.before);
    if (value.payload.after) validateNode(value.payload.after);
    if (value.payload.beforeChildIds) {
      validateIds(value.payload.beforeChildIds);
      if (value.payload.before?.kind !== 'folder') invalid();
    }
    if (value.payload.afterChildIds) {
      validateIds(value.payload.afterChildIds);
      if (value.payload.after?.kind !== 'folder') invalid();
    }
  }
  if (value.type === 'apply_operation') {
    const requests = new Set<string>();
    for (const step of value.payload.steps) {
      if (requests.has(step.requestId)) invalid();
      requests.add(step.requestId);
      if (step.expectedBefore) validateNode(step.expectedBefore);
      if (step.expectedSubtree) {
        if (!['move', 'delete'].includes(step.payload.kind)) invalid();
        const root = step.expectedSubtree.find((node) => node.chromeId === step.target);
        if (!root || !step.expectedBefore || Object.keys(root).some((key) => JSON.stringify(root[key as keyof typeof root]) !== JSON.stringify(step.expectedBefore?.[key as keyof typeof root]))) invalid();
        validateTree({ sourceEpoch: value.payload.sourceEpoch, revision: value.payload.expectedRevision, barrierSeq: 0, nodes: step.expectedSubtree.map((node) => node.chromeId === step.target ? { ...node, parentId: null, position: 0 } : node) });
      }
      if (step.payload.kind === 'create') {
        if (step.target != null || step.expectedBefore != null) invalid();
      } else if (step.target == null || step.expectedBefore?.chromeId !== step.target) invalid();
      if (step.payload.kind === 'reorder') {
        validateIds(step.payload.childIds);
        if (step.expectedChildIds == null || step.expectedBefore?.kind !== 'folder') invalid();
        validateIds(step.expectedChildIds);
        const expected = new Set(step.expectedChildIds);
        if (expected.size !== step.payload.childIds.length || step.payload.childIds.some(id => !expected.has(id))) invalid();
      } else if (step.expectedChildIds != null) invalid();
    }
  }
  return value;
}
export function parseWireFrame(frame: string): WireMessage {
  if (new TextEncoder().encode(frame).byteLength > MAX_FRAME_BYTES) invalid('FRAME_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(frame); } catch { invalid(); }
  return parseWireMessage(value);
}
export function encodeWireFrame(message: WireMessage): string {
  return JSON.stringify(parseWireMessage(message));
}

