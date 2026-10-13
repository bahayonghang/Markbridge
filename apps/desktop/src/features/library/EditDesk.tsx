import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode, EditPreview } from '@markbridge/protocol';
import {
  applyEdit, listOperations, previewEdit,
  type EditAction,
} from '../../backend';

import { FolderPicker, writableFolder } from './FolderPicker';

type Request = { id: number; action: EditAction };

const fields: Record<string, string> = {
  title: '标题', url: '网址', parent: '父级', position: '位置', order: '顺序', existence: '存在',
};

function shifted(node: BookmarkNode, siblingIds: string[], delta: number): EditAction | null {
  if (!node.parentId) return null;
  const index = siblingIds.indexOf(node.chromeId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= siblingIds.length) return null;
  const childIds = siblingIds.slice();
  const [item] = childIds.splice(index, 1);
  childIds.splice(next, 0, item!);
  return { kind: 'reorder', parentId: node.parentId, childIds };
}

function noticeFor(state: string, errorCode: string | null): string {
  if (errorCode === 'CONFLICT' || state === 'rollback_conflict') return '存在冲突，外部值保持不变。';
  if (state === 'uncertain') return '结果不确定，需要核对后才能继续修改。';
  if (state === 'applied' || state === 'rolled_back') return '回执已确认。';
  return '已发送，等待回执。发送成功还不是 Chrome 中的结果。';
}

