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

type TagDeskProps = {
  profileId: string;
  revision: number;
  live: boolean;
  chromeIds: string[];
  filterTagId: string | null;
  onFilter: (tagId: string | null) => void;
  onCatalog: (catalog: TagCatalog) => void;
  onChanged?: () => void;
  refreshVersion?: number;
  onDirtyChange?: (dirty: boolean) => void;
  resetDraft?: number;
  sourceEpoch: number | null;
  onDiscardDraft?: () => void;
};

export function TagDesk(props: TagDeskProps) {
  return <TagEditor key={`${props.profileId}:${props.chromeIds.join(',')}:${props.resetDraft ?? 0}`} {...props} />;
}

function TagEditor({ profileId, revision, live, chromeIds, filterTagId, onFilter, onCatalog, onChanged, onDirtyChange, sourceEpoch, onDiscardDraft, refreshVersion = 0 }: TagDeskProps) {
  const selectionKey = chromeIds.join('\n');
  const [catalog, setCatalog] = useState<TagCatalog | null>(null);
  const [loadedEpoch, setLoadedEpoch] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [identityConflict, setIdentityConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [watchId, setWatchId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mixedNote, setMixedNote] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const noteDirtyRef = useRef(false);
  const noteRef = useRef('');
  const tagNameRef = useRef('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const readGeneration = useRef(0);
  const [tagName, setTagName] = useState('');
  const [renameName, setRenameName] = useState('');
  const renameNameRef = useRef('');
  const [tagId, setTagId] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [preview, setPreview] = useState<TitleEncodingPreview | null>(null);
  const [previewRestore, setPreviewRestore] = useState(false);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  const [seenRevision, setSeenRevision] = useState(revision);
  const onCatalogRef = useRef(onCatalog);
  const onChangedRef = useRef(onChanged);
  const onDirtyRef = useRef(onDirtyChange);
  const chromeIdsRef = useRef(chromeIds);
  const previewGen = useRef(0);
  const currentEpoch = useRef(sourceEpoch);
  currentEpoch.current = sourceEpoch;
  const draftEpoch = useRef(sourceEpoch);
  const dirty = noteDirty || !!tagName.trim() || !!renameName.trim();
  if (!dirty || draftEpoch.current == null) draftEpoch.current = sourceEpoch;
  const expectedEpoch = draftEpoch.current;
  const staleEpoch = identityConflict || (expectedEpoch != null && sourceEpoch != null && expectedEpoch !== sourceEpoch);
  const [seenRefresh, setSeenRefresh] = useState(refreshVersion);
  if (seenRefresh !== refreshVersion) { setSeenRefresh(refreshVersion); setPreview(null); previewGen.current += 1; }
  const [seenEpoch, setSeenEpoch] = useState(sourceEpoch);
  if (seenEpoch !== sourceEpoch) { setSeenEpoch(sourceEpoch); setPreview(null); previewGen.current += 1; }
  onCatalogRef.current = onCatalog;
  onChangedRef.current = onChanged;
  onDirtyRef.current = onDirtyChange;
  chromeIdsRef.current = chromeIds;
  noteRef.current = note;
  tagNameRef.current = tagName;
  renameNameRef.current = renameName;
  useEffect(() => { onDirtyRef.current?.(noteDirty || !!tagName.trim() || !!renameName.trim()); }, [noteDirty, tagName, renameName]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; previewGen.current += 1; onDirtyRef.current?.(false); }; }, []);
  if (seenSelection !== selectionKey || seenRevision !== revision) {
    setSeenSelection(selectionKey);
    setSeenRevision(revision);
    setPreview(null);
    previewGen.current += 1;
  }

  useEffect(() => {
    let cancelled = false;
    const generation = ++readGeneration.current;
    if (expectedEpoch === null) return;
    void (async () => {
      try {
        const next = await readTagState(profileId, chromeIdsRef.current, filterTagId, expectedEpoch ?? undefined);
        if (cancelled || readGeneration.current !== generation) return;
        setCatalog(next);
        setLoadedEpoch(expectedEpoch);
        if (!noteDirtyRef.current) {
          const shared = selectionNote(next);
          setNote(shared.note); setMixedNote(shared.mixed);
        }
        setFailed(false);
        onCatalogRef.current(next);
      } catch (error) {
        if (!cancelled && readGeneration.current === generation) {
          if (error === 'CONFLICT') setIdentityConflict(true);
          else setFailed(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, revision, selectionKey, filterTagId, refreshVersion, reload, expectedEpoch, sourceEpoch]);

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
    if (!alive.current || currentEpoch.current !== expectedEpoch) return;
    if (!filterTagId) {
      setCatalog(next);
      onCatalogRef.current(next);
      return;
    }
    const filtered = await readTagState(profileId, chromeIds, filterTagId, expectedEpoch ?? undefined);
    if (!alive.current || currentEpoch.current !== expectedEpoch) return;
    const merged = { ...next, matches: filtered.matches, filterTagId: filtered.filterTagId };
    setCatalog(merged);
    onCatalogRef.current(merged);
  }

  async function run(command: TagCommand) {
    if (busyRef.current || staleEpoch || sourceEpoch === null || expectedEpoch === null || loadedEpoch !== expectedEpoch) return;
    busyRef.current = true; setBusy(true);
    const changed = onChangedRef.current;
    const submittedName = tagNameRef.current;
    readGeneration.current += 1;
    previewGen.current += 1;
    setPreview(null);
    setWatchId(null);
    setFailed(false);
    try {
      const next = await tagCommand(profileId, command, expectedEpoch);
      changed?.();
      if (!alive.current || currentEpoch.current !== expectedEpoch) return;
      await publish(next);
      if (!alive.current || currentEpoch.current !== expectedEpoch) return;
      if (command.kind === 'set_note' && noteRef.current === command.note) {
        noteDirtyRef.current = false; setNoteDirty(false); setMixedNote(false);
      } else if (command.kind === 'undo' && !noteDirtyRef.current) {
        const shared = selectionNote(next); setNote(shared.note); setMixedNote(shared.mixed);
      }
      if (command.kind === 'add' && tagNameRef.current === submittedName) setTagName('');
      if (command.kind === 'rename' && renameNameRef.current === command.name) setRenameName('');
      if (command.kind === 'set_encoding') {
        setNotice(command.enabled ? '已启用标题编码。写入前会显示完整差异。' : '已关闭标题编码。Chrome 标题未改。');
      } else if (next.mergeRequired) {
        setNotice('这两个标签规范化后相同。确认合并后，关联会转到目标标签。');
      } else {
        setNotice(`已更新 ${next.affected} 项。`);
      }
    } catch (error) {
      if (alive.current) {
        if (error === 'CONFLICT') setIdentityConflict(true);
        else setFailed(true);
      }
    } finally {
      if (alive.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function requestPreview(restore: boolean) {
    if (busyRef.current || staleEpoch || expectedEpoch === null || loadedEpoch !== expectedEpoch) return;
    const generation = ++previewGen.current;
    setWatchId(null);
    setFailed(false);
    setPreview(null);
    try {
      const next = await previewTitleEncoding(profileId, revision, chromeIds, restore, expectedEpoch);
      if (generation !== previewGen.current) return;
      setPreview(next);
      setPreviewRestore(restore);
      setNotice('');
    } catch (error) {
      if (generation === previewGen.current) {
        if (error === 'CONFLICT') setIdentityConflict(true);
        else setFailed(true);
      }
    }
  }

  async function confirmPreview() {
    if (busyRef.current || staleEpoch || expectedEpoch === null || loadedEpoch !== expectedEpoch || !preview || !live || !preview.writable || preview.changes.length === 0) return;
    if (!previewRestore && !catalog?.encodingEnabled) return;
    const expectedRevision = preview.expectedRevision;
    const restore = previewRestore;
    const ids = [...chromeIds];
    busyRef.current = true; setBusy(true);
    previewGen.current += 1;
    setPreview(null);
    setFailed(false);
    try {
      const result = await applyTitleEncoding(profileId, expectedRevision, ids, restore, expectedEpoch);
      if (!alive.current || currentEpoch.current !== expectedEpoch) return;
      setNotice(noticeFor(result.state, result.errorCode));
      setWatchId(result.state === 'applying' || result.state === 'rolling_back' ? result.operationId : null);
      const next = await readTagState(profileId, chromeIdsRef.current, filterTagId, expectedEpoch ?? undefined);
      if (!alive.current || currentEpoch.current !== expectedEpoch) return;
      setCatalog(next);
      onCatalogRef.current(next);
    } catch (error) {
      if (alive.current) {
        if (error === 'CONFLICT') setIdentityConflict(true);
        else setFailed(true);
      }
    } finally {
      if (alive.current) { busyRef.current = false; setBusy(false); }
    }
  }

  const tags = catalog?.tags ?? [];
  const chosen = tagId || tags[0]?.tagId || '';
  const linked = new Set((catalog?.entries ?? []).flatMap((entry) => entry.tagIds));
  const linkedTags = tags.filter((tag) => linked.has(tag.tagId));
  const canEditDraft = !staleEpoch && sourceEpoch !== null && loadedEpoch === expectedEpoch;
  const canMutate = !busy && canEditDraft;
  const canEditSelection = chromeIds.length > 0 && canMutate;
  const canConfirm = canMutate && !!preview && live && preview.writable && preview.changes.length > 0 && (previewRestore || !!catalog?.encodingEnabled);
  const conflicted = (catalog?.entries ?? []).some((entry) => entry.conflict);
  const pendingMerge = catalog?.mergeRequired && catalog.sourceTagId && catalog.targetTagId
    ? { sourceId: catalog.sourceTagId, targetId: catalog.targetTagId, affected: catalog.affected }
    : null;

  return (
    <div className="tag-desk" aria-busy={busy}>
      <p className="secondary metadata-note">标签和备注只写入本机。Chrome 标题和网址保持不变。{!live ? '离线也可保存。' : ''}</p>
      {failed && <p role="alert">无法读取或保存本地内容。<button type="button" onClick={() => setReload((value) => value + 1)}>重新读取本地内容</button></p>}
      {staleEpoch && <p role="alert">书签身份已变化，旧草稿不能写入新书签。未保存输入仍保留，请复制需要的内容。{onDiscardDraft && <button type="button" onClick={onDiscardDraft}>放弃旧身份草稿</button>}</p>}
      {chromeIds.length === 0 && <p className="secondary">选择书签后可以添加标签。</p>}
      <label htmlFor="tag-note">备注</label>
      <textarea id="tag-note" readOnly={!canEditDraft} value={note} maxLength={4096} onChange={(event) => { noteDirtyRef.current = true; setNoteDirty(true); setNote(event.target.value); }} />
      {mixedNote && <p className="secondary">所选书签的备注不同。</p>}
      {noteDirty && <p className="draft-notice" role="status">备注尚未保存</p>}
      <div className="edit-actions">
        <button type="button" disabled={!canEditSelection} onClick={() => void run({ kind: 'set_note', chromeIds, note })}>保存备注</button>
      </div>
      <label htmlFor="tag-name">添加标签
        <input id="tag-name" readOnly={!canEditDraft} value={tagName} maxLength={32} onChange={(event) => setTagName(event.target.value)} />
      </label>
      <div className="edit-actions">
        <button type="button" disabled={!canEditSelection || !tagName.trim()} onClick={() => void run({ kind: 'add', chromeIds, name: tagName })}>添加标签</button>
      </div>
      {linkedTags.length > 0 && <ul className="local-tags" aria-label="当前标签">
        {linkedTags.map((tag) => <li key={tag.tagId}><span>{tag.name}{chromeIds.length > 1 ? ` · ${catalog?.entries.filter((entry) => entry.tagIds.includes(tag.tagId)).length}/${chromeIds.length}` : ''}</span><button type="button" disabled={!canEditSelection} onClick={() => void run({ kind: 'remove', chromeIds, tagId: tag.tagId })}>移除</button></li>)}
      </ul>}
      {tags.length > 0 && <details className="detail-disclosure"><summary>管理标签</summary>
      <label htmlFor="tag-filter">按标签筛选
        <select id="tag-filter" value={filterTagId ?? ''} onChange={(event) => onFilter(event.target.value || null)}>
          <option value="">全部书签</option>
          {tags.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
        </select>
      </label>

        <label htmlFor="tag-pick">标签
          <select id="tag-pick" value={chosen} onChange={(event) => setTagId(event.target.value)}>
            {tags.map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
          </select>
        </label>
        <label htmlFor="tag-rename">重命名
          <input id="tag-rename" readOnly={!canEditDraft} value={renameName} maxLength={32} onChange={(event) => setRenameName(event.target.value)} />
        </label>
        <label htmlFor="tag-merge">合并到
          <select id="tag-merge" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            <option value="">选择目标</option>
            {tags.filter((tag) => tag.tagId !== chosen).map((tag) => <option key={tag.tagId} value={tag.tagId}>{tag.name}</option>)}
          </select>
        </label>
        <div className="edit-actions">
          <button type="button" disabled={!canMutate || !chosen || !renameName.trim()} onClick={() => void run({ kind: 'rename', tagId: chosen, name: renameName })}>重命名</button>
          <button type="button" disabled={!canMutate || !chosen || !mergeTarget} onClick={() => void run({ kind: 'merge', sourceId: chosen, targetId: mergeTarget })}>合并</button>
          <button type="button" disabled={!canMutate || !chosen} onClick={() => void run({ kind: 'delete', tagId: chosen })}>删除标签</button>
        </div>
      </details>}
      {pendingMerge && <div className="edit-dialog" role="dialog" aria-label="确认合并">
        <p>这两个标签规范化后相同。确认合并后，关联会转到目标标签。影响 {pendingMerge.affected} 项。</p>
        <button type="button" disabled={!canMutate} onClick={() => void run({ kind: 'merge', sourceId: pendingMerge.sourceId, targetId: pendingMerge.targetId })}>确认合并</button>
      </div>}
      <div className="edit-actions">
        <button type="button" disabled={!canMutate || !catalog?.journalId} onClick={() => { if (catalog?.journalId) void run({ kind: 'undo', journalId: catalog.journalId }); }}>撤销上次标签变更</button>
      </div>
      <details className="detail-disclosure"><summary>可选：将标签写入标题</summary>
      <label htmlFor="title-encoding">
        <input id="title-encoding" type="checkbox" disabled={!canMutate} checked={!!catalog?.encodingEnabled} onChange={(event) => void run({ kind: 'set_encoding', enabled: event.target.checked })} />
        启用标题编码
      </label>
      <p className="secondary">关闭编码不会改写 Chrome 标题。</p>
      {!live && <p className="secondary">标题编码需要实时连接。当前不会写入 Chrome。</p>}
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
          {canConfirm && <button type="button" disabled={busy} onClick={() => void confirmPreview()}>{previewRestore ? '确认恢复原标题' : '确认写入标题'}</button>}
          <button type="button" onClick={() => setPreview(null)}>取消</button>
        </div>
      </div>}
      </details>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
