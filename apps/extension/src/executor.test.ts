import { describe, expect, it } from 'vitest';
import type { BookmarkNode, OperationStep } from '@markbridge/protocol';
import { emptyStore, parseStore, remember, runSteps, type BookmarkPort, type Interrupt, type WriteStore } from './executor';

type ChromeNode = chrome.bookmarks.BookmarkTreeNode;

function node(id: string, parentId: string | undefined, index: number, title: string, extra: Partial<ChromeNode> = {}): ChromeNode {
  return { id, parentId, index, title, syncing: false, ...extra };
}

function tree(): ChromeNode[] {
  return [node('0', undefined, 0, '', { children: [
    node('1', '0', 0, '栏', { folderType: 'bookmarks-bar', children: [
      node('2', '1', 0, 'Alpha', { url: 'https://alpha.test/' }),
      node('3', '1', 1, 'Beta', { url: 'https://beta.test/' }),
    ] }),
    node('4', '0', 1, '管理', { folderType: 'managed', unmodifiable: 'managed', children: [
      node('5', '4', 0, '锁定', { url: 'https://managed.test/' }),
    ] }),
  ] })];
}

function port(roots: ChromeNode[]) {
  const calls = { create: 0, update: 0, move: 0, remove: 0, removeTree: 0 };
  function list(parent: ChromeNode | null): ChromeNode[] {
    return parent ? parent.children ?? [] : roots;
  }
  function find(id: string, parent: ChromeNode | null = null): { node: ChromeNode; parent: ChromeNode | null; index: number } | null {
    for (let index = 0; index < list(parent).length; index += 1) {
      const current = list(parent)[index]!;
      if (current.id === id) return { node: current, parent, index };
      const nested = find(id, current);
      if (nested) return nested;
    }
    return null;
  }
  function detach(id: string): ChromeNode {
    const found = find(id);
    if (!found) throw new Error('missing');
    list(found.parent).splice(found.index, 1);
    list(found.parent).forEach((item, index) => { item.index = index; });
    return found.node;
  }
  const bookmarks: BookmarkPort = {
    async getTree() { return structuredClone(roots); },
    async create(details) {
      calls.create += 1;
      const parent = find(details.parentId ?? '');
      if (!parent) throw new Error('missing parent');
      const children = parent.node.children ?? [];
      parent.node.children = children;
      const index = details.index ?? children.length;
      const created = node(`n${calls.create}`, parent.node.id, index, details.title ?? '', details.url ? { url: details.url } : { children: [] });
      children.splice(index, 0, created);
      children.forEach((item, position) => { item.index = position; });
      return structuredClone(created);
    },
    async update(id, changes) {
      calls.update += 1;
      const found = find(id);
      if (!found) throw new Error('missing');
      if (changes.title != null) found.node.title = changes.title;
      if (changes.url != null) found.node.url = changes.url;
      return structuredClone(found.node);
    },
    async move(id, destination) {
      calls.move += 1;
      const moved = detach(id);
      const parent = find(destination.parentId ?? '');
      if (!parent) throw new Error('missing parent');
      const children = parent.node.children ?? [];
      parent.node.children = children;
      moved.parentId = parent.node.id;
      children.splice(destination.index ?? children.length, 0, moved);
      children.forEach((item, index) => { item.index = index; });
      return structuredClone(moved);
    },
    async remove(id) { calls.remove += 1; detach(id); },
    async removeTree(id) { calls.removeTree += 1; detach(id); },
  };
  return { bookmarks, calls, find };
}

function flat(id: string, parentId: string | null, position: number, title: string, url?: string, extra: Partial<BookmarkNode> = {}): BookmarkNode {
  return { chromeId: id, parentId, position, title, kind: url ? 'bookmark' : 'folder', ...(url ? { url } : {}), ...extra };
}

function step(partial: OperationStep): OperationStep { return partial; }

async function run(bookmarks: BookmarkPort, store: WriteStore, steps: OperationStep[], interrupt?: Interrupt) {
  const sent: string[] = [];
  await runSteps({
    port: bookmarks, store, operationId: 'op-1', steps, interrupt,
    send: (receipt) => sent.push(`${receipt.requestId}:${receipt.state}:${receipt.errorCode ?? ''}`),
  });
  return sent;
}

