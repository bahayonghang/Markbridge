import { useEffect, useRef, useState } from 'react';
import type { AiSettings, AiSuggestion, ApplyResult } from '@markbridge/protocol';
import { applyAi, applyEdit, cancelAi, suggestAi } from '../../backend';
import { AiDisclosure } from './AiDisclosure';
import { OperationNotice } from '../history/OperationNotice';

let nextRequest = 0;

export function AiSuggest({ profileId, chromeId, url, revision, settings = null, live = true, onChanged, onSettings, onHistory }: {
  profileId: string;
  chromeId: string;
  url: string | null;
  revision: number;
  onChanged?: () => void;
  settings?: AiSettings | null;
  live?: boolean;
  onSettings?: () => void;
  onHistory?: () => void;
}) {
  const [draft, setDraft] = useState<AiSuggestion | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState(['', '', '']);
  const [summary, setSummary] = useState('');
  const [applyTitle, setApplyTitle] = useState(false);
  const [applyTags, setApplyTags] = useState(false);
  const [applySummary, setApplySummary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const requestRef = useRef<string | null>(null);
  const writeRef = useRef<string | null>(null);
  const identity = `${profileId}:${chromeId}:${url}`;
  const identityRef = useRef(identity);
  const identityGeneration = useRef(0);
  if (identityRef.current !== identity) { identityRef.current = identity; identityGeneration.current += 1; writeRef.current = null; }
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => () => { identityGeneration.current += 1; }, []);

  useEffect(() => {
    generation.current += 1;
    const previous = requestRef.current;
    requestRef.current = null;
    if (previous) void cancelAi(previous).catch(() => {});
    setDraft(null);
    if (!writeRef.current) { setMessage(null); setBusy(false); }
    return () => {
      generation.current += 1;
      const requestId = requestRef.current;
      requestRef.current = null;
      if (requestId) void cancelAi(requestId).catch(() => {});
    };
  }, [profileId, chromeId, url, revision]);

  useEffect(() => {
    setOperationId(null);
    setReceipt(null);
  }, [profileId, chromeId, url]);

  async function generate() {
    if (!settings?.enabled || busy || writeRef.current) return;
    const current = ++generation.current;
    const requestId = `ai${Date.now()}-${nextRequest}`;
    nextRequest += 1;
    requestRef.current = requestId;
    setBusy(true);
    setMessage(null);
    setDraft(null);
    try {
      const suggestion = await suggestAi(profileId, chromeId, requestId);
      if (generation.current !== current || requestRef.current !== requestId) return;
      setDraft(suggestion);
      setTitle(suggestion.title ?? '');
      setTags([suggestion.tags[0] ?? '', suggestion.tags[1] ?? '', suggestion.tags[2] ?? '']);
      setSummary(suggestion.summary ?? '');
      setApplyTitle(false);
      setApplyTags(false);
      setApplySummary(false);
      if (suggestion.state !== 'ready') setMessage(suggestion.failureMessage ?? '没有生成可应用的建议。');
    } catch {
      if (generation.current === current) setMessage('无法生成建议。没有写入书签。');
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  function cancel() {
    if (writeRef.current) return;
    generation.current += 1;
    const requestId = requestRef.current;
    requestRef.current = null;
    if (requestId) void cancelAi(requestId).catch(() => {});
    setDraft(null);
    setBusy(false);
    setMessage('建议已取消，没有应用这份建议。');
  }

  async function confirm() {
    if (!draft || draft.state !== 'ready' || busy || writeRef.current || (applyTitle && !live)) return;
    if (!applyTitle && !applyTags && !applySummary) {
      setMessage('请选择要保存的标题、标签或摘要。');
      return;
    }
    const current = identityGeneration.current;
    const changed = onChangedRef.current;
    writeRef.current = 'apply';
    requestRef.current = null;
    setBusy(true);
    setMessage('正在提交已确认的建议。离开页面不会撤回这次操作，请等待回执或查看操作历史。');
    try {
      const result = await applyAi({
        jobId: draft.jobId,
        profileId: draft.profileId,
        chromeId: draft.chromeId,
        inputFingerprint: draft.inputFingerprint,
        title,
        tags: tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
        summary: summary.trim() ? summary : null,
        applyTitle,
        applyTags,
        applySummary,
      });
      if (result.tagsApplied || result.summaryApplied) changed?.();
      if (identityGeneration.current !== current) return;
      if (result.browser) { setOperationId(result.browser.operationId); setReceipt(result.browser); }
      if (result.failure) {
        setMessage(result.failureMessage ?? '没有写入书签。');
        return;
      }
      setDraft(null);
      setMessage(result.browser ? '标题操作已提交。可在操作历史查看回执和条件撤销。' : '本地标签或摘要已保存。');
    } catch {
      if (identityGeneration.current === current) setMessage('未收到完整结果。请在操作历史核对，勿重复提交。');
    } finally {
      if (identityGeneration.current === current) { writeRef.current = null; setBusy(false); }
    }
  }

  async function undoTitle() {
    if (!operationId || busy || writeRef.current || !live) return;
    const current = identityGeneration.current;
    writeRef.current = 'undo';
    setBusy(true);
    setMessage('正在提交已确认的撤销。离开页面不会撤回这次操作。');
    try {
      const result = await applyEdit(profileId, revision, { kind: 'undo', operationId }, false);
      if (identityGeneration.current === current) { setReceipt(result); setOperationId(null); setMessage('已提交撤销。'); }
    } catch {
      if (identityGeneration.current === current) setMessage('撤销结果尚未确认。请在操作历史核对。');
    } finally {
      if (identityGeneration.current === current) { writeRef.current = null; setBusy(false); }
    }
  }

  const scope = draft ? `输入范围：${draft.scope.includesTitle ? '标题' : '不含标题'}，${draft.scope.includesUrl ? '网址' : '不含网址'}，${draft.scope.includesCachedText ? `缓存正文 ${draft.scope.excerptChars} 字` : '不含缓存正文'}。` : null;

  return (
    <section className="ai-desk" aria-label="AI 建议">
      <h4>单条建议</h4>
      <p className="secondary">生成前不会请求模型。建议可以修改。确认后标题走浏览器写入，标签和摘要留在本机。</p>
      <AiDisclosure settings={settings} onSettings={onSettings} />
      {!live && <p className="notice">当前浏览器只读。本地标签和摘要仍可保存；连接恢复后才能保存标题或撤销标题。</p>}
      {draft && <>
        <p>端点 {draft.endpointLabel ?? '未记录'} · 模型 {draft.model ?? '未记录'}</p>
        {scope && <p className="secondary">{scope}</p>}
        {draft.suggestedFolder && <p className="secondary">建议文件夹：{draft.suggestedFolder}。不会移动书签。</p>}
      </>}
      {draft?.state === 'ready' && <>
        <label htmlFor={`ai-title-${chromeId}`}>建议标题<input id={`ai-title-${chromeId}`} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        {tags.map((tag, index) => <label key={index} htmlFor={`ai-tag-${chromeId}-${index}`}>标签 {index + 1}<input id={`ai-tag-${chromeId}-${index}`} value={tag} onChange={(event) => setTags((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}
        <label htmlFor={`ai-summary-${chromeId}`}>摘要<textarea id={`ai-summary-${chromeId}`} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label><input type="checkbox" checked={applyTitle} disabled={busy || (!live && !applyTitle)} onChange={(event) => setApplyTitle(event.target.checked)} />保存标题</label>
        <label><input type="checkbox" checked={applyTags} onChange={(event) => setApplyTags(event.target.checked)} />保存标签</label>
        <label><input type="checkbox" checked={applySummary} onChange={(event) => setApplySummary(event.target.checked)} />保存摘要</label>
      </>}
      {message && <p role="status">{message}</p>}
      <div className="edit-actions">
        <button type="button" disabled={busy || !settings?.enabled} onClick={() => { void generate(); }}>生成建议</button>
        <button type="button" className="secondary-button" disabled={!!writeRef.current || (!draft && !busy)} onClick={cancel}>取消</button>
        {draft?.state === 'ready' && <button type="button" disabled={busy || (applyTitle && !live)} onClick={() => { void confirm(); }}>确认这条建议</button>}
        {operationId && <button type="button" disabled={busy || !live} onClick={() => { void undoTitle(); }}>撤销标题</button>}
      </div>
      {receipt && <OperationNotice key={receipt.operationId} profileId={profileId} result={receipt} onHistory={onHistory} />}
    </section>
  );
}
