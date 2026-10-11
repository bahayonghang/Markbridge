import { useEffect, useRef, useState } from 'react';
import type { AiSuggestion } from '@markbridge/protocol';
import { applyAi, applyEdit, cancelAi, suggestAi } from '../../backend';

let nextRequest = 0;

export function AiSuggest({ profileId, chromeId, url, revision }: {
  profileId: string;
  chromeId: string;
  url: string | null;
  revision: number;
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
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    const previous = requestRef.current;
    requestRef.current = null;
    if (previous) void cancelAi(previous);
    setDraft(null);
    setMessage(null);
  }, [profileId, chromeId, url, revision]);

  useEffect(() => {
    setOperationId(null);
  }, [profileId, chromeId, url]);

  async function generate() {
    const current = ++generation.current;
    const requestId = `ai${nextRequest}`;
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
    generation.current += 1;
    const requestId = requestRef.current;
    requestRef.current = null;
    if (requestId) void cancelAi(requestId);
    setDraft(null);
    setBusy(false);
    setMessage('已取消。结果不会写入书签。');
  }

  async function confirm() {
    if (!draft || draft.state !== 'ready') return;
    if (!applyTitle && !applyTags && !applySummary) {
      setMessage('请选择要保存的标题、标签或摘要。');
      return;
    }
    const current = generation.current;
    setBusy(true);
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
      if (generation.current !== current) return;
      if (result.failure) {
        setMessage(result.failureMessage ?? '没有写入书签。');
        return;
      }
      if (result.browser) setOperationId(result.browser.operationId);
      setDraft(null);
      setMessage(result.browser ? '标题已提交。可在记录中撤销。' : '本地标签或摘要已保存。');
    } catch {
      if (generation.current === current) setMessage('没有写入书签。');
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const scope = draft ? `输入范围：${draft.scope.includesTitle ? '标题' : '不含标题'}，${draft.scope.includesUrl ? '网址' : '不含网址'}，${draft.scope.includesCachedText ? `缓存正文 ${draft.scope.excerptChars} 字` : '不含缓存正文'}。` : null;

  return (
    <section className="ai-desk" aria-label="AI 建议">
      <h4>单条建议</h4>
      <p className="secondary">生成前不会请求模型。建议可以修改。确认后标题走浏览器写入，标签和摘要留在本机。</p>
      {draft && <>
        <p>端点 {draft.endpointLabel ?? '未记录'} · 模型 {draft.model ?? '未记录'}</p>
        {scope && <p className="secondary">{scope}</p>}
        {draft.suggestedFolder && <p className="secondary">建议文件夹：{draft.suggestedFolder}。不会移动书签。</p>}
      </>}
      {draft?.state === 'ready' && <>
        <label htmlFor={`ai-title-${chromeId}`}>建议标题<input id={`ai-title-${chromeId}`} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        {tags.map((tag, index) => <label key={index} htmlFor={`ai-tag-${chromeId}-${index}`}>标签 {index + 1}<input id={`ai-tag-${chromeId}-${index}`} value={tag} onChange={(event) => setTags((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}
        <label htmlFor={`ai-summary-${chromeId}`}>摘要<textarea id={`ai-summary-${chromeId}`} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label><input type="checkbox" checked={applyTitle} onChange={(event) => setApplyTitle(event.target.checked)} />保存标题</label>
        <label><input type="checkbox" checked={applyTags} onChange={(event) => setApplyTags(event.target.checked)} />保存标签</label>
        <label><input type="checkbox" checked={applySummary} onChange={(event) => setApplySummary(event.target.checked)} />保存摘要</label>
      </>}
      {message && <p role="status">{message}</p>}
      <div className="edit-actions">
        <button type="button" disabled={busy} onClick={() => { void generate(); }}>生成建议</button>
        <button type="button" className="secondary-button" onClick={cancel}>取消</button>
        {draft?.state === 'ready' && <button type="button" disabled={busy} onClick={() => { void confirm(); }}>确认这条建议</button>}
        {operationId && <button type="button" onClick={() => { void applyEdit(profileId, revision, { kind: 'undo', operationId }, false).then(() => { setOperationId(null); setMessage('已提交撤销。'); }, () => setMessage('撤销未发送。')); }}>撤销标题</button>}
      </div>
    </section>
  );
}
