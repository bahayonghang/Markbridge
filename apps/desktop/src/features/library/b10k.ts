// Fixed B10K tree for the library workspace. Seed and shape follow the parent verification fixture.
// File mirrors have no search command; callers pass `nodes` to getMirrorTree or searchSnapshot.

export const B10K_SEED = 20261010;
export const B10K_MARKER = 'MB05MARK';
export const B10K_MARKER_URL = 'https://example.com/mb05-mark';
export const B10K_DUP_URL = 'https://example.com/dup';
export const B10K_DUP_TITLE = '重复标题';

export type B10kNode = {
  chromeId: string;
  parentId: string | null;
  position: number;
  kind: 'folder' | 'bookmark';
  title: string;
  url: string | null;
};

type ChromeNode = {
  id: string;
  name: string;
  type: 'folder' | 'url';
  url?: string;
  children?: ChromeNode[];
};

export type B10kTree = {
  nodes: B10kNode[];
  bookmarks: number;
  folders: number;
  maxDepth: number;
  longTitle: string;
  pipeTitle: string;
  chromeFile: { checksum: string; version: number; roots: Record<string, ChromeNode> };
};

function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

function parserDepth(parentOf: Map<string, string | null>, id: string): number {
  let depth = 0;
  let current: string | null = id;
  while (current && current !== '0') {
    depth += 1;
    current = parentOf.get(current) ?? null;
    if (depth > 64) break;
  }
  return depth;
}

export function localStateFile(): { profile: { info_cache: { Default: { name: string } } } } {
  return { profile: { info_cache: { Default: { name: 'B10K' } } } };
}

export function buildB10k(): B10kTree {
  const next = createLcg(B10K_SEED);
  const position = new Map<string, number>();
  const place = (parent: string) => {
    const value = position.get(parent) ?? 0;
    position.set(parent, value + 1);
    return value;
  };
  const longTitle = `长标题${'长'.repeat(240)}`;
  const pipeTitle = '名称 | 不要拆';
  const roots: B10kNode[] = [
    { chromeId: '0', parentId: null, position: 0, kind: 'folder', title: '根', url: null },
    { chromeId: '1', parentId: '0', position: 0, kind: 'folder', title: 'MB05BAR', url: null },
    { chromeId: '2', parentId: '0', position: 1, kind: 'folder', title: '其他书签', url: null },
    { chromeId: '3', parentId: '0', position: 2, kind: 'folder', title: '移动书签', url: null },
  ];
  const folders: B10kNode[] = [];
  let chainParent = '1';
  for (let index = 1; index <= 19; index += 1) {
    const chromeId = `f${index}`;
    folders.push({
      chromeId,
      parentId: chainParent,
      position: place(chainParent),
      kind: 'folder',
      title: index === 19 ? 'MB05DEEP' : `文件夹${index}`,
      url: null,
    });
    chainParent = chromeId;
  }
  for (let index = 20; index <= 1000; index += 1) {
    folders.push({
      chromeId: `f${index}`,
      parentId: '1',
      position: place('1'),
      kind: 'folder',
      title: index === 20 ? '中文文件夹' : `文件夹${index}`,
      url: null,
    });
  }
  const parentIds = ['1'];
  for (let index = 1; index <= 1000; index += 1) {
    if (index !== 19) parentIds.push(`f${index}`);
  }
  const bookmarks: B10kNode[] = [];
  for (let index = 1; index <= 10_000; index += 1) {
    let title = `项${index}`;
    let url = `https://example.com/item/${index}`;
    if (index % 10 === 0) {
      title = B10K_DUP_TITLE;
      url = B10K_DUP_URL;
    }
    if (index === 1) {
      title = '中文书签';
      url = 'https://example.com/zh';
    } else if (index === 2) {
      title = longTitle;
      url = 'https://example.com/long';
    } else if (index === 3) {
      title = pipeTitle;
      url = 'https://example.com/pipe';
    } else if (index === 4) {
      title = B10K_MARKER;
      url = B10K_MARKER_URL;
    } else if (index === 5) {
      title = '副本标记';
      url = B10K_MARKER_URL;
    }
    const parentId = parentIds[next() % parentIds.length] ?? '1';
    bookmarks.push({ chromeId: `b${index}`, parentId, position: place(parentId), kind: 'bookmark', title, url });
  }
  const nodes = [...roots, ...folders, ...bookmarks];
  const parentOf = new Map(nodes.map((node) => [node.chromeId, node.parentId]));
  let maxDepth = 0;
  for (const node of nodes) maxDepth = Math.max(maxDepth, parserDepth(parentOf, node.chromeId));
  if (folders.length !== 1000 || bookmarks.length !== 10_000 || maxDepth !== 20) throw new Error('MB05_B10K_SHAPE');
  const children = new Map<string, B10kNode[]>();
  for (const node of [...folders, ...bookmarks]) {
    const list = children.get(node.parentId ?? '') ?? [];
    list.push(node);
    children.set(node.parentId ?? '', list);
  }
  const toChrome = (node: B10kNode): ChromeNode => {
    if (node.kind === 'bookmark') return { id: node.chromeId, name: node.title, type: 'url', url: node.url ?? '' };
    const nested = (children.get(node.chromeId) ?? []).slice().sort((left, right) => left.position - right.position).map(toChrome);
    return { id: node.chromeId, name: node.title, type: 'folder', children: nested };
  };
  return {
    nodes,
    bookmarks: bookmarks.length,
    folders: folders.length,
    maxDepth,
    longTitle,
    pipeTitle,
    chromeFile: {
      checksum: 'fixture',
      version: 1,
      roots: { bookmark_bar: toChrome(roots[1]!), other: toChrome(roots[2]!), synced: toChrome(roots[3]!) },
    },
  };
}
