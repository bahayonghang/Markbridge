import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BookmarkNode, BridgeState, LibraryDetail, TagCatalog } from '@markbridge/protocol';
import {
  getMirrorTree, openHttpUrl, readCacheCount, readCacheList, readCacheNode, readCacheSearch, readCacheTree,
  type EditAction,
} from '../../backend';
import { AiSuggest } from '../ai/AiSuggest';
import { ContentPreviewPanel } from '../preview/ContentPreview';
import { WebPreviewPanel } from '../preview/WebPreview';
import { EditDesk } from './EditDesk';
import { TagDesk } from '../tags/TagDesk';
import { VirtualRows } from './VirtualRows';
import {
  LIST_LIMIT, SEARCH_DEBOUNCE_MS, SEARCH_LIMIT, ancestorTitles, countSnapshot, directChildren, displayTitle,
  emptyIndex, folderRows, indexFlat, isHttpUrl, looseBookmarks, mergeBranch, rootFolders, rowKey, searchSnapshot,
  toListRow, type FolderRow, type ListRow, type TreeIndex,
} from './model';

type Profile = BridgeState['profiles'][number];
type Mirror = BridgeState['mirrors'][number];
type Source = { kind: 'profile'; id: string; profile: Profile } | { kind: 'mirror'; id: string; mirror: Mirror };

function sourceFromToken(token: string, profiles: Profile[], mirrors: Mirror[]): Source | null {
  const profileId = token.startsWith('profile:') ? token.slice('profile:'.length) : '';
  const mirrorId = token.startsWith('mirror:') ? token.slice('mirror:'.length) : '';
  const profile = profiles.find((item) => item.profileId === profileId);
  if (profile) return { kind: 'profile', id: profile.profileId, profile };
  const mirror = mirrors.find((item) => item.mirrorSourceId === mirrorId);
  if (mirror) return { kind: 'mirror', id: mirror.mirrorSourceId, mirror };
  return null;
}

function resolveSource(state: BridgeState | null, manual: string | null, focusMirrorId: string | null): Source | null {
  const profiles = state?.profiles ?? [];
  const mirrors = state?.mirrors ?? [];
  const tokens = [manual, focusMirrorId ? `mirror:${focusMirrorId}` : null];
  for (const token of tokens) {
    if (!token) continue;
    const source = sourceFromToken(token, profiles, mirrors);
    if (source) return source;
  }
  if (profiles[0]) return { kind: 'profile', id: profiles[0].profileId, profile: profiles[0] };
  if (mirrors[0]) return { kind: 'mirror', id: mirrors[0].mirrorSourceId, mirror: mirrors[0] };
  return null;
}

function accessNote(source: Source): string {
  if (source.kind === 'mirror') {
    if (source.mirror.fileStatus === 'stale') return '文件来源陈旧，仍显示上次有效的书签。此来源不能写入浏览器。';
    if (source.mirror.fileStatus === 'unavailable') return '文件来源不可用，仍显示上次有效的书签。此来源不能写入浏览器。';
    return '只读文件来源。此来源不能写入浏览器。';
  }
  switch (source.profile.connection) {
    case 'live': return '资料正在实时同步。写入 Chrome 前需要确认。';
    case 'connecting': return '正在连接扩展。当前只读。';
    case 'reconciling': return '正在核对书签。当前只读。';
    case 'cached_read_only': return '扩展未连接。显示本机缓存，当前只读。';
    case 'error': return '连接出错。显示本机缓存，当前只读。';
    case 'unpaired': return '资料未配对。显示本机缓存，当前只读。';
  }
}

function chromeFromTarget(event: KeyboardEvent<HTMLDivElement>, prefix: string): string | null {
  const target = event.target as HTMLElement;
  return target.id.startsWith(prefix) ? target.id.slice(prefix.length) : null;
}

function loadedProfileNodes(index: TreeIndex, list: BookmarkNode[], detail: LibraryDetail | null): BookmarkNode[] {
  const merged = new Map(index.nodes);
  for (const node of list) merged.set(node.chromeId, node);
  if (detail) merged.set(detail.node.chromeId, detail.node);
  return [...merged.values()];
}

