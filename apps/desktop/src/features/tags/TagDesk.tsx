import { useEffect, useRef, useState } from 'react';
import type { TagCatalog, TitleEncodingPreview } from '@markbridge/protocol';
import {
  applyTitleEncoding, listOperations, previewTitleEncoding, readTagState, tagCommand, type TagCommand,
} from '../../backend';

function noticeFor(state: string, errorCode: string | null): string {
  if (errorCode === 'CONFLICT' || state === 'rollback_conflict') return '存在冲突，外部值保持不变。';
  if (state === 'uncertain') return '结果不确定，需要核对后才能继续修改。';
  if (state === 'applied' || state === 'rolled_back') return '回执已确认。';
  return '已发送，等待回执。发送成功还不是 Chrome 中的结果。';
}

function selectionNote(catalog: TagCatalog | null): { note: string; mixed: boolean } {
  const entries = catalog?.entries ?? [];
  if (entries.length === 0) return { note: '', mixed: false };
  const first = entries[0]?.note ?? '';
  const mixed = entries.some((entry) => entry.note !== first);
  return { note: mixed ? '' : first, mixed };
}

export function TagDesk({ profileId, revision, live, chromeIds, filterTagId, onFilter, onCatalog }: {
  profileId: string;
  revision: number;
  live: boolean;
  chromeIds: string[];
  filterTagId: string | null;
  onFilter: (tagId: string | null) => void;
  onCatalog: (catalog: TagCatalog) => void;
}) {
  const selectionKey = chromeIds.join('\n');
  const [catalog, setCatalog] = useState<TagCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [watchId, setWatchId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mixedNote, setMixedNote] = useState(false);
  const [seenNotes, setSeenNotes] = useState('');
  const [tagName, setTagName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [tagId, setTagId] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [preview, setPreview] = useState<TitleEncodingPreview | null>(null);
  const [previewRestore, setPreviewRestore] = useState(false);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  const [seenRevision, setSeenRevision] = useState(revision);
  const onCatalogRef = useRef(onCatalog);
  const chromeIdsRef = useRef(chromeIds);
  const previewGen = useRef(0);
  onCatalogRef.current = onCatalog;
  chromeIdsRef.current = chromeIds;
  const noteKey = catalog?.entries.map((entry) => `${entry.chromeId}\t${entry.note}`).join('\n') ?? '';
  if (noteKey !== seenNotes) {
    const shared = selectionNote(catalog);
    setSeenNotes(noteKey);
    setNote(shared.note);
    setMixedNote(shared.mixed);
  }
  if (seenSelection !== selectionKey || seenRevision !== revision) {
    setSeenSelection(selectionKey);
    setSeenRevision(revision);
    setPreview(null);
    previewGen.current += 1;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await readTagState(profileId, chromeIdsRef.current, filterTagId);
        if (cancelled) return;
        setCatalog(next);
        setFailed(false);
        onCatalogRef.current(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, revision, selectionKey, filterTagId]);

  useEffect(() => {
    if (!watchId) return undefined;
    let cancelled = false;
    const pull = () => {
      void listOperations(profileId).then((list) => {
        if (cancelled) return;
        const item = list.operations.find((row) => row.operationId === watchId);
        if (!item || item.state === 'applying' || item.state === 'rolling_back' || item.state === 'planned') return;
        setWatchId(null);
        setNotice(noticeFor(item.state, item.errorCode));
      }, () => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchId, profileId]);

  async function publish(next: TagCatalog) {
    if (!filterTagId) {
      setCatalog(next);
      onCatalogRef.current(next);
      return;
    }
    const filtered = await readTagState(profileId, chromeIds, filterTagId);
    const merged = { ...next, matches: filtered.matches, filterTagId: filtered.filterTagId };
    setCatalog(merged);
    onCatalogRef.current(merged);
  }

  async function run(command: TagCommand) {
    previewGen.current += 1;
    setPreview(null);
    setWatchId(null);
    setFailed(false);
    try {
      const next = await tagCommand(profileId, command);
      await publish(next);
      if (command.kind === 'set_encoding') {
        setNotice(command.enabled ? '已启用标题编码。写入前会显示完整差异。' : '已关闭标题编码。Chrome 标题未改。');
      } else if (next.mergeRequired) {
        setNotice('这两个标签规范化后相同。确认合并后，关联会转到目标标签。');
      } else {
        setNotice(`已更新 ${next.affected} 项。`);
      }
    } catch {
      setFailed(true);
    }
  }

  async function requestPreview(restore: boolean) {
    const generation = ++previewGen.current;
    setWatchId(null);
    setFailed(false);
    setPreview(null);
    try {
      const next = await previewTitleEncoding(profileId, revision, chromeIds, restore);
      if (generation !== previewGen.current) return;
      setPreview(next);
      setPreviewRestore(restore);
      setNotice('');
    } catch {
      if (generation === previewGen.current) setFailed(true);
    }
  }

  async function confirmPreview() {
    if (!preview || !live || !preview.writable || preview.changes.length === 0) return;
    if (!previewRestore && !catalog?.encodingEnabled) return;
    const expectedRevision = preview.expectedRevision;
    const restore = previewRestore;
    const ids = [...chromeIds];
    previewGen.current += 1;
    setPreview(null);
    setFailed(false);
    try {
      const result = await applyTitleEncoding(profileId, expectedRevision, ids, restore);
      setNotice(noticeFor(result.state, result.errorCode));
      setWatchId(result.state === 'applying' || result.state === 'rolling_back' ? result.operationId : null);
      const next = await readTagState(profileId, chromeIdsRef.current, filterTagId);
      setCatalog(next);
      onCatalogRef.current(next);
    } catch {
      setFailed(true);
    }
  }

  const tags = catalog?.tags ?? [];
  const chosen = tagId || tags[0]?.tagId || '';
  const linked = new Set((catalog?.entries ?? []).flatMap((entry) => entry.tagIds));
  const linkedTags = tags.filter((tag) => linked.has(tag.tagId));
  const canEditSelection = chromeIds.length > 0;
  const canConfirm = !!preview && live && preview.writable && preview.changes.length > 0 && (previewRestore || !!catalog?.encodingEnabled);
  const conflicted = (catalog?.entries ?? []).some((entry) => entry.conflict);
  const pendingMerge = catalog?.mergeRequired && catalog.sourceTagId && catalog.targetTagId
    ? { sourceId: catalog.sourceTagId, targetId: catalog.targetTagId, affected: catalog.affected }
    : null;

  return (
    <div className="tag-desk">
      <h3>本地标签</h3>
      <p className="secondary">标签和备注只写入本机。Chrome 标题和网址保持不变。</p>
      {failed && <p role="alert">无法保存本地标签。</p>}
      {!live && <p className="secondary">标题编码需要实时连接。当前不会写入 Chrome。</p>}
      <p className="secondary">{chromeIds.length > 0 ? `已选 ${chromeIds.length} 项。` : '勾选书签后可以一起添加标签。'}</p>
      <label htmlFor="tag-filter">按标签筛选
        <select id="tag-filter" value={filterTagId ?? ''} onChange={(event) => onFilter(event.target.value || null)}>
          <option value="">全部书签</option>
          {tags.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
        </select>
      </label>
      <label htmlFor="tag-note">备注
        <textarea id="tag-note" value={note} maxLength={4096} onChange={(event) => setNote(event.target.value)} />
      </label>
      {mixedNote && <p className="secondary">所选书签的备注不同。</p>}
      <div className="edit-actions">
        <button type="button" disabled={!canEditSelection} onClick={() => void run({ kind: 'set_note', chromeIds, note })}>保存备注</button>
      </div>
      <label htmlFor="tag-name">添加标签
        <input id="tag-name" value={tagName} maxLength={32} onChange={(event) => setTagName(event.target.value)} />
      </label>
      <div className="edit-actions">
        <button type="button" disabled={!canEditSelection || !tagName.trim()} onClick={() => void run({ kind: 'add', chromeIds, name: tagName })}>添加标签</button>
      </div>
      {linkedTags.length > 0 && <ul aria-label="当前标签">
        {linkedTags.map((tag) => <li key={tag.tagId}>{tag.name} <button type="button" onClick={() => void run({ kind: 'remove', chromeIds, tagId: tag.tagId })}>移除</button></li>)}
      </ul>}
      {tags.length > 0 && <>
        <label htmlFor="tag-pick">标签
          <select id="tag-pick" value={chosen} onChange={(event) => setTagId(event.target.value)}>
            {tags.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
          </select>
        </label>
        <label htmlFor="tag-rename">重命名
          <input id="tag-rename" value={renameName} maxLength={32} onChange={(event) => setRenameName(event.target.value)} />
        </label>
        <label htmlFor="tag-merge">合并到
          <select id="tag-merge" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            <option value="">选择目标</option>
            {tags.filter((tag) => tag.tagId !== chosen).map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
          </select>
        </label>
        <div className="edit-actions">
          <button type="button" disabled={!chosen || !renameName.trim()} onClick={() => void run({ kind: 'rename', tagId: chosen, name: renameName })}>重命名</button>
          <button type="button" disabled={!chosen || !mergeTarget} onClick={() => void run({ kind: 'merge', sourceId: chosen, targetId: mergeTarget })}>合并</button>
          <button type="button" disabled={!chosen} onClick={() => void run({ kind: 'delete', tagId: chosen })}>删除标签</button>
        </div>
      </>}
      {pendingMerge && <div className="edit-dialog" role="dialog" aria-label="确认合并">
        <p>这两个标签规范化后相同。确认合并后，关联会转到目标标签。影响 {pendingMerge.affected} 项。</p>
        <button type="button" onClick={() => void run({ kind: 'merge', sourceId: pendingMerge.sourceId, targetId: pendingMerge.targetId })}>确认合并</button>
      </div>}
      <div className="edit-actions">
        <button type="button" disabled={!catalog?.journalId} onClick={() => { if (catalog?.journalId) void run({ kind: 'undo', journalId: catalog.journalId }); }}>撤销上次标签变更</button>
      </div>
      <label htmlFor="title-encoding">
        <input id="title-encoding" type="checkbox" checked={!!catalog?.encodingEnabled} onChange={(event) => void run({ kind: 'set_encoding', enabled: event.target.checked })} />
        启用标题编码
      </label>
      <p className="secondary">关闭编码不会改写 Chrome 标题。</p>
      {conflicted && <p role="status">外部标题已改变，这一条不会写入。</p>}
      <div className="edit-actions">
        <button type="button" disabled={!canEditSelection || !catalog?.encodingEnabled} onClick={() => void requestPreview(false)}>预览标题差异</button>
        <button type="button" disabled={!canEditSelection} onClick={() => void requestPreview(true)}>预览恢复原标题</button>
      </div>
      {preview && <div className="edit-dialog" role="dialog" aria-label="标题差异">
        <h4>{previewRestore ? '恢复原标题' : '标题差异'}</h4>
        {preview.errorCode && <p role="status">{preview.errorCode}</p>}
        {preview.changes.length === 0 && <p>没有需要写入的标题。</p>}
        {preview.changes.map((change, index) => <p className="edit-change" key={`${change.before ?? ''}-${change.after ?? ''}-${index}`}>{change.before ?? '无'} → {change.after ?? '无'}</p>)}
        {preview.conflicts.map((conflict) => <p role="status" key={conflict.chromeId}>外部标题已改变，这一条不会写入。{conflict.chromeId}</p>)}
        <div className="edit-actions">
          {canConfirm && <button type="button" onClick={() => void confirmPreview()}>{previewRestore ? '确认恢复原标题' : '确认写入标题'}</button>}
          <button type="button" onClick={() => setPreview(null)}>取消</button>
        </div>
      </div>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
