import { useEffect, useRef, useState } from 'react';
import type { BatchEditPreview, BatchEditStatus, BookmarkNode } from '@markbridge/protocol';
import { applyBatchEdit, previewBatchEdit, type BatchEditAction } from '../../backend';
import { FolderPicker, writableFolder } from './FolderPicker';
import { BatchReceipt } from './BatchReceipt';

export type BatchRequest = { id: number; kind: 'move' | 'delete'; chromeIds: string[] };

export function BatchEditDesk({ profileId, profileName, revision, live, nodes, request }: {
  profileId: string; profileName: string; revision: number; live: boolean; nodes: BookmarkNode[]; request: BatchRequest;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchEditPreview | null>(null);
  const [result, setResult] = useState<BatchEditStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [second, setSecond] = useState(false);
  const [applying, setApplying] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const requestIdentity = useRef(request.id);
  requestIdentity.current = request.id;
  const context = `${profileId}:${revision}:${request.id}:${live}`;
  const current = useRef(context);
  if (current.current !== context) {
    current.current = context; generation.current += 1;
    setPreview(null); setSecond(false); setBusy(false);
    if (!result) setNotice('资料或选择已改变，请重新审查。');
  }
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    setResult(null); setNotice(''); setPreview(null);
    if (request.kind === 'delete') void review({ kind: 'delete' });
    // A selection gesture is the only automatic review trigger.
  }, [request]);

  function cancelReview() { if (lock.current) return; generation.current += 1; setPreview(null); setSecond(false); setBusy(false); setNotice('已取消预览，没有写入 Chrome。'); }
  async function review(action: BatchEditAction) {
    const expected = current.current; const gen = ++generation.current;
    setPreview(null); setSecond(false); setBusy(true); setNotice('');
    if (request.chromeIds.length > 1000) { setBusy(false); setNotice('单次最多 1000 项；删除按包含子文件夹的全部条目计算，请缩小选择范围。'); return; }
    try {
      const value = await previewBatchEdit(profileId, revision, request.chromeIds, action);
      if (gen === generation.current && expected === current.current && value.profileId === profileId && value.expectedRevision === revision) setPreview(value);
    } catch (error) { if (gen === generation.current && expected === current.current) setNotice(error === 'FRAME_TOO_LARGE' ? '范围过大，无法保存完整撤销信息，请缩小选择范围。' : error === 'LIMIT_EXCEEDED' ? '单次最多 1000 项；删除按包含子文件夹的全部条目计算，请缩小选择范围。' : error === 'STALE_PROPOSAL' ? '资料已变化，请重新预览。' : error === 'READ_ONLY' ? '当前只读，连接恢复后可重新预览。' : '无法预览。请检查是否包含受保护节点，或重新选择范围。'); }
    finally { if (gen === generation.current && expected === current.current) setBusy(false); }
  }
  async function confirm() {
    if (lock.current || !live || !preview?.writable || preview.expectedRevision !== revision) return;
    if (preview.requiresSecondConfirm && !second) { setSecond(true); return; }
    lock.current = true; setApplying(true);
    // Own write events may advance revision before invoke completes. Identity remains fixed by the source-keyed mount.
    const gen = generation.current;
    const acceptedRequest = request.id;
    try {
      const value = await applyBatchEdit(profileId, preview.planId, preview.planHash, second);
      if (requestIdentity.current !== acceptedRequest) return;
      setResult(value); setPreview(null); setNotice('');
    } catch (error) { if (gen === generation.current) { setPreview(null); setNotice(error === 'FRAME_TOO_LARGE' || error === 'LIMIT_EXCEEDED' ? '范围过大，无法保存完整撤销信息，请缩小选择范围后重新预览。没有开始浏览器写入。' : '批次未获确认。请重新预览；备份失败不会开始浏览器写入。'); } }
    finally { lock.current = false; setApplying(false); }
  }
  return <section className="edit-desk batch-edit-desk" aria-label="多选变更" onKeyDown={(event) => { if (event.key === 'Escape' && preview) { event.stopPropagation(); cancelReview(); } }}>
    <h3>{request.kind === 'move' ? '移动所选项目' : '删除所选项目'}</h3>
    <p>资料：{profileName} · 已选择 {request.chromeIds.length} 项</p>
    {request.kind === 'move' && !result && !preview && <><FolderPicker nodes={nodes} value={target} excluded={request.chromeIds} onChange={(id) => { cancelReview(); setNotice(''); setTarget(id); }} /><button type="button" disabled={!live || !writableFolder(nodes, target) || busy || applying} onClick={() => { if (target) void review({ kind: 'move', parentId: target }); }}>预览批量移动</button></>}
    {request.kind === 'delete' && !preview && !result && !busy && <button type="button" disabled={!live || applying} onClick={() => void review({ kind: 'delete' })}>重新预览删除</button>}
    {busy && <p role="status">正在核对所选范围。</p>}
    {preview && <div className="edit-dialog" role="dialog" aria-label="确认批量变更">
      <h4>{second ? '再次确认删除' : '变更差异'}</h4>
      <p>已选 {preview.selectedCount} 项，去重后 {preview.items.length} 项操作，含子树共 {preview.affected} 项。</p>
      <p>目标：{preview.destinationPath ?? '删除'}</p>
      <ol className="batch-items">{preview.items.map((item) => <li key={item.chromeId}><strong>{item.title || '未命名'}</strong><p>{item.path} · 含子树 {item.affected} 项</p>{item.changes.map((change, i) => <p key={i}>{change.before ?? '无'} → {change.after ?? '删除'}</p>)}</li>)}</ol>
      {second && <p>影响超过 20 项。确认后才会删除。</p>}
      <div className="edit-actions"><button className={request.kind === 'delete' ? 'danger-button' : 'primary-button'} type="button" disabled={!live || !preview.writable || applying} onClick={() => void confirm()}>{second ? '确认批量删除' : preview.requiresSecondConfirm ? '继续确认批量删除' : '确认批量变更'}</button><button type="button" disabled={applying} onClick={cancelReview}>取消批量预览</button></div>
    </div>}
    {busy && <button type="button" onClick={cancelReview}>取消批量预览</button>}
    {result && <BatchReceipt profileId={profileId} operationId={result.operationId} initial={result} />}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
