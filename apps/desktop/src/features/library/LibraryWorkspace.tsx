import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BookmarkNode, BridgeState, LibraryDetail, TagCatalog } from '@markbridge/protocol';
import {
  getMirrorTree, openHttpUrl, readCacheNode, readCacheTree,
  type EditAction,
} from '../../backend';
import { OrganizeWorkspace } from '../organization/OrganizeWorkspace';
import { SemanticWorkspace } from '../semantic/SemanticWorkspace';
import { ContentPreviewPanel } from '../preview/ContentPreview';
import { WebPreviewPanel } from '../preview/WebPreview';
import { EditDesk } from './EditDesk';
import { HistoryWorkspace } from '../history/HistoryWorkspace';
import { ExportDesk } from '../history/ExportDesk';
import { BatchEditDesk, type BatchRequest } from './BatchEditDesk';
import { TagDesk } from '../tags/TagDesk';
import { VirtualRows } from './VirtualRows';
import { WorkspaceIcon } from './WorkspaceIcon';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { cacheTime, profileNextStep, type SourceRequest, type SourceTarget } from '../settings/source-status';
import {
  PAGE_SIZE, ancestorTitles, displayTitle, folderRows, folderPath, indexFlat, isHttpUrl,
  looseBookmarks, rootFolders, rowKey, querySnapshot, toListRow, type FolderRow, type ListRow,
} from './model';
import { useLibraryQuery } from './useLibraryQuery';

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

function siteLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

function chromeFromTarget(event: KeyboardEvent<HTMLDivElement>, prefix: string): string | null {
  const target = event.target as HTMLElement;
  return target.id.startsWith(prefix) ? target.id.slice(prefix.length) : null;
}

function neighbor(ids: string[], current: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const index = current == null ? -1 : ids.indexOf(current);
  if (index < 0) return delta < 0 ? ids[ids.length - 1]! : ids[0]!;
  const next = Math.min(ids.length - 1, Math.max(0, index + delta));
  return ids[next] ?? null;
}