export function EditDesk({ profileId, revision, node, siblingIds, folderId, insertParentId, insertPosition, request, nodes = [], creating = false, profileName, mode = 'edit', live = true }: {
  profileId: string;
  revision: number;
  node: BookmarkNode | null;
  siblingIds: string[];
  folderId: string | null;
  insertParentId: string | null;
  insertPosition: number;
  request: Request | null;
  nodes?: BookmarkNode[];
  creating?: boolean;
  profileName?: string;
  mode?: 'edit';
  live?: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, { title: string; url: string }>>({});
  const [createKind, setCreateKind] = useState<'bookmark' | 'folder'>('bookmark');
  const [createDrafts, setCreateDrafts] = useState({ bookmark: { title: '', url: '' }, folder: { title: '', url: '' } });
  const [target, setTarget] = useState<string | null>(insertParentId);
  const [moving, setMoving] = useState(false);
  const create = creating || !node;
  const draftKey = `${profileId}:${node?.chromeId ?? ''}`;
  const draft = create ? createDrafts[createKind] : drafts[draftKey] ?? { title: node?.title ?? '', url: node?.url ?? '' };
  const { title, url } = draft;
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'second' | 'blocked' | 'error'>('idle');
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [action, setAction] = useState<EditAction | null>(null);
  const [notice, setNotice] = useState('');
  const [watchId, setWatchId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const applyLock = useRef(false);
  const generation = useRef(0);
  const draftGeneration = useRef(0);
  const identity = useRef('');
  const identityGeneration = useRef(0);
  const identityKey = `${profileId}:${node?.chromeId ?? ''}:${creating}`;
  if (identity.current !== identityKey) { identity.current = identityKey; identityGeneration.current += 1; }
  const context = `${profileId}:${node?.chromeId ?? ''}:${revision}:${creating}`;
  const current = useRef(context);
  if (current.current !== context) {
    current.current = context;
    generation.current += 1;
    setPreview(null); setAction(null); setPhase('idle');
    if (preview || phase === 'loading') setNotice('资料或选择已改变。草稿已保留，请重新预览。');
  }
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => { setTarget(insertParentId); }, [insertParentId]);
  function cancelPreview() { if (applyLock.current) return; generation.current += 1; setPhase('idle'); setPreview(null); setAction(null); }
  function changeDraft(field: 'title' | 'url', value: string) {
    draftGeneration.current += 1;
    cancelPreview();
    if (create) setCreateDrafts((all) => ({ ...all, [createKind]: { ...all[createKind], [field]: value } }));
    else setDrafts((all) => ({ ...all, [draftKey]: { ...draft, [field]: value } }));
  }

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

  useEffect(() => {
    if (!request) return;
    void requestPreview(request.action);
    // A gesture creates one review. Revision changes invalidate it instead of silently re-reviewing.
  }, [request]);

  async function requestPreview(next: EditAction) {
    const expected = current.current;
    const gen = ++generation.current;
    setWatchId(null); setNotice(''); setPreview(null); setAction(null); setPhase('loading');
    try {
      const value = await previewEdit(profileId, revision, next);
      if (current.current !== expected || generation.current !== gen || value.profileId !== profileId || value.expectedRevision !== revision) return;
      setAction(next); setPreview(value); setPhase(value.writable ? 'ready' : 'blocked');
    } catch { if (current.current === expected && generation.current === gen) setPhase('error'); }
  }

  async function confirm(second: boolean) {
    if (applyLock.current || !live || !preview?.writable || !action || preview.expectedRevision !== revision) return;
    if (preview.requiresSecondConfirm && !second) { setPhase('second'); return; }
    applyLock.current = true; setApplying(true);
    const expected = identityGeneration.current;
    const gen = draftGeneration.current;
    try {
      const result = await applyEdit(profileId, preview.expectedRevision, action, preview.requiresSecondConfirm);
      if (identityGeneration.current !== expected || draftGeneration.current !== gen) return;
      setPhase('idle'); setPreview(null); setAction(null);
      setNotice(noticeFor(result.state, result.errorCode));
      setWatchId(result.state === 'applying' || result.state === 'rolling_back' ? result.operationId : null);
    } catch (error) { if (identityGeneration.current === expected && draftGeneration.current === gen) { setPhase('error'); setPreview(null); setAction(null); setNotice(error === 'FRAME_TOO_LARGE' || error === 'LIMIT_EXCEEDED' ? '范围过大，无法保存完整撤销信息，请缩小选择范围。没有开始浏览器写入。' : '变更未获确认。草稿已保留，请重新预览。'); } }
    finally { applyLock.current = false; setApplying(false); }
  }

  const chosenTarget = target ?? folderId;
  const targetWritable = nodes.length > 0 ? writableFolder(nodes, chosenTarget) : !!chosenTarget;
  const position = nodes.length > 0 ? nodes.filter((item) => item.parentId === chosenTarget).length : insertPosition;
  return (
    <div className="edit-desk" onKeyDown={(event) => { if (event.key === 'Escape' && phase !== 'idle') { event.stopPropagation(); cancelPreview(); } }}>
      {mode === 'edit' && <>
        <h3>{create ? '新建' : '修改'}</h3><p className="secondary">预览和草稿不会修改 Chrome。确认后才会写入。</p>
        {create && <div className="edit-actions" aria-label="新建类型">
          <button type="button" aria-pressed={createKind === 'bookmark'} onClick={() => { cancelPreview(); setCreateKind('bookmark'); }}>书签</button>
          <button type="button" aria-pressed={createKind === 'folder'} onClick={() => { cancelPreview(); setCreateKind('folder'); }}>文件夹</button>
        </div>}
        {(node || insertParentId || nodes.length > 0) && <>
          <label htmlFor="edit-title">{create ? '名称' : '新标题'}<input id="edit-title" value={title} maxLength={4096} onChange={(event) => changeDraft('title', event.target.value)} /></label>
          {(create ? createKind === 'bookmark' : node?.kind === 'bookmark') && <label htmlFor="edit-url">{create ? '网址' : '新网址'}<input id="edit-url" value={url} maxLength={16384} onChange={(event) => changeDraft('url', event.target.value)} /></label>}
          {(create || moving) && <FolderPicker nodes={nodes} value={chosenTarget} excluded={create || !node ? [] : [node.chromeId]} onChange={(id) => { cancelPreview(); setTarget(id); }} />}
          {create && !targetWritable && <p role="status">请选择可写的目标文件夹。</p>}
          <div className="edit-actions">
            {create ? <button type="button" disabled={!live || !targetWritable || !title.trim() || (createKind === 'bookmark' && !url.trim()) || applying} onClick={() => { if (chosenTarget) void requestPreview({ kind: 'create', parentId: chosenTarget, position, title, ...(createKind === 'bookmark' ? { url } : {}) }); }}>{createKind === 'bookmark' ? '预览新书签' : '预览新文件夹'}</button> : node && <>
              <button type="button" disabled={!live || applying} onClick={() => void requestPreview({ kind: 'update', chromeId: node.chromeId, title, ...(node.kind === 'bookmark' ? { url } : {}) })}>预览修改</button>
              <button type="button" disabled={!live || applying} onClick={() => { cancelPreview(); setMoving((value) => !value); }}>移动</button>
              {moving && <button type="button" disabled={!live || !targetWritable || chosenTarget === node.parentId || applying} onClick={() => { if (chosenTarget) void requestPreview({ kind: 'move', chromeId: node.chromeId, parentId: chosenTarget, position }); }}>预览移动</button>}
              <button type="button" disabled={!live || applying} onClick={() => void requestPreview({ kind: 'delete', chromeId: node.chromeId })}>预览删除</button>
              <button type="button" disabled={!live || applying || !shifted(node, siblingIds, -1)} onClick={() => { const next = shifted(node, siblingIds, -1); if (next) void requestPreview(next); }}>上移</button>
              <button type="button" disabled={!live || applying || !shifted(node, siblingIds, 1)} onClick={() => { const next = shifted(node, siblingIds, 1); if (next) void requestPreview(next); }}>下移</button>
            </>}
          </div>
        </>}
      </>}
      {phase !== 'idle' && <div className="edit-dialog" role="dialog" aria-label="确认变更">
        <p>资料：{profileName ?? profileId} · 影响 {preview?.affected ?? 0} 项</p>
        {phase === 'loading' && <p role="status">正在读取预览。</p>}
        <h4>{phase === 'second' ? '再次确认' : '变更差异'}</h4>
        {phase === 'error' && <p role="alert">无法读取预览。</p>}
        {preview?.errorCode && <p role="status">{preview.errorCode === 'LIMIT_EXCEEDED' ? '单次删除最多 1000 项，包含子文件夹的全部条目，请缩小选择范围。' : preview.errorCode === 'FRAME_TOO_LARGE' ? '范围过大，无法保存完整撤销信息，请缩小选择范围。' : preview.errorCode === 'PROTECTED_NODE' ? '该节点受保护。' : preview.errorCode === 'CONFLICT' ? '与当前书签冲突。确认后仍保留外部值。' : preview.errorCode}</p>}
        {preview?.changes.map((change, index) => <p className="edit-change" key={`${change.field}-${index}`}>{fields[change.field] ?? change.field}：{change.before ?? '无'} → {change.after ?? '无'}</p>)}
        {phase === 'second' && <p>这次变更影响 {preview?.affected ?? 0} 项。需要再次确认才会修改 Chrome。</p>}
        <div className="edit-actions">
          {phase === 'ready' && <button disabled={!live || applying} type="button" onClick={() => void confirm(false)}>{preview?.requiresSecondConfirm ? '继续确认' : '确认变更'}</button>}
          {phase === 'second' && <button disabled={!live || applying} type="button" onClick={() => void confirm(true)}>确认删除</button>}
          <button type="button" disabled={applying} onClick={cancelPreview}>取消</button>
        </div>
      </div>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
