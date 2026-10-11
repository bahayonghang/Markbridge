import type { BookmarkNode } from '@markbridge/protocol';

export const LIST_LIMIT = 10_000;
export const SEARCH_LIMIT = 200;
export const SEARCH_DEBOUNCE_MS = 200;

export type TreeIndex = {
  nodes: Map<string, BookmarkNode>;
  children: Map<string, string[]>;
  fetched: Set<string>;
};

export type FolderRow = {
  chromeId: string;
  depth: number;
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

export function mergeBranch(index: TreeIndex, nodes: BookmarkNode[]): TreeIndex {
  const next: TreeIndex = {
    nodes: new Map(index.nodes),
    children: new Map(index.children),
    fetched: new Set(index.fetched),
  };
  const ids = new Set(nodes.map((node) => node.chromeId));
  for (const node of nodes) next.nodes.set(node.chromeId, node);
  const roots = nodes.filter((node) => node.parentId == null || !ids.has(node.parentId));
  for (const root of roots) {
    const childIds = nodes.filter((node) => node.parentId === root.chromeId).sort(byPosition).map((node) => node.chromeId);
    next.children.set(root.chromeId, childIds);
    next.fetched.add(root.chromeId);
  }
  return next;
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
  const walk = (id: string, depth: number) => {
    const node = index.nodes.get(id);
    if (!node || node.kind !== 'folder') return;
    const childFolders = (index.children.get(id) ?? []).filter((child) => index.nodes.get(child)?.kind === 'folder');
    rows.push({
      chromeId: id,
      depth,
      title: displayTitle(node.title),
      expandable: !index.fetched.has(id) || childFolders.length > 0,
      expanded: expanded.has(id),
    });
    if (expanded.has(id)) {
      for (const child of childFolders) walk(child, depth + 1);
    }
  };
  for (const root of rootFolders(index)) walk(root.chromeId, 0);
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

export function countSnapshot(index: TreeIndex, folderId: string | null): { folders: number; bookmarks: number } {
  const tally = { folders: 0, bookmarks: 0 };
  const add = (node: BookmarkNode) => {
    if (node.kind === 'folder') tally.folders += 1;
    else tally.bookmarks += 1;
  };
  if (folderId == null) {
    for (const node of index.nodes.values()) add(node);
    return tally;
  }
  const walk = (id: string) => {
    for (const child of index.children.get(id) ?? []) {
      const node = index.nodes.get(child);
      if (!node) continue;
      add(node);
      walk(child);
    }
  };
  walk(folderId);
  return tally;
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
