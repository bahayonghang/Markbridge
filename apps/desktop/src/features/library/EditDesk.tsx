import { useEffect, useState } from 'react';
import type { BookmarkNode, EditPreview, OperationList } from '@markbridge/protocol';
import {
  applyEdit, exportHtml, exportSidecar, listOperations, previewEdit, refreshOperations, reviewOperation,
  type EditAction,
} from '../../backend';

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

export function EditDesk({ profileId, revision, node, siblingIds, folderId, insertParentId, insertPosition, request }: {
  profileId: string;
  revision: number;
  node: BookmarkNode | null;
  siblingIds: string[];
  folderId: string | null;
  insertParentId: string | null;
  insertPosition: number;
  request: Request | null;
}) {
  const [title, setTitle] = useState(node?.title ?? '');
  const [url, setUrl] = useState(node?.url ?? '');
  const [seen, setSeen] = useState(node?.chromeId ?? '');
  const [phase, setPhase] = useState<'idle' | 'ready' | 'second' | 'blocked' | 'error'>('idle');
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [action, setAction] = useState<EditAction | null>(null);
  const [notice, setNotice] = useState('');
  const [watchId, setWatchId] = useState<string | null>(null);
  const [history, setHistory] = useState<OperationList['operations']>([]);
  const [historyError, setHistoryError] = useState(false);
  if ((node?.chromeId ?? '') !== seen) {
    setSeen(node?.chromeId ?? '');
    setTitle(node?.title ?? '');
    setUrl(node?.url ?? '');
    setPhase('idle');
    setPreview(null);
    setAction(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listOperations(profileId);
        if (!cancelled) { setHistory(list.operations); setHistoryError(false); }
      } catch { if (!cancelled) setHistoryError(true); }
    })();
    return () => { cancelled = true; };
  }, [profileId, revision, notice]);

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
    let cancelled = false;
    setWatchId(null);
    void previewEdit(profileId, revision, request.action).then(
      (next) => {
        if (cancelled) return;
        setAction(request.action);
        setPreview(next);
        setPhase(next.writable ? 'ready' : 'blocked');
        setNotice('');
      },
      () => { if (!cancelled) setPhase('error'); },
    );
    return () => { cancelled = true; };
  }, [request, profileId, revision]);

  async function requestPreview(next: EditAction) {
    setWatchId(null);
    setNotice('');
    try {
      const value = await previewEdit(profileId, revision, next);
      setAction(next);
      setPreview(value);
      setPhase(value.writable ? 'ready' : 'blocked');
    } catch { setPhase('error'); }
  }

  async function confirm(second: boolean) {
    if (!preview?.writable || !action) return;
    if (preview.requiresSecondConfirm && !second) { setPhase('second'); return; }
    try {
      const result = await applyEdit(profileId, preview.expectedRevision, action, preview.requiresSecondConfirm);
      setPhase('idle');
      setPreview(null);
      setAction(null);
      setNotice(noticeFor(result.state, result.errorCode));
      setWatchId(result.state === 'applying' || result.state === 'rolling_back' ? result.operationId : null);
    } catch { setPhase('error'); }
  }

  async function saveExport(kind: 'html' | 'sidecar') {
    try {
      const exported = kind === 'html' ? await exportHtml(profileId) : await exportSidecar(profileId);
      const blob = new Blob([exported.body], { type: 'text/plain;charset=utf-8' });
      const link = window.document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = kind === 'html' ? 'bookmarks.html' : 'bookmarks-sidecar.json';
      link.click();
      URL.revokeObjectURL(objectUrl);
      setNotice(kind === 'html' ? '已导出 HTML。' : '已导出侧车 JSON。');
    } catch { setNotice('导出失败。'); }
  }

  const moveTarget = folderId && node && folderId !== node.chromeId && node.parentId !== folderId;
  return (
    <div className="edit-desk">
      <h3>修改</h3>
      <p className="secondary">预览和草稿不会修改 Chrome。确认后才会写入。</p>
      {node && <>
        <label htmlFor="edit-title">新标题
          <input id="edit-title" value={title} maxLength={4096} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label htmlFor="edit-url">新网址
          <input id="edit-url" value={url} maxLength={16384} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <div className="edit-actions">
          <button type="button" onClick={() => void requestPreview({ kind: 'update', chromeId: node.chromeId, title, ...(node.kind === 'bookmark' ? { url } : {}) })}>预览修改</button>
          <button type="button" disabled={!insertParentId || !title.trim() || !url.trim()} onClick={() => { if (insertParentId) void requestPreview({ kind: 'create', parentId: insertParentId, position: insertPosition, title, url }); }}>预览新书签</button>
          <button type="button" disabled={!insertParentId || !title.trim()} onClick={() => { if (insertParentId) void requestPreview({ kind: 'create', parentId: insertParentId, position: insertPosition, title }); }}>预览新文件夹</button>
          <button type="button" onClick={() => void requestPreview({ kind: 'delete', chromeId: node.chromeId })}>预览删除</button>
          <button type="button" disabled={!shifted(node, siblingIds, -1)} onClick={() => { const next = shifted(node, siblingIds, -1); if (next) void requestPreview(next); }}>上移</button>
          <button type="button" disabled={!shifted(node, siblingIds, 1)} onClick={() => { const next = shifted(node, siblingIds, 1); if (next) void requestPreview(next); }}>下移</button>
          {moveTarget && <button type="button" onClick={() => void requestPreview({ kind: 'move', chromeId: node.chromeId, parentId: folderId, position: 0 })}>移到此文件夹</button>}
        </div>
      </>}
      {phase !== 'idle' && <div className="edit-dialog" role="dialog" aria-label="确认变更">
        <h4>{phase === 'second' ? '再次确认' : '变更差异'}</h4>
        {phase === 'error' && <p role="alert">无法读取预览。</p>}
        {preview?.errorCode && <p role="status">{preview.errorCode === 'PROTECTED_NODE' ? '该节点受保护。' : preview.errorCode === 'CONFLICT' ? '与当前书签冲突。确认后仍保留外部值。' : preview.errorCode}</p>}
        {preview?.changes.map((change, index) => <p className="edit-change" key={`${change.field}-${index}`}>{fields[change.field] ?? change.field}：{change.before ?? '无'} → {change.after ?? '无'}</p>)}
        {phase === 'second' && <p>这次变更影响 {preview?.affected ?? 0} 项。需要再次确认才会修改 Chrome。</p>}
        <div className="edit-actions">
          {phase === 'ready' && <button type="button" onClick={() => void confirm(false)}>{preview?.requiresSecondConfirm ? '继续确认' : '确认变更'}</button>}
          {phase === 'second' && <button type="button" onClick={() => void confirm(true)}>确认删除</button>}
          <button type="button" onClick={() => { setPhase('idle'); setPreview(null); setAction(null); }}>取消</button>
        </div>
      </div>}
      {notice && <p role="status">{notice}</p>}
      <div className="edit-actions">
        <button type="button" onClick={() => void saveExport('html')}>导出 HTML</button>
        <button type="button" onClick={() => void saveExport('sidecar')}>导出侧车 JSON</button>
        <button type="button" onClick={() => void refreshOperations(profileId).then((list) => setHistory(list.operations), () => setHistoryError(true))}>重新查询回执</button>
      </div>
      <div className="edit-history">
        <h4>操作记录</h4>
        {historyError && <p role="alert">无法读取操作记录。</p>}
        {history.length === 0 ? <p className="secondary">还没有操作记录。</p> : <ul>{history.map((item) => <li key={item.operationId}>
          <span>{item.operationId}</span>
          <span> {item.state}</span>
          {item.conflicts.length > 0 && <span> 冲突 {item.conflicts.length} 项</span>}
          <button type="button" onClick={() => void requestPreview({ kind: 'undo', operationId: item.operationId })}>撤销此记录</button>
          {(item.state === 'uncertain' || item.state === 'partial' || item.state === 'rollback_conflict') && <button type="button" onClick={() => void reviewOperation(profileId, item.operationId).then((list) => setHistory(list.operations), () => setHistoryError(true))}>标记已核对</button>}
        </li>)}</ul>}
      </div>
    </div>
  );
}