function profileSearchNodes(synced: BookmarkNode[] | null, index: TreeIndex, list: BookmarkNode[], detail: LibraryDetail | null): BookmarkNode[] {
  const loaded = loadedProfileNodes(index, list, detail);
  if (!synced || synced.length === 0) return loaded;
  const merged = new Map<string, BookmarkNode>();
  for (const node of synced) merged.set(node.chromeId, node);
  for (const node of loaded) merged.set(node.chromeId, node);
  return [...merged.values()];
}

function neighbor(ids: string[], current: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const index = current == null ? -1 : ids.indexOf(current);
  if (index < 0) return delta < 0 ? ids[ids.length - 1]! : ids[0]!;
  const next = Math.min(ids.length - 1, Math.max(0, index + delta));
  return ids[next] ?? null;
}

export function LibraryWorkspace({ state, invalid, native, focusMirrorId }: {
  state: BridgeState | null;
  invalid: boolean;
  native: boolean;
  focusMirrorId: string | null;
}) {
  const [manual, setManual] = useState<string | null>(null);
  const source = resolveSource(state, manual, focusMirrorId);
  const sourceKey = source ? `${source.kind}:${source.id}` : '';
  const profile = source?.kind === 'profile' ? source.profile : null;
  const mirror = source?.kind === 'mirror' ? source.mirror : null;
  const [seenKey, setSeenKey] = useState(sourceKey);
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const [index, setIndex] = useState<TreeIndex>(emptyIndex);
  const [mirrorNodes, setMirrorNodes] = useState<BookmarkNode[]>([]);
  const [list, setList] = useState<BookmarkNode[]>([]);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState<{ folders: number; bookmarks: number } | null>(null);
  const [results, setResults] = useState<BookmarkNode[] | null>(null);
  const [seenCommitted, setSeenCommitted] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'stale'>('loading');
  const [gap, setGap] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [syncedNodes, setSyncedNodes] = useState<BookmarkNode[] | null>(null);
  const [editRequest, setEditRequest] = useState<{ id: number; action: EditAction } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [tagMatches, setTagMatches] = useState<BookmarkNode[]>([]);
  const editSeq = useRef(0);
  const expandedRef = useRef(expanded);
  const seenRevision = useRef<number | null>(null);
  const treeGen = useRef(0);
  const listGen = useRef(0);
  const searchGen = useRef(0);
  const detailGen = useRef(0);
  const mirrorGen = useRef(0);
  const stampRef = useRef('');
  const snapshotGen = useRef(0);
  expandedRef.current = expanded;
  stampRef.current = profile ? `${profile.profileId}:${profile.revision}` : '';

  if (seenKey !== sourceKey) {
    setSeenKey(sourceKey);
    setQuery('');
    setCommitted('');
    setIndex(emptyIndex());
    setMirrorNodes([]);
    setList([]);
    setTotal(0);
    setCount(null);
    setResults(null);
    setTruncated(false);
    setDetail(null);
    setFolderId(null);
    setBookmarkId(null);
    setExpanded(new Set());
    setPhase('loading');
    setGap(false);
    setOpenFailed(false);
    setSyncedNodes(null);
    setEditRequest(null);
    setPicked(new Set());
    setFilterTagId(null);
    setTagMatches([]);
    seenRevision.current = null;
    setSeenCommitted('');
    treeGen.current += 1;
    snapshotGen.current += 1;
    listGen.current += 1;
    searchGen.current += 1;
    detailGen.current += 1;
    mirrorGen.current += 1;
  }

  useEffect(() => {
    if (focusMirrorId) setManual(`mirror:${focusMirrorId}`);
  }, [focusMirrorId]);

  useEffect(() => {
    if (!invalid) return;
    snapshotGen.current += 1;
    setSyncedNodes(null);
    setIndex(emptyIndex());
    setMirrorNodes([]);
    setList([]);
    setResults(null);
    setDetail(null);
  }, [invalid]);

  useEffect(() => {
    const revision = profile?.revision ?? mirror?.revision;
    const id = sourceKey;
    if (!id || revision == null) return;
    const previous = seenRevision.current;
    seenRevision.current = revision;
    setGap(previous != null && revision > previous + 1);
  }, [sourceKey, profile?.revision, mirror?.revision]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCommitted(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!profile || !native || invalid) return;
    const generation = ++treeGen.current;
    const profileId = profile.profileId;
    let cancelled = false;
    void (async () => {
      try {
        const root = await readCacheTree(profileId, null, 1);
        if (cancelled || treeGen.current !== generation) return;
        let next = mergeBranch(emptyIndex(), root.nodes);
        for (const folder of expandedRef.current) {
          if (next.fetched.has(folder) || next.nodes.get(folder)?.kind !== 'folder') continue;
          const branch = await readCacheTree(profileId, folder, 1);
          if (cancelled || treeGen.current !== generation) return;
          next = mergeBranch(next, branch.nodes);
        }
        setIndex(next);
        setPhase('ready');
        const roots = rootFolders(next).map((node) => node.chromeId);
        setExpanded((current) => current.size > 0 ? current : new Set(roots));
        setFolderId((current) => current ?? roots[0] ?? null);
      } catch {
        if (!cancelled && treeGen.current === generation) setPhase((current) => current === 'ready' ? 'stale' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [profile, native, invalid]);

  const snapshotProfileId = profile?.profileId ?? '';
  useEffect(() => {
    if (!snapshotProfileId || !native || invalid) return;
    const generation = ++snapshotGen.current;
    let cancelled = false;
    void (async () => {
      try {
        const root = await readCacheTree(snapshotProfileId, null, 0);
        if (cancelled || snapshotGen.current !== generation) return;
        setSyncedNodes(root.nodes);
      } catch {
        if (!cancelled && snapshotGen.current === generation) setSyncedNodes([]);
      }
    })();
    return () => { cancelled = true; };
  }, [snapshotProfileId, native, invalid]);

  useEffect(() => {
    if (!profile || !native || invalid || !folderId) return;
    const generation = ++listGen.current;
    const profileId = profile.profileId;
    const folder = folderId;
    let cancelled = false;
    void (async () => {
      try {
        const [page, totals] = await Promise.all([
          readCacheList(profileId, folder, 0, LIST_LIMIT),
          readCacheCount(profileId, folder),
        ]);
        if (cancelled || listGen.current !== generation) return;
        setList(page.items);
        setTotal(page.total);
        setCount({ folders: totals.folders, bookmarks: totals.bookmarks });
      } catch {
        if (!cancelled && listGen.current === generation) setPhase((current) => current === 'ready' ? 'stale' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [profile, folderId, native, invalid]);

  useEffect(() => {
    if (!profile || !native || invalid || !committed) {
      setResults(null);
      setTruncated(false);
      return;
    }
    const generation = ++searchGen.current;
    const profileId = profile.profileId;
    const text = committed;
    let cancelled = false;
    void (async () => {
      try {
        const found = await readCacheSearch(profileId, text, null, SEARCH_LIMIT + 1);
        if (cancelled || searchGen.current !== generation) return;
        setTruncated(found.items.length > SEARCH_LIMIT);
        setResults(found.items.slice(0, SEARCH_LIMIT));
      } catch {
        if (!cancelled && searchGen.current === generation) setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [profile, committed, native, invalid]);

  const detailId = bookmarkId ?? folderId;
  useEffect(() => {
    if (!profile || !native || invalid || !detailId) return;
    const generation = ++detailGen.current;
    const profileId = profile.profileId;
    const chromeId = detailId;
    let cancelled = false;
    void (async () => {
      try {
        const next = await readCacheNode(profileId, chromeId);
        if (cancelled || detailGen.current !== generation) return;
        setDetail(next);
      } catch {
        if (!cancelled && detailGen.current === generation) setDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, detailId, native, invalid]);

  useEffect(() => {
    if (!mirror || !native || invalid) return;
    const generation = ++mirrorGen.current;
    const mirrorId = mirror.mirrorSourceId;
    let cancelled = false;
    void (async () => {
      try {
        const tree = await getMirrorTree(mirrorId);
        if (cancelled || mirrorGen.current !== generation) return;
        setMirrorNodes(tree.nodes);
        setPhase('ready');
        const flat = indexFlat(tree.nodes);
        const roots = rootFolders(flat).map((node) => node.chromeId);
        setExpanded((current) => current.size > 0 ? current : new Set(roots));
        setFolderId((current) => current ?? roots[0] ?? null);
        if (!roots.length) setBookmarkId((current) => current ?? looseBookmarks(tree.nodes)[0]?.chromeId ?? null);
      } catch {
        if (!cancelled && mirrorGen.current === generation) setPhase((current) => current === 'ready' ? 'stale' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [mirror, native, invalid]);

  if (seenCommitted !== committed) {
    setSeenCommitted(committed);
    setResults(null);
    setTruncated(false);
  }
  const mirrorIndex = mirror ? indexFlat(mirrorNodes) : emptyIndex();
  const activeIndex = profile ? index : mirrorIndex;
  const folders = folderRows(activeIndex, expanded);
  const waitingForCache = profile != null && syncedNodes == null;
  // Synced-cache rows filter on the input turn, including nodes outside the open folder. The debounced cache search replaces those rows when it returns.
  const mirrorQuery = mirror && query.length > 0 ? query : '';
  const profileQuery = profile && query.length > 0 ? query : '';
  const searchHits = mirrorQuery ? searchSnapshot(mirrorNodes, mirrorQuery, SEARCH_LIMIT + 1) : [];
  const loadedHits = profileQuery ? searchSnapshot(profileSearchNodes(syncedNodes, index, list, detail), profileQuery, SEARCH_LIMIT + 1) : [];
  const rustReady = profileQuery.length > 0 && query === committed && results != null;
  const profileHits = rustReady ? results ?? [] : loadedHits;
  const searching = mirrorQuery.length > 0 || profileQuery.length > 0;
  const mirrorTruncated = searchHits.length > SEARCH_LIMIT;
  const profileTruncated = rustReady ? truncated : loadedHits.length > SEARCH_LIMIT;
  const folderNodes = folderId ? (profile ? list : directChildren(mirrorIndex, folderId)) : looseBookmarks(mirror ? mirrorNodes : []);
  const filtering = profile != null && filterTagId != null;
  const visibleNodes = filtering ? tagMatches : !searching ? folderNodes : profile ? profileHits.slice(0, SEARCH_LIMIT) : searchHits.slice(0, SEARCH_LIMIT);
  const visible = visibleNodes.map(toListRow);
  const pickedIds = [...picked].sort();
  const tagIds = pickedIds.length > 0 ? pickedIds : bookmarkId ? [bookmarkId] : [];
  function togglePick(chromeId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(chromeId)) next.delete(chromeId);
      else next.add(chromeId);
      return next;
    });
  }
  function acceptCatalog(catalog: TagCatalog) {
    setTagMatches(catalog.matches);
  }
  const selectedId = bookmarkId ?? folderId;
  const selectedNode = profile && detail && detail.node.chromeId === selectedId ? detail.node : null;
  const mirrorNode = !profile && selectedId ? mirrorIndex.nodes.get(selectedId) ?? null : null;
  const detailView = profile && detail && detail.node.chromeId === selectedId
    ? { title: detail.node.title, url: detail.node.url ?? null, kind: detail.node.kind, chromeId: detail.node.chromeId, ancestors: detail.ancestors }
    : mirrorNode
      ? { title: mirrorNode.title, url: mirrorNode.url ?? null, kind: mirrorNode.kind, chromeId: mirrorNode.chromeId, ancestors: ancestorTitles(mirrorIndex, mirrorNode.chromeId) }
      : null;
  const mirrorCount = mirror && folderId ? countSnapshot(mirrorIndex, folderId) : mirror ? countSnapshot(mirrorIndex, null) : null;
  const shownCount = profile ? count : mirrorCount;

  function chooseFolder(chromeId: string) {
    setFolderId(chromeId);
    setBookmarkId(null);
  }

  async function toggleFolder(chromeId: string) {
    if (expanded.has(chromeId)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(chromeId);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(chromeId));
    if (!profile || activeIndex.fetched.has(chromeId)) return;
    const profileId = profile.profileId;
    const stamp = `${profileId}:${profile.revision}`;
    const generation = treeGen.current;
    try {
      const branch = await readCacheTree(profileId, chromeId, 1);
      if (stampRef.current !== stamp || treeGen.current !== generation) return;
      setIndex((current) => mergeBranch(current, branch.nodes));
    } catch {
      setPhase((current) => current === 'ready' ? 'stale' : 'error');
    }
  }

  function onTreeKey(event: KeyboardEvent<HTMLDivElement>) {
    const ids = folders.map((row) => row.chromeId);
    const current = chromeFromTarget(event, 'library-row-folder:') ?? folderId;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = neighbor(ids, current, event.key === 'ArrowDown' ? 1 : -1);
      if (next) chooseFolder(next);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
      if (next) chooseFolder(next);
    } else if (event.key === 'ArrowRight' && current) {
      event.preventDefault();
      const row = folders.find((item) => item.chromeId === current);
      if (row?.expandable && !row.expanded) void toggleFolder(current);
      else if (row?.expanded) {
        const children = (activeIndex.children.get(current) ?? []).filter((id) => activeIndex.nodes.get(id)?.kind === 'folder');
        if (children[0]) chooseFolder(children[0]);
      }
    } else if (event.key === 'ArrowLeft' && current) {
      event.preventDefault();
      const row = folders.find((item) => item.chromeId === current);
      if (row?.expanded) {
        setExpanded((expandedNow) => {
          const next = new Set(expandedNow);
          next.delete(current);
          return next;
        });
      } else {
        const parent = activeIndex.nodes.get(current)?.parentId;
        if (parent && activeIndex.nodes.get(parent)?.kind === 'folder') chooseFolder(parent);
      }
    }
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const ids = visible.map((row) => row.chromeId);
    const currentId = chromeFromTarget(event, `library-row-${sourceKey}:`) ?? bookmarkId;
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && profile?.connection === 'live') {
      event.preventDefault();
      const current = currentId ? activeIndex.nodes.get(currentId) : null;
      const parentId = current?.parentId;
      if (!current || !parentId) return;
      const childIds = [...(activeIndex.children.get(parentId) ?? [])];
      const index = childIds.indexOf(current.chromeId);
      const next = index + (event.key === 'ArrowDown' ? 1 : -1);
      if (index < 0 || next < 0 || next >= childIds.length) return;
      const [item] = childIds.splice(index, 1);
      childIds.splice(next, 0, item!);
      setEditRequest({ id: editSeq.current += 1, action: { kind: 'reorder', parentId, childIds } });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = neighbor(ids, currentId, event.key === 'ArrowDown' ? 1 : -1);
      if (next) setBookmarkId(next);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
      if (next) setBookmarkId(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const current = visible.find((row) => row.chromeId === (currentId ?? ids[0]));
      if (!current) return;
      if (current.kind === 'folder') {
        chooseFolder(current.chromeId);
        setQuery('');
        setCommitted('');
        setResults(null);
        if (!expanded.has(current.chromeId)) void toggleFolder(current.chromeId);
      } else {
        setBookmarkId(current.chromeId);
        if (current.url && isHttpUrl(current.url)) void open(current.url);
      }
    }
  }

  function dropBookmark(targetId: string, sourceId: string) {
    if (profile?.connection !== 'live' || sourceId === targetId) return;
    const source = activeIndex.nodes.get(sourceId);
    const target = activeIndex.nodes.get(targetId);
    if (!source || !target) return;
    if (target.kind === 'folder' && source.parentId !== target.chromeId) {
      const position = activeIndex.children.get(target.chromeId)?.length ?? 0;
      setEditRequest({ id: editSeq.current += 1, action: { kind: 'move', chromeId: sourceId, parentId: target.chromeId, position } });
      return;
    }
    const parentId = target.parentId;
    if (!parentId || !source.parentId) return;
    if (source.parentId === parentId) {
      const childIds = [...(activeIndex.children.get(parentId) ?? [])].filter((id) => id !== sourceId);
      const index = childIds.indexOf(targetId);
      if (index < 0) return;
      childIds.splice(index, 0, sourceId);
      setEditRequest({ id: editSeq.current += 1, action: { kind: 'reorder', parentId, childIds } });
      return;
    }
    setEditRequest({ id: editSeq.current += 1, action: { kind: 'move', chromeId: sourceId, parentId, position: target.position } });
  }

  async function open(url: string) {
    if (!native || !isHttpUrl(url)) return;
    setOpenFailed(false);
    try { await openHttpUrl(url); } catch { setOpenFailed(true); }
  }

  const profiles = state?.profiles ?? [];
  const mirrors = state?.mirrors ?? [];
  const inputsReady = native && !invalid && !!source;
  const showSearchTruncation = profile ? profileTruncated && searching : mirrorTruncated && searching;

  return (
    <section className="library" aria-busy={(native && phase === 'loading') || undefined} aria-labelledby="library-title">
      <div className="library-toolbar">
        <div className="section-heading">
          <h2 id="library-title">书签</h2>
          <span>{source ? accessNote(source) : '尚未选择来源'}</span>
        </div>
        {!native && <p>桌面应用连接本机缓存后可浏览书签。当前预览不能读取书签。</p>}
        {invalid && <p role="status">连接状态无效，已停止更新书签列表。</p>}
        {state && (profiles.length > 0 || mirrors.length > 0) && <div className="library-controls">
          <label htmlFor="library-source">书签来源
            <select id="library-source" value={source ? `${source.kind}:${source.id}` : ''} onChange={(event) => setManual(event.target.value)} disabled={!native || invalid}>
              {profiles.map((item) => <option key={`profile:${item.profileId}`} value={`profile:${item.profileId}`}>{item.displayName}</option>)}
              {mirrors.map((item) => <option key={`mirror:${item.mirrorSourceId}`} value={`mirror:${item.mirrorSourceId}`}>{item.displayName}</option>)}
            </select>
          </label>
          <label htmlFor="library-search">搜索标题或网址
            <input id="library-search" value={query} maxLength={4096} disabled={!inputsReady} onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              if (!next) { setCommitted(''); setResults(null); setTruncated(false); }
            }} />
          </label>
        </div>}
        <p className="secondary">在文件夹或书签列表中使用方向键移动。向右展开文件夹，Enter 打开 http 或 https 链接。</p>
        {gap && <p role="status">来源版本不连续，已重新读取。</p>}
        {phase === 'stale' && <p role="status">无法刷新书签，仍显示上次结果。</p>}
        {phase === 'error' && <p role="alert">无法读取书签。请稍后重试。</p>}
        {openFailed && <p role="alert">无法打开链接。</p>}
      </div>
      {!source && state && <p className="secondary">尚未接入书签来源。配对 Chrome 或接入只读文件后，可在此浏览。</p>}
      {!state && <p role="status">正在读取书签。</p>}
      {source && native && !invalid && <div className="library-panes">
        <div className="library-pane">
          <h3>文件夹</h3>
          {(phase === 'loading' && folders.length === 0) || waitingForCache ? <p role="status">正在读取书签。</p> : folders.length === 0 ? <p>{visible.length > 0 ? '没有文件夹。' : phase === 'error' ? '没有可显示的文件夹。' : '此资料还没有书签。'}</p> : (
            <VirtualRows
              rows={folders}
              rowKey={(row) => rowKey('folder', row.chromeId)}
              label="文件夹"
              role="tree"
              itemRole="treeitem"
              activeKey={folderId ? rowKey('folder', folderId) : null}
              onActive={(key) => chooseFolder(key.slice('folder:'.length))}
              onKeyDown={onTreeKey}
              rowProps={(row: FolderRow) => row.expandable ? { 'aria-expanded': row.expanded } : {}}
              dragId={profile?.connection === 'live' ? (row) => row.chromeId : undefined}
              onDropRow={profile?.connection === 'live' ? (row, sourceId) => dropBookmark(row.chromeId, sourceId) : undefined}
              render={(row) => <span className="library-label"><span className="library-kind">{row.expanded ? '收起' : row.expandable ? '展开' : '文件夹'}</span><span className="library-title" style={{ paddingLeft: row.depth * 16 }}>{row.title}</span></span>}
            />
          )}
        </div>
        <div className="library-pane">
          <h3>{filtering ? '标签筛选' : searching ? '搜索结果' : '书签列表'}</h3>
          <p className="secondary">
            {filtering ? `${visible.length} 条带此标签` : searching ? `${visible.length} 条匹配` : shownCount ? `下级文件夹 ${shownCount.folders} · 下级书签 ${shownCount.bookmarks}` : '正在计数'}
            {showSearchTruncation ? '。只显示前 200 条。' : ''}
            {!searching && total > list.length ? `。列表已截断，显示前 ${list.length} 条。` : ''}
          </p>
          {visible.length === 0 ? <p>{filtering ? '没有带这个标签的书签。' : searching ? '没有匹配的标题或网址。' : '此文件夹没有书签。'}</p> : (
            <VirtualRows
              rows={visible}
              rowKey={(row) => rowKey(sourceKey, row.chromeId)}
              label={filtering ? '标签筛选' : searching ? '搜索结果' : '书签列表'}
              role="listbox"
              itemRole="option"
              activeKey={bookmarkId ? rowKey(sourceKey, bookmarkId) : null}
              onActive={(key) => {
                const chromeId = key.slice(sourceKey.length + 1);
                const row = visible.find((item) => item.chromeId === chromeId);
                if (row?.kind === 'folder') {
                  chooseFolder(chromeId);
                  setQuery('');
                  setCommitted('');
                  setResults(null);
                  if (!expanded.has(chromeId)) void toggleFolder(chromeId);
                } else setBookmarkId(chromeId);
              }}
              onKeyDown={onListKey}
              dragId={profile?.connection === 'live' ? (row) => row.chromeId : undefined}
              onDropRow={profile?.connection === 'live' ? (row, sourceId) => dropBookmark(row.chromeId, sourceId) : undefined}
              render={(row: ListRow) => <span className="library-label">{profile && <input type="checkbox" aria-label={`选择 ${row.title}`} checked={picked.has(row.chromeId)} onClick={(event) => event.stopPropagation()} onChange={() => togglePick(row.chromeId)} />}<span className="library-kind">{row.kind === 'folder' ? '文件夹' : '书签'}</span><span className="library-title">{row.title}</span>{row.url && <span className="library-url">{row.url}</span>}</span>}
            />
          )}
        </div>
        <div className="library-pane" aria-labelledby="detail-title">
          <h3 id="detail-title">详情</h3>
          {!detailView ? <p>选择文件夹或书签后，在此查看标题、网址和路径。</p> : <>
            <p className="library-detail-title">{displayTitle(detailView.title)}</p>
            <dl className="identity">
              <dt>类型</dt><dd>{detailView.kind === 'folder' ? '文件夹' : '书签'}</dd>
              <dt>浏览器节点</dt><dd>{detailView.chromeId}</dd>
              <dt>网址</dt><dd className="library-detail-url">{detailView.url ?? '无'}</dd>
            </dl>
            <p className="secondary">所在路径</p>
            {detailView.ancestors.length === 0 ? <p>位于顶层。</p> : <ol className="library-path" aria-label="所在路径">{detailView.ancestors.map((name, index) => <li key={`${name}-${index}`}>{displayTitle(name)}</li>)}</ol>}
            <button type="button" disabled={!native || !isHttpUrl(detailView.url)} onClick={() => { if (detailView.url) void open(detailView.url); }}>在浏览器中打开</button>
            {!isHttpUrl(detailView.url) && <p className="secondary">仅打开 http 或 https 链接。</p>}
            {profile && detailView.kind === 'bookmark' && <>
              <ContentPreviewPanel profileId={profile.profileId} chromeId={detailView.chromeId} url={detailView.url ?? null} />
              <AiSuggest profileId={profile.profileId} chromeId={detailView.chromeId} url={detailView.url ?? null} revision={profile.revision} />
              <WebPreviewPanel profileId={profile.profileId} profileName={profile.displayName} chromeId={detailView.chromeId} url={detailView.url ?? null} native={native} />
            </>}
          </>}
          {profile?.connection === 'live' && <EditDesk
            profileId={profile.profileId}
            revision={profile.revision}
            node={selectedNode}
            siblingIds={selectedNode?.parentId ? [...(activeIndex.children.get(selectedNode.parentId) ?? [])] : []}
            folderId={folderId}
            insertParentId={selectedNode ? (selectedNode.kind === 'folder' ? selectedNode.chromeId : selectedNode.parentId ?? null) : null}
            insertPosition={(selectedNode?.kind === 'folder' ? activeIndex.children.get(selectedNode.chromeId)?.length : selectedNode?.parentId ? activeIndex.children.get(selectedNode.parentId)?.length : 0) ?? 0}
            request={editRequest}
          />}
          {profile && <TagDesk
            profileId={profile.profileId}
            revision={profile.revision}
            live={profile.connection === 'live'}
            chromeIds={tagIds}
            filterTagId={filterTagId}
            onFilter={setFilterTagId}
            onCatalog={acceptCatalog}
          />}
        </div>
      </div>}
    </section>
  );
}
