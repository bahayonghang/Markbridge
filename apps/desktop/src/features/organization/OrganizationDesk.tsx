import { useEffect, useRef, useState } from 'react';
import type { OrganizationPlan } from '@markbridge/protocol';
import {
  applyOrganization, assignOrganization, cancelOrganization, cleanupOrganization, editOrganization,
  organizationPlan, pauseOrganization, proposeOrganization, reviewOrganization,
} from '../../backend';

export function OrganizationDesk({ profileId, revision, live, chromeIds }: {
  profileId: string;
  revision: number;
  live: boolean;
  chromeIds: string[];
}) {
  const [plan, setPlan] = useState<OrganizationPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seenRevision = useRef(revision);

  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    setPlan(null);
    setConfirmDelete(false);
    setMessage('资料已变化。旧方案不能应用。');
  }, [revision]);

  async function run(action: () => Promise<OrganizationPlan>, fallback: string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      setPlan(next);
      setMessage(next.failureMessage);
    } catch {
      setMessage(fallback);
    } finally {
      setBusy(false);
    }
  }

  const ready = plan?.phase === 'ready' && live && plan.sourceRevision === revision;
  return (
    <section className="org-desk" aria-label="批量整理">
      <h4>批量整理</h4>
      <p>已选 {chromeIds.length} 个书签。影响 {plan?.impact ?? 0} 步。</p>
      {plan?.folders.map((folder) => <p key={folder.folderId}>{folder.name}</p>)}
      {plan?.assignments.map((row) => (
        <div className="org-row" key={row.chromeId}>
          <span>{row.sourceLabel}</span>
          <span>→</span>
          <select aria-label={`目标 ${row.sourceLabel}`} value={row.targetFolderId} disabled={busy || plan.phase !== 'ready'} onChange={(event) => {
            void run(() => editOrganization(plan.jobId, row.chromeId, event.target.value, row.rejected), '无法修改目标。没有写入书签。');
          }}>
            {plan.folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}
          </select>
          <label><input type="checkbox" aria-label={`拒绝 ${row.sourceLabel}`} checked={row.rejected} disabled={busy || plan.phase !== 'ready'} onChange={(event) => {
            void run(() => editOrganization(plan.jobId, row.chromeId, row.targetFolderId, event.target.checked), '无法修改方案。没有写入书签。');
          }} /> 拒绝</label>
        </div>
      ))}
      <div className="edit-actions">
        <button type="button" disabled={busy || chromeIds.length === 0} onClick={() => void run(() => proposeOrganization(profileId, chromeIds), '无法提出文件夹。没有写入书签。')}>提出文件夹</button>
        <button type="button" disabled={busy || !plan || (plan.phase !== 'folders' && plan.phase !== 'reviewed')} onClick={() => {
          if (!plan) return;
          void run(() => reviewOrganization(plan.jobId, plan.folders.map((folder) => ({ ...folder, reviewed: true }))), '无法确认目录。没有写入书签。');
        }}>确认目录</button>
        <button type="button" disabled={busy || plan?.phase !== 'reviewed'} onClick={() => plan && void run(() => assignOrganization(plan.jobId), '无法生成分配。没有写入书签。')}>生成分配</button>
        <button type="button" disabled={busy || !ready} onClick={() => plan && void run(() => applyOrganization(plan.jobId, plan.planHash), '无法应用。没有写入书签。')}>应用</button>
        <button type="button" disabled={busy || !plan} onClick={() => plan && void run(() => pauseOrganization(plan.jobId), '无法暂停。')}>暂停</button>
        <button type="button" disabled={busy || !plan} onClick={() => plan && void run(() => cancelOrganization(plan.jobId), '无法取消。')}>取消</button>
        <button type="button" disabled={busy || plan?.phase !== 'applying'} onClick={() => plan && void run(() => organizationPlan(plan.jobId), '无法刷新。')}>刷新</button>
        <button type="button" disabled={busy || plan?.phase !== 'applied'} onClick={() => setConfirmDelete(true)}>清理空文件夹</button>
        {confirmDelete && <button type="button" disabled={busy || !plan} onClick={() => plan && void run(() => cleanupOrganization(plan.jobId, true, false), '未确认删除。没有删除书签或空文件夹。')}>确认删除空文件夹</button>}
      </div>
      {message && <p>{message}</p>}
    </section>
  );
}
