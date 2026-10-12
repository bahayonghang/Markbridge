import { useEffect, useRef, useState } from 'react';
import type { MaintenanceReport, TextHit } from '@markbridge/protocol';
import {
  applyEdit, cancelLinkCheck, checkLinks, confirmCleanup, inspectLibrary, previewCleanup, searchLibraryText,
} from '../../backend';

export function MaintenanceDesk({ profileId, revision, live, chromeIds }: {
  profileId: string;
  revision: number;
  live: boolean;
  chromeIds: string[];
}) {
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [keeper, setKeeper] = useState('');
  const [operationId, setOperationId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TextHit[]>([]);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const seenRevision = useRef(revision);

  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    setKeeper('');
    setReport((current) => (current?.cleanup?.operationId ? current : null));
  }, [revision]);

  async function run(action: () => Promise<MaintenanceReport>) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      setReport(next);
      setMessage(next.failureMessage);
      if (next.cleanup?.operationId) setOperationId(next.cleanup.operationId);
    } catch {
      setMessage('无法完成库维护。没有写入书签。');
    } finally {
      setBusy(false);
    }
  }

  const group = report?.duplicates.find((item) => item.members.some((member) => member.chromeId === keeper));
  const scope = group?.members.map((member) => member.chromeId) ?? [];
  const previewed = report?.cleanup?.keeper.chromeId === keeper && scope.length > 1;
  return (
    <section className="maint-desk" aria-label="库维护">
      <h4>库维护</h4>
      <p>已选 {chromeIds.length} 个书签。重复项保持为候选，直到选择保留项。</p>
      <div className="edit-actions">
        <button type="button" disabled={busy || chromeIds.length === 0} onClick={() => void run(() => inspectLibrary(profileId, chromeIds))}>检查重复</button>
        <button type="button" disabled={busy || chromeIds.length === 0} onClick={() => {
          const id = `mnt${Date.now()}`;
          requestId.current = id;
          void run(() => checkLinks(profileId, chromeIds, id));
        }}>检查链接</button>
        <button type="button" disabled={busy || !requestId.current} onClick={() => {
          const id = requestId.current;
          if (!id) return;
          void cancelLinkCheck(id).then(() => setMessage('检查已取消。未继续请求其余地址。')).catch(() => setMessage('无法取消检查。'));
        }}>取消检查</button>
      </div>
      {report?.duplicates.map((item) => (
        <fieldset key={item.normalizedUrl}>
          <legend>{item.normalizedUrl}</legend>
          {item.members.map((member) => (
            <label key={member.chromeId}>
              <input type="radio" name={`keeper-${profileId}`} value={member.chromeId} checked={keeper === member.chromeId} onChange={() => setKeeper(member.chromeId)} />
              {member.title}
            </label>
          ))}
        </fieldset>
      ))}
      {report?.links.map((row) => <p key={row.chromeId}>{row.chromeId} {row.verdict} {row.checks}</p>)}
      <div className="edit-actions">
        <button type="button" disabled={busy || scope.length < 2} onClick={() => void run(() => previewCleanup(profileId, revision, scope, keeper))}>预览清理</button>
        <button type="button" disabled={busy || !live || !previewed} onClick={() => void run(() => confirmCleanup(profileId, revision, scope, keeper, true, false))}>确认清理</button>
        {message === '删除超过 20 项需要再次确认。' && <button type="button" disabled={busy || !live || !previewed} onClick={() => void run(() => confirmCleanup(profileId, revision, scope, keeper, true, true))}>再次确认清理</button>}
        <button type="button" disabled={busy || !operationId} onClick={() => {
          if (!operationId) return;
          setBusy(true);
          void applyEdit(profileId, revision, { kind: 'undo', operationId }, false)
            .then((result) => setMessage(result.state))
            .catch(() => setMessage('无法撤销。'))
            .finally(() => setBusy(false));
        }}>撤销清理</button>
      </div>
      {report?.cleanup && <>
        <p>保留项 {report.cleanup.keeper.title}</p>
        {report.cleanup.removals.map((item) => <p key={item.chromeId}>移除 {item.title}</p>)}
        <p>标签并集 {report.cleanup.metadata.tagUnion.join('、')}</p>
        {report.cleanup.metadata.noteConflicts.map((item) => <p key={item.chromeId}>备注冲突 {item.note}</p>)}
        <p>{report.cleanup.metadata.handling}</p>
      </>}
      <label>检索摘要和备注
        <input aria-label="检索摘要和备注" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button type="button" disabled={busy} onClick={() => {
        setBusy(true);
        void searchLibraryText(profileId, query)
          .then((page) => setHits(page.hits))
          .catch(() => setMessage('无法检索摘要和备注。'))
          .finally(() => setBusy(false));
      }}>检索摘要和备注</button>
      <ul>
        {hits.map((hit) => <li key={hit.bookmarkId}>{hit.title} {hit.summary} {hit.note}</li>)}
      </ul>
      {message && <p>{message}</p>}
    </section>
  );
}
