import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode, HistoryKind, OperationDetail, OperationList, UndoPreview } from '@markbridge/protocol';
import { applyEdit, listOperations, operationDetail, previewUndo, refreshOperations, reviewOperation } from '../../backend';
import { BatchReceipt } from '../library/BatchReceipt';

type Summary = OperationList['operations'][number];
const kinds: Record<HistoryKind, string> = { create: '新建', update: '修改', move: '移动', delete: '删除', reorder: '调整顺序', mixed: '组合变更', undo: '条件撤销' };
const states: Record<Summary['state'], string> = { planned: '等待执行', applying: '等待回执', applied: '已完成', uncertain: '结果不确定', partial: '部分完成', failed: '执行失败', rolling_back: '正在撤销', rolled_back: '已撤销', rollback_conflict: '撤销存在冲突' };
const fields: Record<string, string> = { title: '标题', url: '网址', parent: '文件夹', position: '位置', order: '顺序', existence: '条目' };
function pending(item: Summary) { return ['applying', 'rolling_back', 'planned'].includes(item.state); }
function canUndo(item: Summary) { return item.state === 'applied' || item.state === 'partial'; }
function date(value: number | null | undefined) { return value == null ? '时间未知' : new Date(value).toLocaleString('zh-CN'); }

type Props = { profileId: string; profileName: string; revision: number; refreshToken?: number; live: boolean; nodes?: BookmarkNode[]; onExport?: () => void };
export function HistoryWorkspace(props: Props) { return <HistoryContent key={props.profileId} {...props} />; }
function HistoryContent({ profileId, profileName, revision, refreshToken, live, nodes = [], onExport }: Props) {
  const [history, setHistory] = useState<Summary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [batch, setBatch] = useState<string | null>(null);
  const [request, setRequest] = useState<{ operationId: string; nonce: number } | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const pendingReads = useRef(0);
  const historyRef = useRef(history); historyRef.current = history;
  async function pull(refresh = false) {
    const gen = ++generation.current;
    pendingReads.current += 1;
    try {
      const value = await (refresh ? refreshOperations(profileId) : listOperations(profileId));
      if (gen !== generation.current) return;
      setHistory(value.operations); setLoaded(true); setError(false);
      if (refresh) setReload((value) => value + 1);
    } catch { if (gen === generation.current) setError(true); }
    finally { pendingReads.current -= 1; }
  }
  useEffect(() => { void pull(); return () => { generation.current += 1; }; }, [profileId, revision, refreshToken]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (pendingReads.current === 0 && historyRef.current.some(pending)) void pull(); }, 500);
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, []);
  return <section className="history-workspace" aria-label="操作历史记录">
    <div className="history-heading"><div><h2>操作历史</h2><p className="secondary">{profileName} · 回执保留在本机，断开连接后仍可查看。</p></div><div className="edit-actions"><button type="button" onClick={() => void pull(true)}>重新查询回执</button>{onExport && <button type="button" onClick={onExport}>备份导出</button>}</div></div>
    {!live && <p className="history-readonly">当前只读。可以查看差异与导出缓存，连接恢复后才能执行撤销。</p>}
    {error && <p role="alert">无法读取操作记录，请重新查询。</p>}
    {!loaded && !error && <p role="status">正在读取操作记录。</p>}
    {loaded && history.length === 0 && <p className="history-empty">还没有操作记录。</p>}
    {history.length > 0 && <><p className="secondary">最近记录，待核对的结果优先。最多显示 200 条。</p><ol className="history-list" aria-label="操作记录">{history.map((item) => <li key={item.operationId} className={selected === item.operationId ? 'is-selected' : ''}>
      <button className="history-summary" type="button" aria-expanded={selected === item.operationId} onClick={() => { setSelected(selected === item.operationId ? null : item.operationId); setRequest(null); }}>
        <span><strong>{item.isBatch ? '批量' : ''}{item.kind ? kinds[item.kind] : '书签变更'}</strong><span className="secondary">{date(item.createdAt)} · {item.affected} 项</span></span>
        <span className={`history-state state-${item.state}`}>{states[item.state]}{item.reviewed ? ' · 已核对' : ''}</span>
        <span className="visually-hidden">查看详情</span>
      </button>
      <div className="history-row-actions">
        {item.isBatch && <button type="button" onClick={() => setBatch(batch === item.operationId ? null : item.operationId)}>查看逐项回执</button>}
        <button type="button" disabled={!live || !canUndo(item)} onClick={() => { setSelected(item.operationId); setRequest({ operationId: item.operationId, nonce: (request?.nonce ?? 0) + 1 }); }}>撤销此记录</button>
      </div>
      {selected === item.operationId && <HistoryDetail key={item.operationId} profileId={profileId} operationId={item.operationId} profileName={profileName} revision={revision} refreshToken={`${refreshToken}:${reload}:${item.state}:${item.reviewed}`} live={live} nodes={nodes} request={request?.operationId === item.operationId ? request.nonce : null} onUpdated={() => void pull()} />}
      {batch === item.operationId && <BatchReceipt profileId={profileId} operationId={item.operationId} />}
    </li>)}</ol></>}
  </section>;
}

