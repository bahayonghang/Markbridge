import { useEffect, useRef, useState } from 'react';
import type { AiSettings, OrganizationPlan } from '@markbridge/protocol';
import {
  applyOrganization, assignOrganization, cancelAi, cancelOrganization, cleanupOrganization, editOrganization,
  organizationPlan, pauseOrganization, proposeOrganization, reviewOrganization,
} from '../../backend';
import { AiDisclosure } from '../ai/AiDisclosure';

let nextRequest = 0;
const phases: Record<OrganizationPlan['phase'], string> = { folders: '审查目录', reviewed: '目录已审查', assigning: '正在生成分配', ready: '等待确认应用', applying: '执行中，等待回执', applied: '已完成', partial: '部分完成', paused: '已暂停', cancelled: '已取消', failed: '未完成', invalid: '方案已过期' };
function countSteps(ranges: OrganizationPlan['applied']) { return ranges.reduce((total, range) => total + range.end - range.start, 0); }

export function OrganizationDesk({ profileId, revision, sourceEpoch, live, chromeIds, settings = null, onSettings, onHistory }: {
  profileId: string; revision: number; sourceEpoch?: number; live: boolean; chromeIds: string[];
  settings?: AiSettings | null; onSettings?: () => void; onHistory?: () => void;
}) {
  const [plan, setPlan] = useState<OrganizationPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<'generation' | 'write' | 'read' | null>(null);
  const request = useRef<string | null>(null);
  const basis = JSON.stringify([profileId, sourceEpoch, revision, chromeIds]);
  const current = useRef(basis);
  if (current.current !== basis) { current.current = basis; if (pending.current !== 'write') generation.current += 1; }

  useEffect(() => {
    setConfirmDelete(false);
    setPlan((value) => value?.operationId ? value : value ? { ...value, phase: 'invalid' } : null);
    if (request.current) { void cancelAi(request.current).catch(() => {}); request.current = null; }
    if (pending.current !== 'write') { pending.current = null; setBusy(false); }
  }, [basis]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; if (request.current) void cancelAi(request.current).catch(() => {}); }; }, []);

  async function run(action: () => Promise<OrganizationPlan>, fallback: string, kind: 'generation' | 'write' | 'read' = 'read') {
    if (pending.current) return;
    const gen = ++generation.current;
    pending.current = kind; setBusy(true); setMessage(kind === 'write' ? '已确认操作正在提交。离开页面不会撤回，请查看实际回执。' : null);
    try {
      const next = await action();
      if (!mounted.current || generation.current !== gen) return;
      if (next.profileId !== profileId || (sourceEpoch !== undefined && next.sourceEpoch !== sourceEpoch)) return;
      setPlan(next); setMessage(next.failureMessage);
    } catch { if (mounted.current && generation.current === gen) setMessage(fallback); }
    finally { if (mounted.current && generation.current === gen) { request.current = null; pending.current = null; setBusy(false); } }
  }

  async function cancel() {
    if (pending.current === 'write') return;
    const id = request.current;
    const known = plan;
    const gen = ++generation.current;
    request.current = null; pending.current = null; setBusy(false); setConfirmDelete(false);
    if (id) {
      setMessage('生成已取消，没有应用这份方案。');
      try { await cancelAi(id); } catch { if (mounted.current && generation.current === gen) setMessage('未收到取消回执。晚到方案不会应用。'); }
    } else if (known) {
      pending.current = 'read'; setBusy(true);
      try {
        const next = await cancelOrganization(known.jobId);
        if (mounted.current && generation.current === gen) { setPlan(next); setMessage(known.operationId ? '已请求停止剩余步骤。已发送步骤仍需回执，已完成的变更不会自动撤销。' : '方案已取消，没有应用。'); }
      } catch { if (mounted.current && generation.current === gen) setMessage('未收到取消回执，请查看操作历史。'); }
      finally { if (mounted.current && generation.current === gen) { pending.current = null; setBusy(false); } }
    }
  }

  useEffect(() => {
    if (plan?.phase !== 'applying') return;
    let disposed = false;
    let loading = false;
    const pull = async () => {
      if (loading || pending.current) return;
      loading = true;
      try { const value = await organizationPlan(plan.jobId); if (!disposed) { setPlan(value); setMessage(value.failureMessage); } }
      catch { /* Retain the last observed receipt; explicit refresh is available. */ }
      finally { loading = false; }
    };
    const timer = window.setInterval(() => void pull(), 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [plan?.phase, plan?.jobId]);

  const fresh = plan?.sourceRevision === revision && (sourceEpoch === undefined || plan.sourceEpoch === sourceEpoch);
  const ready = plan?.phase === 'ready' && live && fresh;
  const generating = pending.current === 'generation';
  return <section className="org-desk" aria-label="批量整理">
    <h3>AI 文件夹整理</h3>
    <p className="secondary">先审查目录，再逐项查看分配。模型建议不会自动移动书签。</p>
    <AiDisclosure settings={settings} batch count={chromeIds.length} onSettings={onSettings} />
    {!live && <p className="notice">当前只读。可以审查方案，连接恢复后才能应用或删除空目录。</p>}
    {chromeIds.length > 900 && <p role="alert">AI 整理每次最多 900 个书签，请缩小范围。不会截取部分书签应用。</p>}
    <div className="edit-actions">
      <button type="button" disabled={busy || !settings?.enabled || chromeIds.length === 0 || chromeIds.length > 900} onClick={() => {
        request.current = 'org' + Date.now() + '-' + nextRequest++;
        void run(() => proposeOrganization(profileId, chromeIds, request.current!), '无法提出文件夹。没有应用方案。', 'generation');
      }}>提出文件夹</button>
      <button type="button" disabled={pending.current === 'write' || (!generating && !plan)} onClick={() => void cancel()}>{plan?.operationId ? '停止剩余步骤' : '取消'}</button>
    </div>
    {generating && <p role="status">正在生成建议，可以返回书签，稍后查看结果。</p>}
    {message && <p role="status">{message}</p>}
    {plan && <div className="organization-review">
      <div className="organize-result-heading"><h4>{phases[plan.phase]}</h4><span>范围 {plan.scopeCount} 个书签 · 影响 {plan.impact} 步</span></div>
      {!fresh && !plan.operationId && <p className="notice">资料已变化。旧方案不能应用。</p>}
      <div className="organization-folders">{plan.folders.map((folder) => <label key={folder.folderId}>目录名称<input aria-label={'目录名称 ' + folder.folderId} value={folder.name} disabled={busy || !fresh || plan.phase !== 'folders'} onChange={(event) => setPlan({ ...plan, folders: plan.folders.map((item) => item.folderId === folder.folderId ? { ...item, name: event.target.value } : item) })} /></label>)}</div>
      <div className="edit-actions">
        <button type="button" disabled={busy || !fresh || !['folders', 'reviewed'].includes(plan.phase)} onClick={() => void run(() => reviewOrganization(plan.jobId, plan.folders.map((folder) => ({ ...folder, reviewed: true }))), '目录审查未保存。')}>确认目录</button>
        <button type="button" disabled={busy || !fresh || !settings?.enabled || plan.phase !== 'reviewed'} onClick={() => void run(() => assignOrganization(plan.jobId), '分配未完成。没有应用方案。', 'generation')}>生成分配</button>
      </div>
      <div className="organization-assignments" aria-label="分配审查">{plan.assignments.map((row) => <div className="org-row" key={row.chromeId}>
        <span className="org-source">{row.sourceLabel}</span>
        <label>目标目录<select aria-label={'目标 ' + row.sourceLabel} value={row.targetFolderId} disabled={busy || !fresh || plan.phase !== 'ready'} onChange={(event) => void run(() => editOrganization(plan.jobId, row.chromeId, event.target.value, row.rejected), '无法修改目标。没有应用方案。')}>
          {plan.folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}
        </select></label>
        <label className="check-label"><input type="checkbox" aria-label={'拒绝 ' + row.sourceLabel} checked={row.rejected} disabled={busy || !fresh || plan.phase !== 'ready'} onChange={(event) => void run(() => editOrganization(plan.jobId, row.chromeId, row.targetFolderId, event.target.checked), '无法修改方案。')} />拒绝</label>
      </div>)}</div>
      <div className="edit-actions">
        <button type="button" className="primary-button" disabled={busy || !ready} onClick={() => void run(() => applyOrganization(plan.jobId, plan.planHash), '未收到完整结果，请在操作历史核对，勿重复提交。', 'write')}>应用</button>
        <button type="button" disabled={busy || !['applying', 'assigning'].includes(plan.phase)} onClick={() => void run(() => pauseOrganization(plan.jobId), '未收到暂停回执。')}>暂停</button>
        <button type="button" disabled={busy} onClick={() => void run(() => organizationPlan(plan.jobId), '无法刷新，请稍后重试。')}>刷新</button>
        <button type="button" disabled={busy || !live || plan.phase !== 'applied'} onClick={() => setConfirmDelete(true)}>清理空文件夹</button>
      </div>
      {plan.operationId && <div className="organize-operation"><p>已完成 {countSteps(plan.applied)} 步 · 待处理 {countSteps(plan.pending)} 步 · 不确定 {countSteps(plan.uncertain)} 步 · 失败 {countSteps(plan.failed)} 步</p>{onHistory && <button type="button" onClick={onHistory}>前往操作历史</button>}</div>}
      {confirmDelete && <div className="cleanup-review"><p>只清理这次整理留下的空目录。删除前仍会备份并核对目录状态。</p><div className="edit-actions"><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消清理空目录</button><button type="button" className="danger-button" disabled={busy || !live} onClick={() => void run(() => cleanupOrganization(plan.jobId, true, false), '未收到清理结果，请查看操作历史。', 'write')}>确认删除空文件夹</button>{plan.failure === 'LIMIT_EXCEEDED' && <button type="button" className="danger-button" disabled={busy || !live} onClick={() => void run(() => cleanupOrganization(plan.jobId, true, true), '未收到清理结果，请查看操作历史。', 'write')}>再次确认删除空文件夹</button>}</div></div>}
    </div>}
  </section>;
}
