import type { BookmarkNode } from '@markbridge/protocol';

export const PAGE_SIZE = 200;

export function folderPath(index: TreeIndex, chromeId: string | null): BookmarkNode[] {
  const path: BookmarkNode[] = [];
  const seen = new Set<string>();
  let node = chromeId ? index.nodes.get(chromeId) : undefined;
  while (node && !seen.has(node.chromeId)) {
    seen.add(node.chromeId);
    path.push(node);
    node = node.parentId ? index.nodes.get(node.parentId) : undefined;
  }
  return path.reverse();
}

export function querySnapshot(index: TreeIndex, folderId: string | null, scope: 'all' | 'subtree' | 'children', query: string): BookmarkNode[] {
  const found: BookmarkNode[] = [];
  const visit = (node: BookmarkNode) => {
    if (!query || node.title.includes(query) || node.url?.includes(query)) found.push(node);
    if (scope !== 'children') for (const child of directChildren(index, node.chromeId)) visit(child);
  };
  const roots = scope === 'all' ? [...index.nodes.values()].filter((node) => !node.parentId || !index.nodes.has(node.parentId)).sort(byPosition) : folderId ? directChildren(index, folderId) : looseBookmarks([...index.nodes.values()]);
  for (const node of roots) visit(node);
  return found;
}

export type TreeIndex = {
  nodes: Map<string, BookmarkNode>;
  children: Map<string, string[]>;
  fetched: Set<string>;
};

export type FolderRow = {
  chromeId: string;
  depth: number;
  positionInSet: number;
  setSize: number;
  title: string;
  expandable: boolean;
  expanded: boolean;
};

export type ListRow = {
  chromeId: string;
  kind: BookmarkNode['kind'];
  title: string;
  url: string | null;
};

export function emptyIndex(): TreeIndex {
  return { nodes: new Map(), children: new Map(), fetched: new Set() };
}

export function displayTitle(title: string): string {
  return title || '未命名';
}

export function rowKey(scope: string, chromeId: string): string {
  return `${scope}:${chromeId}`;
}

export function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

function byPosition(left: BookmarkNode, right: BookmarkNode): number {
  return left.position - right.position || left.chromeId.localeCompare(right.chromeId);
}

export function indexFlat(nodes: BookmarkNode[]): TreeIndex {
  const index = emptyIndex();
  for (const node of nodes) index.nodes.set(node.chromeId, node);
  const grouped = new Map<string, BookmarkNode[]>();
  for (const node of nodes) {
    if (!node.parentId || !index.nodes.has(node.parentId)) continue;
    const list = grouped.get(node.parentId) ?? [];
    list.push(node);
    grouped.set(node.parentId, list);
  }
  for (const [parent, children] of grouped) {
    children.sort(byPosition);
    index.children.set(parent, children.map((node) => node.chromeId));
    index.fetched.add(parent);
  }
  for (const node of nodes) {
    if (node.kind === 'folder' && !index.fetched.has(node.chromeId)) {
      index.children.set(node.chromeId, []);
      index.fetched.add(node.chromeId);
    }
  }
  return index;
}

export function rootFolders(index: TreeIndex): BookmarkNode[] {
  return [...index.nodes.values()]
    .filter((node) => node.kind === 'folder' && (node.parentId == null || !index.nodes.has(node.parentId)))
    .sort(byPosition);
}

export function folderRows(index: TreeIndex, expanded: ReadonlySet<string>): FolderRow[] {
  const rows: FolderRow[] = [];
  const walk = (id: string, depth: number, positionInSet: number, setSize: number) => {
    const node = index.nodes.get(id);
    if (!node || node.kind !== 'folder') return;
    const childFolders = (index.children.get(id) ?? []).filter((child) => index.nodes.get(child)?.kind === 'folder');
    rows.push({
      chromeId: id,
      depth,
      positionInSet,
      setSize,
      title: displayTitle(node.title),
      expandable: !index.fetched.has(id) || childFolders.length > 0,
      expanded: expanded.has(id),
    });
    if (expanded.has(id)) {
      childFolders.forEach((child, index) => walk(child, depth + 1, index + 1, childFolders.length));
    }
  };
  const roots = rootFolders(index);
  roots.forEach((root, index) => walk(root.chromeId, 0, index + 1, roots.length));
  return rows;
}

export function directChildren(index: TreeIndex, folderId: string): BookmarkNode[] {
  return (index.children.get(folderId) ?? []).flatMap((id) => {
    const node = index.nodes.get(id);
    return node ? [node] : [];
  });
}

export function looseBookmarks(nodes: BookmarkNode[]): BookmarkNode[] {
  const ids = new Set(nodes.map((node) => node.chromeId));
  return nodes.filter((node) => node.kind === 'bookmark' && (node.parentId == null || !ids.has(node.parentId))).sort(byPosition);
}

export function ancestorTitles(index: TreeIndex, chromeId: string): string[] {
  const names: string[] = [];
  let current = index.nodes.get(chromeId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (!seen.add(current.chromeId)) break;
    const parent = index.nodes.get(current.parentId);
    if (!parent) break;
    names.push(parent.title);
    current = parent;
  }
  names.reverse();
  return names;
}

// File mirrors have no search method. Filter the getMirrorTree snapshot with the cache rule:
// case-sensitive title or URL substring, preorder, stop at limit.
export function searchSnapshot(nodes: BookmarkNode[], query: string, limit: number): BookmarkNode[] {
  if (!query || limit <= 0) return [];
  const index = indexFlat(nodes);
  const found: BookmarkNode[] = [];
  const walk = (id: string) => {
    if (found.length >= limit) return;
    const node = index.nodes.get(id);
    if (!node) return;
    if (node.title.includes(query) || (node.url != null && node.url.includes(query))) found.push(node);
    for (const child of index.children.get(id) ?? []) walk(child);
  };
  const roots = [...index.nodes.values()]
    .filter((node) => node.parentId == null || !index.nodes.has(node.parentId))
    .sort(byPosition);
  for (const root of roots) walk(root.chromeId);
  return found;
}

export function toListRow(node: BookmarkNode): ListRow {
  return { chromeId: node.chromeId, kind: node.kind, title: displayTitle(node.title), url: node.url ?? null };
}