function HistoryDetail({ profileId, operationId, profileName, revision, refreshToken, live, nodes, request, onUpdated }: { profileId: string; operationId: string; profileName: string; revision: number; refreshToken: string; live: boolean; nodes: BookmarkNode[]; request: number | null; onUpdated: () => void }) {
  const [detail, setDetail] = useState<OperationDetail | null>(null);
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const readGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const currentRevision = useRef(revision);
  if (currentRevision.current !== revision) {
    currentRevision.current = revision; previewGeneration.current += 1;
    if (preview || reading) { setPreview(null); setReading(false); setNotice('资料已变化，请重新审查撤销。'); }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; readGeneration.current += 1; previewGeneration.current += 1; }; }, []);
  useEffect(() => {
    const gen = ++readGeneration.current;
    void operationDetail(profileId, operationId).then((value) => {
      if (gen !== readGeneration.current) return;
      if (value.profileId !== profileId || value.summary.operationId !== operationId) { setError(true); return; }
      setDetail(value); setError(false);
    }, () => { if (gen === readGeneration.current) setError(true); });
  }, [profileId, operationId, refreshToken]);
  useEffect(() => { if (request != null) void reviewUndo(); }, [request]);
  useEffect(() => {
    if (!watchId) return;
    let cancelled = false; let inFlight = false;
    const pull = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await listOperations(profileId);
        if (cancelled) return;
        const operation = value.operations.find((item) => item.operationId === watchId);
        if (!operation || pending(operation)) return;
        setNotice(undoNotice(operation.state)); setWatchId(null); onUpdated();
      } catch { /* Keep the truthful waiting state until an explicit receipt is available. */ }
      finally { inFlight = false; }
    };
    void pull(); const timer = window.setInterval(() => void pull(), 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [watchId, profileId]);
  async function reviewUndo() {
    if (lock.current) return;
    const gen = ++previewGeneration.current;
    setPreview(null); setReading(true); setNotice('');
    try {
      const value = await previewUndo(profileId, operationId, revision);
      if (gen !== previewGeneration.current) return;
      if (value.profileId !== profileId || value.operationId !== operationId || value.expectedRevision !== currentRevision.current) throw new Error('STALE');
      setPreview(value);
    } catch { if (gen === previewGeneration.current) setNotice('无法审查撤销。记录可能尚未确认，或来源身份已变化，请先重新查询回执。'); }
    finally { if (gen === previewGeneration.current) setReading(false); }
  }
  async function confirm() {
    if (lock.current || !live || !preview?.writable || preview.expectedRevision !== revision) return;
    lock.current = true; setBusy(true);
    try {
      const value = await applyEdit(profileId, preview.expectedRevision, { kind: 'undo', operationId }, false);
      if (!alive.current) return;
      setPreview(null);
      setNotice(undoNotice(value.state));
      setWatchId(['planned', 'applying', 'rolling_back'].includes(value.state) ? value.operationId : null);
      onUpdated();
    } catch { if (alive.current) { setPreview(null); setNotice('撤销未获确认。请重新查询回执并审查，当前外部值不会被强行覆盖。'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function reviewed() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await reviewOperation(profileId, operationId); if (alive.current) { setNotice('已记录人工核对。原始执行结果保持不变。'); onUpdated(); } }
    catch { if (alive.current) setNotice('未能记录核对，请重新查询回执。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const names = new Map(nodes.map((node) => [node.chromeId, node.title]));
  for (const step of preview?.steps ?? []) if (step.payload.kind === 'create') names.set(step.requestId, step.payload.title);
  return <section className="history-detail" aria-label="操作详情">
    {error && <p role="alert">无法读取记录详情，请重新查询回执。</p>}
    {!detail && !error && <p role="status">正在读取前后值。</p>}
    {detail && <>
      <h3>记录详情</h3>
      <p>{states[detail.summary.state]}{detail.summary.reviewed ? '，已人工核对' : ''}。{detail.summary.state === 'uncertain' && '未收到可靠结果，不能当作失败重试。'}</p>
      <details className="history-differences"><summary>查看前后值（{detail.steps.length} 步）</summary><ol>{detail.steps.map((step) => <li key={step.requestId}>
        <h4>{kinds[step.mutation.kind]} · {step.before?.title || (step.mutation.kind === 'create' ? step.mutation.title : '书签条目')}</h4>
        <p className="secondary">{step.receipt ? states[step.receipt.state] : '没有确认回执'}</p>
        <ValuePair before={step.receipt?.before ?? step.before} after={step.receipt?.after ?? null} names={names} unknown={!step.receipt || !['applied', 'rolled_back'].includes(step.receipt.state)} />
        {!!step.deletedDescendants?.length && <details><summary>删除前的子项（{step.deletedDescendants.length} 项）</summary><ul>{step.deletedDescendants.map((node) => <li key={node.chromeId}><p>{node.title || '未命名'}</p>{node.url && <p className="secondary">{node.url}</p>}</li>)}</ul></details>}
        {step.receipt?.beforeChildIds && <p>变更前顺序：{step.receipt.beforeChildIds.map((id) => names.get(id) || id).join(' / ')}</p>}
        {step.receipt?.afterChildIds && <p>观察到的顺序：{step.receipt.afterChildIds.map((id) => names.get(id) || id).join(' / ')}</p>}
      </li>)}</ol></details>
      {detail.summary.conflicts.length > 0 && <p className="history-readonly">冲突 {detail.summary.conflicts.length} 项：{detail.summary.conflicts.map((item) => fields[item.field]).join('、')}。外部值保持不变。</p>}
      {['uncertain', 'partial', 'rollback_conflict'].includes(detail.summary.state) && !detail.summary.reviewed && <div><p className="secondary">核对 Chrome 与逐项回执后，可记录人工核对。此标记不会把未知结果改成成功。</p><button disabled={busy} type="button" onClick={() => void reviewed()}>标记已核对</button></div>}
      <details className="history-diagnostics"><summary>诊断与恢复关联</summary><p>记录：{operationId}</p><p>来源世代：{detail.sourceEpoch}</p>{detail.undoOf && <p>撤销原记录：{detail.undoOf}</p>}{detail.restored.map((item) => <p key={item.oldChromeId}>恢复 ID：{item.oldChromeId} → {item.newChromeId} · 原本地身份 {item.bookmarkId}</p>)}</details>
    </>}
    {reading && <p role="status">正在检查可撤销的变更。</p>}
    {preview && <section className="undo-review" aria-label="撤销预览">
      <h3>审查条件撤销</h3><p>{profileName} · 将恢复 {preview.affected} 步</p><p className="secondary">只恢复已确认的变更。遇到外部修改就停止，未执行的批次条目保持原样。</p>
      {preview.conflicts.length > 0 && <p role="alert">有 {preview.conflicts.length} 项冲突，将保留外部值。仅处理下列仍符合条件的步骤。</p>}
      <ol className="undo-steps" tabIndex={0} aria-label="完整撤销差异">{preview.steps.map((step) => <li key={step.requestId}><h4>{kinds[step.payload.kind]} · {step.expectedBefore?.title || (step.payload.kind === 'create' ? step.payload.title : '书签条目')}</h4><PlannedValues step={step} names={names} /></li>)}</ol>
      {!preview.writable && <p>当前只读或仍有待核对记录，不能执行撤销。</p>}
      <div className="edit-actions"><button className="primary-button" disabled={!live || !preview.writable || busy} type="button" onClick={() => void confirm()}>确认条件撤销</button><button disabled={busy} type="button" onClick={() => { previewGeneration.current += 1; setPreview(null); }}>取消撤销</button></div>
    </section>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

function undoNotice(state: Summary['state']) {
  return state === 'rolled_back' ? '撤销回执已确认。' : state === 'rollback_conflict' ? '撤销存在冲突，外部值保持不变。' : state === 'uncertain' ? '撤销结果不确定，请重新查询回执。' : state === 'failed' ? '撤销执行失败，请重新查询回执。' : state === 'partial' ? '撤销部分完成，请核对逐项回执。' : '已发送撤销，正在等待回执。';
}

function ValuePair({ before, after, names, unknown = false }: { before: BookmarkNode | null | undefined; after: BookmarkNode | null | undefined; names: Map<string, string>; unknown?: boolean }) {
  function value(node: BookmarkNode | null | undefined) { return node ? <><strong>{node.title || '未命名'}</strong>{node.url && <span>{node.url}</span>}<span>文件夹：{node.parentId ? names.get(node.parentId) || node.parentId : '根目录'} · 位置 {node.position + 1}</span></> : '不存在'; }
  return <dl className="history-values"><div><dt>之前</dt><dd>{value(before)}</dd></div><div><dt>之后</dt><dd>{unknown ? '结果未确认' : value(after)}</dd></div></dl>;
}
function PlannedValues({ step, names }: { step: UndoPreview['steps'][number]; names: Map<string, string> }) {
  const before = step.expectedBefore;
  const mutation = step.payload;
  let after = before;
  if (mutation.kind === 'create') after = { chromeId: step.requestId, kind: mutation.url ? 'bookmark' : 'folder', parentId: mutation.parentId, position: mutation.position, title: mutation.title, url: mutation.url ?? null };
  else if (mutation.kind === 'delete') after = null;
  else if (before && mutation.kind === 'update') after = { ...before, title: mutation.title ?? before.title, url: mutation.url ?? before.url };
  else if (before && mutation.kind === 'move') after = { ...before, parentId: mutation.parentId, position: mutation.position };
  return <><ValuePair before={before} after={after} names={names} />{mutation.kind === 'reorder' && <p>恢复顺序：{mutation.childIds.map((id) => names.get(id) || id).join(' / ')}</p>}</>;
}