export function LibraryWorkspace({ state, invalid, native, focusMirrorId, section = 'library', active = true, sidebarHost, onSettings, onLibrary, onExport, onOrganize, onAiSettings, onSemanticSettings, onHistory, sourceRequest, onCurrentSource }: {
  state: BridgeState | null;
  invalid: boolean;
  native: boolean;
  focusMirrorId: string | null;
  section?: 'library' | 'organize' | 'semantic' | 'history' | 'export';
  active?: boolean;
  sidebarHost?: HTMLDivElement | null;
  onSettings?: () => void;
  onLibrary?: () => void;
  onExport?: () => void;
  onOrganize?: () => void;
  onAiSettings?: () => void;
  onSemanticSettings?: () => void;
  onHistory?: () => void;
  sourceRequest?: SourceRequest | null;
  onCurrentSource?: (source: SourceTarget | null) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [organizeVisited, setOrganizeVisited] = useState(false);
  if (section === 'organize' && !organizeVisited) setOrganizeVisited(true);
  const [detailTab, setDetailTab] = useState<'info' | 'metadata' | 'content'>('info');
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [metadataDraftIds, setMetadataDraftIds] = useState<string[] | null>(null);
  const [draftReset, setDraftReset] = useState(0);
  const [pendingDraftLeave, setPendingDraftLeave] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const [creating, setCreating] = useState(false);
  const [batchRequest, setBatchRequest] = useState<BatchRequest | null>(null);
  const [editingBatch, setEditingBatch] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const detailReturn = useRef<HTMLButtonElement>(null);
  const folderTrigger = useRef<HTMLButtonElement>(null);
  const breadcrumbs = useRef<HTMLElement>(null);
  const sourceTrigger = useRef<HTMLSelectElement>(null);
  const [inputsChanged, setInputsChanged] = useState(false);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const lastRequest = useRef<SourceRequest | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const source = resolveSource(state, manual, focusMirrorId);
  const sourceKey = source ? `${source.kind}:${source.id}` : '';
  const currentKey = useRef(sourceKey);
  const sourceGeneration = useRef(0);
  currentKey.current = sourceKey;
  const profile = source?.kind === 'profile' ? source.profile : null;
  const mirror = source?.kind === 'mirror' ? source.mirror : null;
  const [seenKey, setSeenKey] = useState(sourceKey);
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [mirrorNodes, setMirrorNodes] = useState<BookmarkNode[]>([]);
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { const element = breadcrumbs.current; if (element) element.scrollLeft = element.scrollWidth; });
    return () => cancelAnimationFrame(frame);
  }, [folderId, detailOpen]);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'stale'>('loading');
  const [gap, setGap] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [editRequest, setEditRequest] = useState<{ id: number; action: EditAction } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [tags, setTags] = useState<TagCatalog['tags']>([]);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [scope, setScope] = useState<'all' | 'subtree'>('all');
  const [includeSummary, setIncludeSummary] = useState(false);
  const [includeNote, setIncludeNote] = useState(false);
  const [mirrorLimit, setMirrorLimit] = useState(PAGE_SIZE);
  const [selectionNotice, setSelectionNotice] = useState('');
  const anchor = useRef<string | null>(null);
  const editSeq = useRef(0);
  const seenRevision = useRef<number | null>(null);
  const detailGen = useRef(0);
  const mirrorGen = useRef(0);
  const treeGen = useRef(0);

  if (seenKey !== sourceKey) {
    sourceGeneration.current += 1;
    setSeenKey(sourceKey);
    setInputsChanged(false);
    setMetadataDirty(false); setMetadataDraftIds(null); setPendingDraftLeave(false); pendingNavigation.current = null;
    setPendingSource(null);
    setDetailOpen(false);
    setCreating(false); setBatchRequest(null); setEditingBatch(false);
    setFoldersOpen(false);
    setFiltersOpen(false);
    setQuery('');
    setMirrorNodes([]);
    setNodes([]);
    setDetail(null);
    setFolderId(null);
    setBookmarkId(null);
    setExpanded(new Set());
    setPhase('loading');
    setGap(false);
    setOpenFailed(false);
    setEditRequest(null);
    setPicked(new Set());
    setFilterTagId(null);
    setTags([]);
    setIncludeSummary(false);
    setIncludeNote(false);
    setScope('all');
    seenRevision.current = null;
    treeGen.current += 1;
    detailGen.current += 1;
    mirrorGen.current += 1;
  }
  const sourceVisit = sourceGeneration.current;

  function chooseSource(token: string) {
    if (token === sourceKey) return;
    if (inputsChanged || metadataDirty) setPendingSource(token);
    else setManual(token);
  }

  useEffect(() => {
    if (!sourceRequest || sourceRequest === lastRequest.current) return;
    lastRequest.current = sourceRequest;
    const token = `${sourceRequest.kind}:${sourceRequest.id}`;
    if (token === sourceKey) return;
    if (inputsChanged || metadataDirty) setPendingSource(token);
    else setManual(token);
  }, [sourceRequest, inputsChanged, metadataDirty, sourceKey]);

  function leaveMetadata(work: () => void, nextIds?: string[]) {
    const sameTargets = nextIds && [...nextIds].sort().join(',') === [...tagIds].sort().join(',');
    if (metadataDirty && !sameTargets) { pendingNavigation.current = work; setPendingDraftLeave(true); }
    else work();
  }

  useEffect(() => {
    if (focusMirrorId) setManual(`mirror:${focusMirrorId}`);
  }, [focusMirrorId]);

  useEffect(() => {
    if (!sourceKey) onCurrentSource?.(null);
    else {
      const split = sourceKey.indexOf(':');
      onCurrentSource?.({ kind: sourceKey.slice(0, split) as SourceTarget['kind'], id: sourceKey.slice(split + 1) });
    }
  }, [sourceKey, onCurrentSource]);

  useEffect(() => {
    if (!invalid) return;
    setNodes([]);
    setMirrorNodes([]);
    setDetail(null);
  }, [invalid]);

  useEffect(() => {
    const revision = profile?.revision ?? mirror?.revision;
    if (!sourceKey || revision == null) return;
    const previous = seenRevision.current;
    seenRevision.current = revision;
    setGap(previous != null && revision > previous + 1);
  }, [sourceKey, profile?.revision, mirror?.revision]);

  useEffect(() => {
    if (!profile || !native || invalid) return;
    const generation = ++treeGen.current;
    let cancelled = false;
    void readCacheTree(profile.profileId, null, 0).then((tree) => {
      if (cancelled || treeGen.current !== generation) return;
      setNodes(tree.nodes);
      setPhase('ready');
      const flat = indexFlat(tree.nodes);
      const roots = rootFolders(flat).map((node) => node.chromeId);
      setExpanded((current) => current.size ? current : new Set(roots));
      setFolderId((current) => current && flat.nodes.get(current)?.kind === 'folder' ? current : roots[0] ?? null);
      setPicked((current) => new Set([...current].filter((id) => flat.nodes.has(id))));
      setBookmarkId((current) => current && flat.nodes.has(current) ? current : null);
    }, () => { if (!cancelled) setPhase((current) => current === 'ready' ? 'stale' : 'error'); });
    return () => { cancelled = true; };
  }, [profile, native, invalid]);

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
        setFolderId((current) => current && flat.nodes.get(current)?.kind === 'folder' ? current : roots[0] ?? null);
        setPicked((current) => new Set([...current].filter((id) => flat.nodes.has(id))));
        setBookmarkId((current) => current && flat.nodes.has(current) ? current : !roots.length ? looseBookmarks(tree.nodes)[0]?.chromeId ?? null : null);
      } catch {
        if (!cancelled && mirrorGen.current === generation) setPhase((current) => current === 'ready' ? 'stale' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [mirror, native, invalid]);

  const activeIndex = useMemo(() => indexFlat(profile ? nodes : mirrorNodes), [profile != null, nodes, mirrorNodes]);
  const folders = useMemo(() => folderRows(activeIndex, expanded), [activeIndex, expanded]);
  const searching = query.length > 0;
  const filtering = profile != null && filterTagId != null;
  const folderScope = searching || filtering ? scope : 'children';
  const sidecarRevision = filtering || (searching && (includeNote || includeSummary)) ? state?.revision ?? 0 : 0;
  const paging = useLibraryQuery(profile && native && !invalid && (folderId || folderScope === 'all') ? profile.profileId : null, profile?.revision ?? 0, `${sourceKey}:${sourceVisit}:${sidecarRevision}`, {
    folderId, folderScope, query, tagIds: filtering ? [filterTagId!] : [], includeSummary: !!profile && includeSummary, includeNote: !!profile && includeNote,
  });
  const epochRef = useRef<{ source: string; epoch: number | null }>({ source: sourceKey, epoch: null });
  if (epochRef.current.source !== sourceKey) epochRef.current = { source: sourceKey, epoch: null };
  if (paging.page) epochRef.current.epoch = paging.page.sourceEpoch;
  const mirrorMatches = useMemo(() => profile ? [] : querySnapshot(activeIndex, folderId, folderScope, query), [profile != null, activeIndex, folderId, folderScope, query]);
  const visibleNodes = profile ? paging.page?.items ?? [] : mirrorMatches.slice(0, mirrorLimit);
  const visible = visibleNodes.map(toListRow);
  const total = profile ? paging.page?.total ?? 0 : mirrorMatches.length;
  const hasMore = profile ? paging.page?.nextOffset != null : mirrorLimit < total;
  const busy = profile ? paging.busy : false;
  const selectionKey = JSON.stringify([sourceKey, sourceVisit, folderId, query, filterTagId, scope, includeNote, includeSummary, sidecarRevision, paging.generation, paging.page?.sourceEpoch ?? null, mirror?.revision]);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (selectionKey !== seenSelection) {
    setSeenSelection(selectionKey);
    if (picked.size) setSelectionNotice('范围已改变，已清除多选。');
    setPicked(new Set());
    anchor.current = null;
    setMirrorLimit(PAGE_SIZE);
  }
  const pickedIds = visibleNodes.filter((node) => picked.has(node.chromeId)).map((node) => node.chromeId);
  const currentFolderPath = folderPath(activeIndex, folderId).map((node) => displayTitle(node.title));
  const pickedBookmarks = visibleNodes.filter((node) => picked.has(node.chromeId) && node.kind === 'bookmark');
  const tagIds = pickedIds.length > 0 ? pickedIds : bookmarkId ? [bookmarkId] : [];
  const metadataTargets = metadataDraftIds ?? tagIds;
  const multiSelection = pickedIds.length > 1;
  function selectRow(chromeId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
    const ids = visibleNodes.map((node) => node.chromeId);
    if (modifiers.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const left = ids.indexOf(anchor.current);
      const right = ids.indexOf(chromeId);
      const range = ids.slice(Math.min(left, right), Math.max(left, right) + 1);
      setPicked(new Set(modifiers.ctrlKey || modifiers.metaKey ? [...picked, ...range] : range));
    } else if (modifiers.ctrlKey || modifiers.metaKey) {
      setPicked((current) => { const next = new Set(current); if (next.has(chromeId)) next.delete(chromeId); else next.add(chromeId); return next; });
      anchor.current = chromeId;
    } else { setPicked(new Set([chromeId])); anchor.current = chromeId; }
    setBookmarkId(chromeId);
    setCreating(false); setEditingBatch(false);
    setSelectionNotice('');
  }
  function togglePick(chromeId: string) {
    const next = picked.has(chromeId) ? [...picked].filter((id) => id !== chromeId) : [...picked, chromeId];
    leaveMetadata(() => selectRow(chromeId, { ctrlKey: true }), next.length ? next : [chromeId]);
  }
  function acceptCatalog(catalog: TagCatalog) {
    setTags(catalog.tags);
  }
  const metadataQuery = useRef({ active: false, refresh: paging.refresh });
  metadataQuery.current = { active: filtering || (searching && (includeNote || includeSummary)), refresh: paging.refresh };
  function refreshMetadataSearch(refreshCatalog = false) {
    if (currentKey.current !== sourceKey || sourceGeneration.current !== sourceVisit) return;
    if (refreshCatalog) setCatalogRefresh((value) => value + 1);
    if (metadataQuery.current.active) metadataQuery.current.refresh();
  }
  async function loadMore(toEnd = false) {
    if (!profile) {
      const next = toEnd ? mirrorMatches.length : Math.min(mirrorLimit + PAGE_SIZE, mirrorMatches.length);
      setMirrorLimit(next);
      if (toEnd) setBookmarkId(mirrorMatches[next - 1]?.chromeId ?? null);
      return;
    }
    const last = await paging.loadMore(toEnd);
    if (last && toEnd) { setBookmarkId(last); setPicked(new Set([last])); }
  }
  const waitingForCache = phase === 'loading';
  const selectedId = bookmarkId ?? folderId;
  const selectedNode = profile && detail && detail.node.chromeId === selectedId ? detail.node : null;
  const mirrorNode = !profile && selectedId ? activeIndex.nodes.get(selectedId) ?? null : null;
  const detailView = profile && detail && detail.node.chromeId === selectedId
    ? { title: detail.node.title, url: detail.node.url ?? null, kind: detail.node.kind, chromeId: detail.node.chromeId, ancestors: detail.ancestors }
    : mirrorNode
      ? { title: mirrorNode.title, url: mirrorNode.url ?? null, kind: mirrorNode.kind, chromeId: mirrorNode.chromeId, ancestors: ancestorTitles(activeIndex, mirrorNode.chromeId) }
      : null;
  const visibleDetailTab = multiSelection ? 'metadata' : !profile || (detailTab === 'content' && detailView?.kind !== 'bookmark') ? 'info' : detailTab;

  function showDetail() {
    setDetailOpen(true);
    if (window.innerWidth < 1100) requestAnimationFrame(() => detailReturn.current?.focus());
  }

  function selectBookmark(chromeId: string) {
    setBookmarkId(chromeId);
    setPicked(new Set([chromeId]));
    showDetail();
  }

  function closeFolders() {
    setFoldersOpen(false);
    requestAnimationFrame(() => folderTrigger.current?.focus());
  }

  function closeDetail() {
    setDetailOpen(false);
    requestAnimationFrame(() => detailTrigger.current?.focus());
  }

  function chooseFolder(chromeId: string, resetScope = false) {
    leaveMetadata(() => {
    setCreating(false);
    setFolderId(chromeId);
    if (resetScope) setScope('all');
    setBookmarkId(null);
    setQuery('');
    setFilterTagId(null);
    setExpanded((current) => new Set([...current, ...folderPath(activeIndex, chromeId).map((node) => node.chromeId)]));
    });
  }

  async function toggleFolder(chromeId: string) {
    setExpanded((current) => { const next = new Set(current); if (next.has(chromeId)) next.delete(chromeId); else next.add(chromeId); return next; });
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
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      chooseFolder(current);
      if (foldersOpen) closeFolders();
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); leaveMetadata(() => { setPicked(new Set(visibleNodes.map((node) => node.chromeId))); setSelectionNotice(''); }); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'End' && hasMore) { event.preventDefault(); leaveMetadata(() => { void loadMore(true); }); return; }
    if (event.target instanceof HTMLInputElement) return;
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
      setDetailOpen(true);
      setCreating(false); setEditingBatch(false);
      setEditRequest({ id: editSeq.current += 1, action: { kind: 'reorder', parentId, childIds } });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = neighbor(ids, currentId, event.key === 'ArrowDown' ? 1 : -1);
      if (next) leaveMetadata(() => { if (event.shiftKey) selectRow(next, event); else { setBookmarkId(next); setPicked(new Set([next])); } });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
      if (next) leaveMetadata(() => { if (event.shiftKey) selectRow(next, event); else { setBookmarkId(next); setPicked(new Set([next])); } });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const current = visible.find((row) => row.chromeId === (currentId ?? ids[0]));
      if (!current) return;
      if (current.kind === 'folder') {
        chooseFolder(current.chromeId);
      } else {
        leaveMetadata(() => {
          selectBookmark(current.chromeId);
          if (current.url && isHttpUrl(current.url)) void open(current.url);
        }, [current.chromeId]);
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
      setDetailOpen(true);
      setCreating(false); setEditingBatch(false);
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
      setDetailOpen(true);
      setCreating(false); setEditingBatch(false);
      setEditRequest({ id: editSeq.current += 1, action: { kind: 'reorder', parentId, childIds } });
      return;
    }
    setDetailOpen(true);
    setCreating(false); setEditingBatch(false);
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


  const folderPane = source && native && !invalid ? (
        <div className={`library-pane folder-pane ${foldersOpen ? 'is-open' : ''}`} hidden={!active || section !== 'library'} onKeyDown={(event) => { if (event.key === 'Escape' && foldersOpen) { event.stopPropagation(); closeFolders(); } }}>
          <div className="pane-heading"><h3>文件夹</h3><button className="folder-return" type="button" onClick={closeFolders}>返回列表</button></div>
          {(phase === 'loading' && folders.length === 0) || waitingForCache ? <p role="status">正在读取书签。</p> : folders.length === 0 ? <p>{visible.length > 0 ? '没有文件夹。' : phase === 'error' ? '没有可显示的文件夹。' : '此资料还没有书签。'}</p> : (
            <VirtualRows
              rows={folders}
              rowKey={(row) => rowKey('folder', row.chromeId)}
              label="文件夹"
              role="tree"
              itemRole="treeitem"
              activeKey={folderId ? rowKey('folder', folderId) : null}
              onActive={(key, reason) => { chooseFolder(key.slice('folder:'.length)); if (reason === 'pointer' && foldersOpen) closeFolders(); }}
              onKeyDown={onTreeKey}
              rowProps={(row: FolderRow) => ({ 'aria-level': row.depth + 1, 'aria-posinset': row.positionInSet, 'aria-setsize': row.setSize, ...(row.expandable ? { 'aria-expanded': row.expanded } : {}) })}
              dragId={profile?.connection === 'live' ? (row) => row.chromeId : undefined}
              onDropRow={profile?.connection === 'live' ? (row, sourceId) => dropBookmark(row.chromeId, sourceId) : undefined}
              render={(row) => <span className="library-label" title={row.title} style={{ paddingLeft: Math.min(row.depth, 5) * 12 }}><span className="tree-icon"><WorkspaceIcon name="folder" /></span><span className="library-title">{row.title}</span></span>}
            />
          )}
        </div>
  ) : null;
  return <>
    {pendingDraftLeave && <ConfirmDialog title="放弃未保存的本地草稿？" confirmLabel="放弃草稿并继续" returnFocus={detailReturn} onCancel={() => { pendingNavigation.current = null; setPendingDraftLeave(false); }} onConfirm={() => { const next = pendingNavigation.current; pendingNavigation.current = null; setPendingDraftLeave(false); setMetadataDirty(false); setMetadataDraftIds(null); setDraftReset((value) => value + 1); next?.(); }}>
      <p>标签或备注的输入尚未保存。已保存的本地内容会保留。</p>
    </ConfirmDialog>}
    {pendingSource && <ConfirmDialog title="切换书签来源？" confirmLabel="清除当前输入并切换" returnFocus={sourceTrigger} onCancel={() => setPendingSource(null)} onConfirm={() => { setInputsChanged(false); setManual(pendingSource); setPendingSource(null); }}>
      <p>切换会关闭当前详情，清除详情中的输入和未确认预览。已保存的内容会保留。</p><p>要继续编辑当前输入，请留在当前页面。</p>
    </ConfirmDialog>}
    {sidebarHost && createPortal(folderPane, sidebarHost)}
    <section className={`library ${sidebarHost ? 'in-shell' : 'standalone'} ${detailOpen ? 'has-detail' : ''}`} hidden={!active} id={section === 'export' ? 'settings-panel-export' : undefined} role={section === 'export' ? 'tabpanel' : undefined} aria-labelledby={section === 'export' ? 'settings-tab-export' : undefined} aria-busy={(source && native && phase === 'loading') || undefined} aria-label={section === 'library' ? '书签工作区' : section === 'organize' ? '整理工作区' : section === 'semantic' ? '语义工作区' : section === 'history' ? '历史工作区' : '导出工作区'}>
      <div className="library-toolbar">
        {state && (profiles.length > 0 || mirrors.length > 0) && <div className="library-controls">
          <label htmlFor="library-source">书签来源
            <select id="library-source" ref={sourceTrigger} value={source ? `${source.kind}:${source.id}` : ''} onChange={(event) => chooseSource(event.target.value)} disabled={!native || invalid}>
              {profiles.map((item) => <option key={`profile:${item.profileId}`} value={`profile:${item.profileId}`}>{item.displayName} · Chrome</option>)}
              {mirrors.map((item) => <option key={`mirror:${item.mirrorSourceId}`} value={`mirror:${item.mirrorSourceId}`}>{item.displayName} · 文件只读</option>)}
            </select>
          </label>
          <label hidden={section !== 'library'} htmlFor="library-search">搜索标题或网址
            <input id="library-search" value={query} maxLength={4096} disabled={!inputsReady} onChange={(event) => {
              const next = event.target.value;
              leaveMetadata(() => setQuery(next));

            }} />
          </label>
          {section === 'library' && <>
            <button type="button" className="folder-toggle" ref={folderTrigger} onClick={() => { setFoldersOpen(true); requestAnimationFrame(() => document.querySelector<HTMLElement>('.folder-pane .library-row[tabindex="0"]')?.focus()); }}><WorkspaceIcon name="folder" />文件夹</button>
            <button type="button" ref={detailTrigger} aria-pressed={detailOpen} disabled={!detailView && !multiSelection} onClick={() => { if (detailOpen) closeDetail(); else showDetail(); }}><WorkspaceIcon name="detail" />详情</button>
          </>}
        </div>}

        {source && section === 'library' && <div className="library-filters" id="library-filters" hidden={!filtersOpen}>
          <label htmlFor="library-scope">搜索范围<select id="library-scope" value={scope} onChange={(event) => { const value = event.target.value as 'all' | 'subtree'; leaveMetadata(() => setScope(value)); }}><option value="all">全部书签</option><option value="subtree">当前目录及后代</option></select></label>
          {profile && <label htmlFor="library-tag">标签<select id="library-tag" value={filterTagId ?? ''} onChange={(event) => { const value = event.target.value || null; leaveMetadata(() => setFilterTagId(value)); }}><option value="">所有标签</option>{tags.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}</select></label>}
          {profile && <details><summary>更多搜索范围</summary><label className="checkbox-label"><input type="checkbox" checked={includeSummary} onChange={(event) => { const value = event.target.checked; leaveMetadata(() => setIncludeSummary(value)); }} />包含摘要</label><label className="checkbox-label"><input type="checkbox" checked={includeNote} onChange={(event) => { const value = event.target.checked; leaveMetadata(() => setIncludeNote(value)); }} />包含备注</label></details>}
        </div>}
        {source && <div className="source-guidance">
          <p className="access-note">{invalid ? '连接状态无效，已停止更新书签列表。' : accessNote(source)} 缓存时间：{cacheTime(profile?.lastSyncedAt ?? mirror?.lastSyncedAt ?? null)}</p>
          {(profile?.connection !== 'live' || invalid) && <details><summary>来源状态与恢复</summary><p>{profile ? profileNextStep(profile.connection) : mirror?.watching ? '文件来自你选择的 Chrome 目录。文件陈旧或不可用时保留最后缓存；请检查目录后重新读取。' : '此文件来源已停止监听。若要更新，请在连接设置中重新接入同一目录。'}</p>{onSettings && <button type="button" onClick={onSettings}>检查连接设置</button>}</details>}
        </div>}
        {gap && <p role="status">来源版本不连续，已重新读取。</p>}
        {phase === 'stale' && <p role="status">无法刷新书签，仍显示上次结果。</p>}
        {phase === 'error' && <p role="alert">无法读取书签。请稍后重试。</p>}
        {openFailed && <p role="alert">无法打开链接。</p>}
      </div>
      {!source && state && <div className="empty-state">
        <span className="empty-mark"><WorkspaceIcon name="bookmark" /></span><h2>连接你的 Chrome 书签</h2>
        <p>尚未接入书签来源。配对 Chrome 或接入只读文件后，可在此浏览。</p>
        {!native && <p className="preview-note">浏览器预览 · 当前预览不能读取书签。请在桌面应用中连接。</p>}
        {onSettings && <button type="button" className="primary-button" onClick={onSettings}>连接 Chrome 或只读来源</button>}
      </div>}
      {!state && <div className="empty-state" role="status">正在读取书签。</div>}
      {source && native && !invalid && <>
        <div className="library-panes" hidden={section !== 'library'}>
          {!sidebarHost && folderPane}
        <div className="library-pane list-pane">
          <div className="browse-actions">
          <div className="pane-heading browse-heading" aria-hidden={pickedIds.length > 0} inert={pickedIds.length > 0}><nav ref={breadcrumbs} className="library-breadcrumbs" aria-label="当前目录"><button type="button" onClick={() => { const root = rootFolders(activeIndex)[0]; if (root) chooseFolder(root.chromeId, true); }}>书签</button>{folderPath(activeIndex, folderId).map((node) => <button type="button" key={node.chromeId} title={displayTitle(node.title)} aria-current={node.chromeId === folderId ? 'location' : undefined} onClick={() => chooseFolder(node.chromeId)}>{displayTitle(node.title)}</button>)}</nav>
          <h2 className="visually-hidden">{filtering ? '标签筛选' : searching ? '搜索结果' : '书签列表'}</h2><button type="button" aria-expanded={filtersOpen} aria-controls="library-filters" onClick={() => setFiltersOpen((value) => !value)}>筛选</button><button type="button" disabled={profile?.connection !== 'live' || !folderId} onClick={() => leaveMetadata(() => { setBookmarkId(null); setCreating(true); setEditingBatch(false); showDetail(); requestAnimationFrame(() => document.getElementById('edit-title')?.focus()); })}>新建</button>{(searching || filtering) && <button type="button" onClick={() => leaveMetadata(() => { setQuery(''); setFilterTagId(null); setIncludeNote(false); setIncludeSummary(false); })}>清空筛选</button>}{hasMore && <button type="button" disabled={busy} onClick={() => void loadMore()}>加载下一页</button>}</div>
          {pickedIds.length > 0 && <div className="selection-toolbar" aria-label="所选项目操作"><details className="selection-path" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label="查看当前目录完整路径" title={currentFolderPath.join(' / ')}>{currentFolderPath.at(-1) ?? '全部书签'}</summary><p tabIndex={0}>{currentFolderPath.join(' / ') || '全部书签'}</p></details><span>{pickedIds.length} 项待处理</span>{(['move', 'delete'] as const).map((kind) => <button key={kind} type="button" disabled={profile?.connection !== 'live'} onClick={() => leaveMetadata(() => { setCreating(false); setEditingBatch(true); setBatchRequest({ id: ++editSeq.current, kind, chromeIds: [...pickedIds] }); showDetail(); })}>{kind === 'move' ? '移动所选' : '删除所选'}</button>)}<button type="button" onClick={() => { setEditingBatch(false); setDetailTab('metadata'); showDetail(); requestAnimationFrame(() => document.getElementById('tag-name')?.focus()); }}>标签</button><button type="button" onClick={() => leaveMetadata(() => setPicked(new Set()))}>取消选择</button></div>}
          </div>
          <p className="secondary" role="status">{busy ? '正在读取 · ' : ''}已加载 {visible.length} / {total} 项{pickedIds.length > 0 ? ` · 已选 ${pickedIds.length} 项` : ''} · {(searching || filtering) ? (scope === 'all' ? '全部书签' : '当前目录及后代') : '当前目录'}{filtering ? ` · 标签：${tags.find((tag) => tag.tagId === filterTagId)?.name ?? '已选择'}` : ''}{searching && includeSummary ? ' · 摘要' : ''}{searching && includeNote ? ' · 备注' : ''} · Ctrl+A 已加载{hasMore ? ' · Ctrl+End 末项' : ''}</p>
          {paging.restarted && <p role="status">来源版本已改变，已从第一页重新读取。</p>}
          {paging.failed && <p role="alert">无法读取列表。<button type="button" onClick={paging.refresh}>重试列表</button></p>}
          {phase === 'loading' || waitingForCache ? <p role="status">正在读取书签。</p> : phase === 'error' && visible.length === 0 ? <p>书签列表暂不可用。可在设置中检查来源。</p> : visible.length === 0 ? <p>{filtering ? '没有带这个标签的书签。' : searching ? '没有匹配的标题或网址。' : '此文件夹没有书签。'}</p> : (
            <VirtualRows
              rows={visible}
              rowHeight={52}
              rowKey={(row) => rowKey(sourceKey, row.chromeId)}
              label={filtering ? '标签筛选' : searching ? '搜索结果' : '书签列表'}
              role="listbox"
              itemRole="option"
              activeKey={bookmarkId ? rowKey(sourceKey, bookmarkId) : null}
              resetKey={selectionKey}
              onActive={(key, reason, event) => {
                const chromeId = key.slice(sourceKey.length + 1);
                if (reason === 'pointer') {
                  const next = event?.ctrlKey || event?.metaKey ? picked.has(chromeId) ? [...picked].filter((id) => id !== chromeId) : [...picked, chromeId] : [chromeId];
                  leaveMetadata(() => { selectRow(chromeId, event); if (!event?.ctrlKey && !event?.metaKey && !event?.shiftKey && visible.find((row) => row.chromeId === chromeId)?.kind === 'bookmark') showDetail(); }, event?.shiftKey ? undefined : next.length ? next : [chromeId]);
                }
                else if (chromeId !== bookmarkId && !metadataDirty) setBookmarkId(chromeId);
              }}
              onActivate={(row) => { if (row.kind === 'folder') chooseFolder(row.chromeId); else if (row.url && isHttpUrl(row.url)) void open(row.url); }}
              selectedKeys={new Set(pickedIds.map((id) => rowKey(sourceKey, id)))}
              total={total}
              onKeyDown={onListKey}
              dragId={profile?.connection === 'live' ? (row) => row.chromeId : undefined}
              onDropRow={profile?.connection === 'live' ? (row, sourceId) => dropBookmark(row.chromeId, sourceId) : undefined}
              render={(row: ListRow) => <span className="library-label">{<label className="row-checkbox" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${row.title}`} checked={picked.has(row.chromeId)} onClick={(event) => event.stopPropagation()} onChange={() => togglePick(row.chromeId)} /></label>}<span className="library-kind"><WorkspaceIcon name={row.kind === 'folder' ? 'folder' : 'bookmark'} /></span><span className="library-row-text"><span className="library-title">{row.title}</span>{row.url && <span className="library-url">{siteLabel(row.url)}</span>}</span></span>}
            />
          )}
          {visible.length === 0 && !searching && !filtering && profile?.connection !== 'live' && <p>当前只读，连接 Chrome 后可新建。</p>}
        </div>
        <div key={sourceKey} className="library-pane detail-pane" hidden={!detailOpen} aria-labelledby="detail-title" onChangeCapture={(event) => {
          const target = event.target;
          if ((target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') || target instanceof HTMLTextAreaElement) {
            if (target.closest('.edit-desk')) setInputsChanged(true);
          }
        }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeDetail(); } }}>
          <div className="pane-heading"><h3 id="detail-title">详情</h3><button type="button" className="icon-button" ref={detailReturn} aria-label="关闭详情，返回列表" onClick={closeDetail}><WorkspaceIcon name="close" /></button></div>
          {!creating && !editingBatch && <>
            {multiSelection ? <div className="detail-selection"><p className="library-detail-title">共同编辑 {pickedIds.length} 项</p><p className="secondary">标签与备注会应用到所选项目。</p></div> : <>
              {detailView && <div className="detail-summary"><p className="library-detail-title">{displayTitle(detailView.title)}</p><p className="secondary">{detailView.url ? siteLabel(detailView.url) : '文件夹'}</p></div>}
              <div className="detail-tabs" role="tablist" aria-label="详情分区" onKeyDown={(event) => {
                const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                const index = tabs.indexOf(event.target as HTMLButtonElement);
                const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
                if (next >= 0) { event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click(); }
              }}>
                {(['info', 'metadata', 'content'] as const).filter((tab) => tab === 'info' || !!profile && (tab === 'metadata' || detailView?.kind === 'bookmark')).map((tab) => <button type="button" key={tab} id={`detail-tab-${tab}`} role="tab" aria-controls={`detail-panel-${tab}`} aria-selected={visibleDetailTab === tab} tabIndex={visibleDetailTab === tab ? 0 : -1} onClick={() => setDetailTab(tab)}>{tab === 'info' ? '信息' : tab === 'metadata' ? '标签备注' : '内容预览'}</button>)}
              </div>
            </>}
            <div id="detail-panel-info" role="tabpanel" aria-labelledby="detail-tab-info" hidden={multiSelection || visibleDetailTab !== 'info'}>
              {!detailView ? <p>选择文件夹或书签后，在此查看标题、网址和路径。</p> : <>
                <dl className="detail-facts">
                  <dt>类型</dt><dd>{detailView.kind === 'folder' ? '文件夹' : '书签'}</dd>
                  <dt>网址</dt><dd className="library-detail-url" tabIndex={0}>{detailView.url ?? '此文件夹没有网址'}</dd>
                  <dt>所在路径</dt><dd>{detailView.ancestors.length ? <ol className="detail-path" aria-label="所在路径">{detailView.ancestors.map((name, index) => <li key={index}>{displayTitle(name)}</li>)}</ol> : '位于顶层'}</dd>
                  <dt>书签缓存更新</dt><dd>{cacheTime(profile?.lastSyncedAt ?? mirror?.lastSyncedAt ?? null)}</dd>
                </dl>
                {detailView.url && <button type="button" disabled={!native || !isHttpUrl(detailView.url)} onClick={() => { if (detailView.url) void open(detailView.url); }}>在浏览器中打开</button>}
                <details className="diagnostics"><summary>诊断信息</summary><dl className="identity"><dt>浏览器节点</dt><dd>{detailView.chromeId}</dd><dt>来源版本</dt><dd>{profile?.revision ?? mirror?.revision}</dd></dl></details>
              </>}
            </div>
            {profile && epochRef.current.epoch !== null && !multiSelection && detailView?.kind === 'bookmark' && visibleDetailTab === 'content' && active && section === 'library' && detailOpen && <div key={`${sourceKey}:${epochRef.current.epoch}:${detailView.chromeId}:${detailView.url}`} id="detail-panel-content" role="tabpanel" aria-labelledby="detail-tab-content">
              <ContentPreviewPanel key={`${profile.profileId}:${detailView.chromeId}:${detailView.url}`} profileId={profile.profileId} chromeId={detailView.chromeId} url={detailView.url} />
              <WebPreviewPanel profileId={profile.profileId} profileName={profile.displayName} chromeId={detailView.chromeId} url={detailView.url} native={native} />
              <button type="button" onClick={onOrganize}>前往整理查看 AI 建议</button>
            </div>}
          </>}
          {profile && batchRequest && <div hidden={!editingBatch}><BatchEditDesk profileId={profile.profileId} profileName={profile.displayName} revision={profile.revision} live={profile.connection === 'live'} nodes={nodes} request={batchRequest} /></div>}
          {profile && <div hidden={editingBatch || (!creating && (multiSelection || visibleDetailTab !== 'info'))}><EditDesk
            mode="edit"
            nodes={nodes}
            creating={creating}
            profileName={profile.displayName}
            live={profile.connection === 'live'}
            profileId={profile.profileId}
            revision={profile.revision}
            node={creating ? null : selectedNode}
            siblingIds={selectedNode?.parentId ? [...(activeIndex.children.get(selectedNode.parentId) ?? [])] : []}
            folderId={folderId}
            insertParentId={folderId}
            insertPosition={(selectedNode?.kind === 'folder' ? activeIndex.children.get(selectedNode.chromeId)?.length : selectedNode?.parentId ? activeIndex.children.get(selectedNode.parentId)?.length : 0) ?? 0}
            request={editRequest}
          /></div>}
          {profile && <div id="detail-panel-metadata" role={multiSelection ? 'region' : 'tabpanel'} aria-label={multiSelection ? '共同标签与备注' : undefined} aria-labelledby={multiSelection ? undefined : 'detail-tab-metadata'} hidden={creating || editingBatch || visibleDetailTab !== 'metadata'}><TagDesk
            profileId={profile.profileId}
            revision={profile.revision}
            live={profile.connection === 'live'}
            chromeIds={metadataTargets}
            sourceEpoch={epochRef.current.epoch}
            onDiscardDraft={() => { setMetadataDirty(false); setMetadataDraftIds(null); setDraftReset((value) => value + 1); }}
            onDirtyChange={(dirty) => { setMetadataDirty(dirty); setMetadataDraftIds((current) => dirty ? current ?? [...tagIds] : null); }}
            resetDraft={draftReset}
            filterTagId={filterTagId}
            refreshVersion={catalogRefresh}
            onFilter={(value) => leaveMetadata(() => setFilterTagId(value))}
            onCatalog={(catalog) => { if (currentKey.current === sourceKey && sourceGeneration.current === sourceVisit) acceptCatalog(catalog); }}
            onChanged={refreshMetadataSearch}
          /></div>}
        </div>

        </div>
        <div className="workspace-page" hidden={section !== 'organize'}>
          {!profile && <><h2>整理书签</h2><p>只读文件来源不支持整理。请在书签来源中选择已配对资料。</p></>}
          {organizeVisited && profile && epochRef.current.epoch !== null && <OrganizeWorkspace key={`organize:${sourceKey}:${epochRef.current.epoch}`} profileId={profile.profileId} profileName={profile.displayName} sourceEpoch={epochRef.current.epoch} revision={profile.revision} live={profile.connection === 'live'} active={active && section === 'organize'} nodes={nodes} selected={pickedBookmarks} folderId={folderId} onLibrary={onLibrary} onSettings={onAiSettings} onHistory={onHistory} onChanged={() => refreshMetadataSearch(true)} />}
        </div>
        <div className="workspace-page" hidden={section !== 'history'}>
          {section === 'history' && profile && <HistoryWorkspace profileId={profile.profileId} profileName={profile.displayName} revision={profile.revision} refreshToken={state?.revision} live={profile.connection === 'live'} nodes={nodes} onExport={onExport} />}
          {!profile && <><h2>操作历史</h2><p>此文件来源没有浏览器操作记录。请切换到 Chrome 资料查看历史。</p></>}
        </div>
        <div className="workspace-page" hidden={section !== 'semantic'}>
          {section === 'semantic' && profile && epochRef.current.epoch !== null && <SemanticWorkspace
            key={`semantic:${sourceKey}:${epochRef.current.epoch}:${sourceVisit}`}
            profileId={profile.profileId} profileName={profile.displayName} sourceEpoch={epochRef.current.epoch}
            revision={profile.revision} visit={sourceVisit} refreshVersion={state?.revision ?? 0}
            active={active && section === 'semantic'} nodes={nodes} selected={pickedBookmarks} folderId={folderId}
            onLibrary={onLibrary} onSettings={onSemanticSettings} onSelect={(chromeId) => {
              const node = activeIndex.nodes.get(chromeId);
              if (!node || node.kind !== 'bookmark') return false;
              leaveMetadata(() => {
                setFolderId(node.parentId ?? folderId); setQuery(''); setFilterTagId(null);
                selectBookmark(chromeId); onLibrary?.();
              }, [chromeId]);
              return true;
            }} />}
          {section === 'semantic' && (!profile || epochRef.current.epoch === null) && <><h2>本地语义检索</h2><p>{profile ? '正在确认此资料的缓存身份。完成后可选择索引范围。' : '请选择 Chrome 资料。只读文件来源不建立语义索引。'}</p><button type="button" onClick={onLibrary}>返回普通搜索</button></>}
        </div>
        <div className="workspace-page" hidden={section !== 'export'}>
          <div className="page-intro"><h2>备份与导出</h2><p>保存本地缓存，保留一份可检查的文件。</p></div>
          {section === 'export' && source && <ExportDesk source={{ kind: source.kind, id: source.id }} name={profile?.displayName ?? mirror?.displayName ?? '书签来源'} cachedAt={profile?.lastSyncedAt ?? mirror?.lastSyncedAt ?? null} />}
        </div>
        {section === 'library' && <div className="library-status"><span role="status">{selectionNotice || (pickedIds.length > 0 ? `已选 ${pickedIds.length} 项` : `${visible.length} 项`)}</span><span>按 Chrome 顺序 · 方向键浏览，Enter 打开</span></div>}
      </>}
    </section>
  </>;
}