describe('extension write executor', () => {
  it('moves into a folder created in the same operation and restores sibling order', async () => {
    const fixture = port(tree());
    const alpha = flat('2', '1', 0, 'Alpha', 'https://alpha.test/');
    const moved = flat('2', 'n1', 0, 'Alpha', 'https://alpha.test/');
    const created = flat('n1', '1', 2, '阅读');
    const sent = await run(fixture.bookmarks, emptyStore(), [
      step({ requestId: 'req-folder', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '1', position: 2, title: '阅读' } }),
      step({ requestId: 'req-move', target: '2', expectedBefore: alpha, payload: { kind: 'move', parentId: 'req-folder', position: 0 } }),
      step({ requestId: 'req-back', target: '2', expectedBefore: moved, payload: { kind: 'move', parentId: '1', position: 0 } }),
      step({ requestId: 'req-delete', target: 'n1', expectedBefore: created, payload: { kind: 'delete' } }),
    ]);
    expect(sent.map((item) => item.split(':')[1])).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(fixture.find('n1')).toBeNull();
    expect(fixture.find('2')?.parent?.id).toBe('1');
    expect(fixture.find('2')?.index).toBe(0);
    expect(fixture.find('3')?.index).toBe(1);
  });

  it('creates, updates, moves, reorders, and deletes through the bookmark port', async () => {
    const fixture = port(tree());
    const store = emptyStore();
    const bar = flat('1', '0', 0, '栏', undefined, { folderType: 'bookmarks-bar' });
    const alpha = flat('2', '1', 0, 'Alpha', 'https://alpha.test/');
    const beta = flat('3', '1', 1, 'Beta', 'https://beta.test/');
    const sent = await run(fixture.bookmarks, store, [
      step({ requestId: 'create', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '1', position: 2, title: 'Gamma', url: 'https://gamma.test/' } }),
      step({ requestId: 'update', target: '2', expectedBefore: alpha, payload: { kind: 'update', title: 'Alpha 2' } }),
      step({ requestId: 'move', target: '3', expectedBefore: beta, payload: { kind: 'move', parentId: '1', position: 0 } }),
      step({ requestId: 'reorder', target: '1', expectedBefore: bar, expectedChildIds: ['3', '2', 'n1'], payload: { kind: 'reorder', childIds: ['2', '3', 'n1'] } }),
      step({ requestId: 'delete', target: 'n1', expectedBefore: flat('n1', '1', 2, 'Gamma', 'https://gamma.test/'), payload: { kind: 'delete' } }),
    ]);
    expect(sent).toEqual(['create:applied:', 'update:applied:', 'move:applied:', 'reorder:applied:', 'delete:applied:']);
    expect(fixture.calls).toMatchObject({ create: 1, update: 1, remove: 1, removeTree: 0 });
    expect(fixture.find('n1')).toBeNull();
    expect(fixture.find('2')?.node.title).toBe('Alpha 2');
  });

  it('refuses roots, folderType nodes, managed descendants, and cycles without calling chrome', async () => {
    const fixture = port(tree());
    const root = flat('0', null, 0, '');
    const managedChild = flat('5', '4', 0, '锁定', 'https://managed.test/');
    const bar = flat('1', '0', 0, '栏', undefined, { folderType: 'bookmarks-bar' });
    const cases: Array<[string, OperationStep]> = [
      ['root', step({ requestId: 'root', target: '0', expectedBefore: root, payload: { kind: 'delete' } })],
      ['bar', step({ requestId: 'bar', target: '1', expectedBefore: bar, payload: { kind: 'move', parentId: '0', position: 1 } })],
      ['managed', step({ requestId: 'managed', target: '5', expectedBefore: managedChild, payload: { kind: 'delete' } })],
      ['cycle', step({ requestId: 'cycle', target: '1', expectedBefore: bar, payload: { kind: 'move', parentId: '2', position: 0 } })],
      ['under', step({ requestId: 'under', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '4', position: 0, title: 'nope' } })],
    ];
    const sent = [];
    for (const [, one] of cases) sent.push(...await run(fixture.bookmarks, emptyStore(), [one]));
    expect(sent.map((item) => item.split(':')[2])).toEqual(['PROTECTED_NODE', 'PROTECTED_NODE', 'PROTECTED_NODE', 'INVALID_TREE', 'PROTECTED_NODE']);
    expect(fixture.calls).toEqual({ create: 0, update: 0, move: 0, remove: 0, removeTree: 0 });
  });

  it('does not repeat create or delete after an interruption, and does not report an unknown result as applied', async () => {
    const created = flat('n1', '1', 2, 'Gamma', 'https://gamma.test/');
    for (const interrupt of ['before-effect', 'after-effect', 'before-ack'] as const) {
      const fixture = port(tree());
      const store = emptyStore();
      const steps = [step({ requestId: 'create', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '1', position: 2, title: 'Gamma', url: 'https://gamma.test/' } })];
      const first = await run(fixture.bookmarks, store, steps, interrupt);
      const resumed = await run(fixture.bookmarks, store, steps);
      expect(first.every((item) => !item.endsWith('applied:'))).toBe(true);
      expect(resumed).toEqual(interrupt === 'before-ack' ? ['create:applied:'] : ['create:uncertain:UNCERTAIN_WRITE']);
      expect(fixture.calls.create).toBe(interrupt === 'before-effect' ? 0 : 1);
      expect(resumed.some((item) => item.includes('uncertain') && item.includes('applied'))).toBe(false);
    }
    const folder = port(tree());
    const store = emptyStore();
    const before = flat('3', '1', 1, 'Beta', 'https://beta.test/');
    const steps = [step({ requestId: 'delete', target: '3', expectedBefore: before, payload: { kind: 'delete' } })];
    expect(await run(folder.bookmarks, store, steps, 'after-effect')).toEqual([]);
    expect(folder.calls.remove).toBe(1);
    expect(await run(folder.bookmarks, store, steps)).toEqual(['delete:uncertain:UNCERTAIN_WRITE']);
    expect(folder.calls.remove).toBe(1);
    expect(created.chromeId).toBe('n1');
  });

  it('replays a stored receipt and keeps an update marker retryable until the effect is recorded', async () => {
    const fixture = port(tree());
    const store = emptyStore();
    const alpha = flat('2', '1', 0, 'Alpha', 'https://alpha.test/');
    const steps = [step({ requestId: 'update', target: '2', expectedBefore: alpha, payload: { kind: 'update', title: 'Next' } })];
    expect(await run(fixture.bookmarks, store, steps, 'before-effect')).toEqual([]);
    expect(fixture.calls.update).toBe(0);
    expect(await run(fixture.bookmarks, store, steps)).toEqual(['update:applied:']);
    expect(fixture.calls.update).toBe(1);
    expect(await run(fixture.bookmarks, store, steps)).toEqual(['update:applied:']);
    expect(fixture.calls.update).toBe(1);
    remember(store, { operationId: 'op-1', requestId: 'extra', state: 'applied', before: null, after: null, beforeChildIds: null, afterChildIds: null, errorCode: null });
    for (let index = 0; index < 1000; index += 1) {
      remember(store, { operationId: 'op-1', requestId: `r${index}`, state: 'failed', before: null, after: null, beforeChildIds: null, afterChildIds: null, errorCode: 'CONFLICT' });
    }
    expect(store.receipts).toHaveLength(1000);
    expect(store.receipts.some((item) => item.requestId === 'extra')).toBe(false);
    expect(parseStore(null)).toEqual(emptyStore());
    expect(parseStore({ pending: {} })).toBeNull();
  });

  it('moves across parents and recreates a deleted folder under the new parent id', async () => {
    const roots = tree();
    const root = roots[0]!;
    root.children!.push(node('6', '0', 2, '其他', { folderType: 'other', children: [] }));
    const fixture = port(roots);
    const beta = flat('3', '1', 1, 'Beta', 'https://beta.test/');
    const sent = await run(fixture.bookmarks, emptyStore(), [
      step({ requestId: 'move', target: '3', expectedBefore: beta, payload: { kind: 'move', parentId: '6', position: 0 } }),
      step({ requestId: 'folder', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '6', position: 1, title: '目录' } }),
      step({ requestId: 'child', target: null, expectedBefore: null, payload: { kind: 'create', parentId: 'folder', position: 0, title: '子项', url: 'https://child.test/' } }),
    ]);
    expect(sent.map((item) => item.split(':')[1])).toEqual(['applied', 'applied', 'applied']);
    expect(fixture.find('3')?.node.parentId).toBe('6');
    const folder = fixture.find('n1');
    const child = fixture.find('n2');
    expect(folder?.node.parentId).toBe('6');
    expect(child?.node.parentId).toBe(folder?.node.id);
    expect(child?.node.url).toBe('https://child.test/');
  });

  it('persists a create marker before chrome and does not create again from that marker', async () => {
    const fixture = port(tree());
    const store = emptyStore();
    const steps = [step({ requestId: 'create', target: null, expectedBefore: null, payload: { kind: 'create', parentId: '1', position: 2, title: 'Gamma', url: 'https://gamma.test/' } })];
    const captured: { store: WriteStore | null; creates: number } = { store: null, creates: -1 };
    await runSteps({
      port: fixture.bookmarks, store, operationId: 'op-1', steps,
      save: async () => {
        if (!captured.store) {
          captured.store = structuredClone(store);
          captured.creates = fixture.calls.create;
        }
      },
      send: () => {},
    });
    expect(captured.creates).toBe(0);
    expect(captured.store?.pending[0]?.phase).toBe('marker');
    expect(fixture.calls.create).toBe(1);
    const restarted = port(tree());
    const sent = await run(restarted.bookmarks, captured.store!, steps);
    expect(sent).toEqual(['create:uncertain:UNCERTAIN_WRITE']);
    expect(restarted.calls.create).toBe(0);
  });
});
