import { useEffect, useRef, useState } from 'react';
import type { ApplyResult, MaintenanceReport } from '@markbridge/protocol';
import { cancelLinkCheck, checkLinks, confirmCleanup, inspectLibrary, previewCleanup } from '../../backend';
import { OperationNotice } from '../history/OperationNotice';

let nextRequest = 0;
const verdicts = { unknown: '状态未知', alive: '可访问', pending: '待复查', candidate: '疑似失效，需人工确认' };

export function MaintenanceDesk({ profileId, revision, sourceEpoch, live, chromeIds, onHistory }: {
  profileId: string; revision: number; sourceEpoch?: number; live: boolean; chromeIds: string[]; onHistory?: () => void;
}) {
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [reportFromLinkCheck, setReportFromLinkCheck] = useState(false);
  const [keeper, setKeeper] = useState('');
  const [receipt, setReceipt] = useState<ApplyResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const requestId = useRef<string | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const basis = JSON.stringify([profileId, sourceEpoch, revision, chromeIds]);
  const current = useRef(basis);
  if (current.current !== basis) { current.current = basis; generation.current += 1; }

  useEffect(() => {
    setKeeper('');
    setReport((value) => value ? { ...value, cleanup: value.cleanup?.operationId ? value.cleanup : null } : null);
    if (requestId.current) {
      void cancelLinkCheck(requestId.current).catch(() => {});
      requestId.current = null;
    }
    setChecking(false);
    if (!lock.current) setBusy(false);
  }, [basis]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; if (requestId.current) void cancelLinkCheck(requestId.current).catch(() => {}); }; }, []);

  async function run(kind: 'inspect' | 'links' | 'preview' | 'confirm', action: () => Promise<MaintenanceReport>) {
    if (busy || lock.current) return;
    const confirmed = kind === 'confirm';
    const gen = ++generation.current;
    const stamp = basis;
    lock.current = confirmed;
    setBusy(true); setMessage(confirmed ? '正在提交清理。离开页面不会撤回已确认的操作。' : null);
    try {
      const next = await action();
      if (!mounted.current) return;
      if (confirmed && next.cleanup?.operationId && next.cleanup.operationState) {
        setReceipt({ operationId: next.cleanup.operationId, state: next.cleanup.operationState, errorCode: next.failure, conflicts: [] });
      }
      if (!confirmed && (generation.current !== gen || current.current !== stamp)) return;
      if (next.profileId !== profileId || (sourceEpoch !== undefined && next.sourceEpoch !== sourceEpoch)) return;
      setReport(next);
      setReportFromLinkCheck(kind === 'links');
      const completed = kind === 'links' ? '链接检查完成。'
        : kind === 'inspect' ? next.duplicates.length ? '发现重复候选，请选择保留项。' : '检查完成，没有重复候选。'
          : kind === 'preview' ? '清理差异已就绪，请核对保留项与移除项。' : '清理操作已提交，请查看回执。';
      setMessage(next.failureMessage ?? completed);
    } catch {
      if (mounted.current && (confirmed || generation.current === gen)) setMessage(confirmed ? '未收到完整清理结果。请在操作历史核对，勿重复提交。' : '检查未完成，请重试。没有应用清理。');
    } finally {
      if (mounted.current && (confirmed || generation.current === gen)) { lock.current = false; requestId.current = null; setBusy(false); setChecking(false); }
    }
  }

  async function cancelCheck() {
    const id = requestId.current;
    if (!id) return;
    const gen = ++generation.current;
    requestId.current = null; setBusy(false); setChecking(false);
    setMessage('检查已取消。正在进行的请求会停止，不再检查其余地址。');
    try { await cancelLinkCheck(id); }
    catch { if (mounted.current && generation.current === gen) setMessage('未收到取消回执。此检查的晚到结果不会成为可应用方案。'); }
  }

  const group = report?.duplicates.find((item) => item.members.some((member) => member.chromeId === keeper));
  const scope = group?.members.map((member) => member.chromeId) ?? [];
  const fresh = report?.revision === revision && (sourceEpoch === undefined || report.sourceEpoch === sourceEpoch);
  const previewed = fresh && report?.cleanup?.keeper.chromeId === keeper && !report.cleanup.operationId && scope.length > 1;
  const available = chromeIds.length > 0 && chromeIds.length <= 1000;
  return <section className="maint-desk" aria-label="库维护">
    <h3>重复与链接</h3>
    <p className="secondary">重复检查只读取本地缓存。链接检查会请求范围内的网址；403、429、超时等结果保留为未知，不自动删除。</p>
    {!live && <p className="notice">当前只读。可以检查和审查，连接恢复后才能确认清理。</p>}
    {chromeIds.length > 1000 && <p role="alert">每次最多检查 1000 个书签，请缩小范围。不会只检查前 1000 项。</p>}
    <div className="edit-actions">
      <button type="button" disabled={busy || !available} onClick={() => void run('inspect', () => inspectLibrary(profileId, chromeIds))}>检查重复</button>
      <button type="button" disabled={busy || !available} onClick={() => {
        const id = 'mnt' + Date.now() + '-' + nextRequest++;
        requestId.current = id; setChecking(true);
        void run('links', () => checkLinks(profileId, chromeIds, id));
      }}>检查链接</button>
      <button type="button" disabled={!checking} onClick={() => void cancelCheck()}>取消检查</button>
    </div>
    {checking && <p role="status">正在检查 {chromeIds.length} 个网址，可以返回书签，稍后查看结果。</p>}
    {message && <p role="status">{message}</p>}
    {report && !fresh && <p className="notice">资料已变化。上次结果仅供参考，请重新检查后清理。</p>}
    {report?.duplicates.map((item) => <fieldset className="duplicate-group" key={item.normalizedUrl}>
      <legend>{item.members.length} 项重复候选</legend><p className="secondary">{item.normalizedUrl}</p>
      {item.members.map((member) => <label key={member.chromeId}><input type="radio" name={'keeper-' + profileId} aria-label={member.title} checked={keeper === member.chromeId} disabled={busy || !fresh} onChange={() => { setKeeper(member.chromeId); setReport((value) => value ? { ...value, cleanup: null } : null); }} /><span><strong>{member.title || '未命名'}</strong><small>{member.tags.length ? member.tags.join('、') : '无本地标签'}{member.note ? ' · 有备注' : ''}</small></span><span className="secondary">保留此项</span></label>)}
    </fieldset>)}
    {!!report?.links.length && <>
      {!reportFromLinkCheck && <p className="secondary">以下为已有链接状态，本次没有重新检查网址。</p>}
      <ul className="link-results" aria-label="链接检查结果">{report.links.map((row) => <li key={row.chromeId}><span className="link-address">{row.url}</span><strong>{verdicts[row.verdict]}</strong><small>{row.httpStatus ? 'HTTP ' + row.httpStatus + ' · ' : ''}{row.checks ? '已检查 ' + row.checks + ' 次' : '尚未检查'}</small></li>)}</ul>
    </>}
    <div className="edit-actions">
      <button type="button" disabled={busy || !fresh || scope.length < 2} onClick={() => void run('preview', () => previewCleanup(profileId, revision, scope, keeper))}>预览清理</button>
      <button type="button" className="danger-button" disabled={busy || !live || !previewed} onClick={() => void run('confirm', () => confirmCleanup(profileId, revision, scope, keeper, true, false))}>确认清理</button>
      {message === '删除超过 20 项需要再次确认。' && <button type="button" className="danger-button" disabled={busy || !live || !previewed} onClick={() => void run('confirm', () => confirmCleanup(profileId, revision, scope, keeper, true, true))}>再次确认清理</button>}
    </div>
    {report?.cleanup && <div className="cleanup-review" aria-label="清理差异"><h4>清理审查</h4><p>保留项 {report.cleanup.keeper.title}</p>{report.cleanup.removals.map((item) => <p key={item.chromeId}>移除 {item.title}</p>)}<p>标签并集 {report.cleanup.metadata.tagUnion.join('、')}</p>{report.cleanup.metadata.noteConflicts.map((item) => <p key={item.chromeId}>备注冲突 {item.note}</p>)}<p>{report.cleanup.metadata.handling}</p></div>}
    {receipt && <OperationNotice key={receipt.operationId} profileId={profileId} result={receipt} onHistory={onHistory} />}
  </section>;
}
