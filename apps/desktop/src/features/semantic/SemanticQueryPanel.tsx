import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SemanticIndex, SemanticQueryResult } from '@markbridge/protocol';
import { cancelSemanticQuery, querySemantic } from '../../backend';
import { semanticFailureText } from './model';

export function SemanticQueryPanel({ profileId, sourceEpoch, visit, revision, refreshVersion, index, enabled, active, onSelect }: {
  profileId: string; sourceEpoch: number; visit: number; revision: number; refreshVersion: number;
  index: SemanticIndex; enabled: boolean; active: boolean; onSelect: (chromeId: string) => boolean;
}) {
  const [text, setText] = useState('');
  const [response, setResponse] = useState<{ value: SemanticQueryResult; binding: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const request = useRef<{ profileId: string; id: string } | null>(null);
  const canQuery = enabled && index.ready > 0 && (index.phase === 'ready' || index.phase === 'paused');
  const binding = JSON.stringify([profileId, sourceEpoch, visit, revision, refreshVersion, index.indexId, index.generation, active, canQuery]);
  const current = useRef(binding); current.current = binding;
  const result = response?.binding === binding ? response.value : null;

  function stop() {
    generation.current += 1;
    const old = request.current; request.current = null;
    if (old) void cancelSemanticQuery(old.profileId, old.id).catch(() => {});
  }

  useEffect(() => {
    stop(); setResponse(null); setBusy(false); setMessage('');
    return stop;
  }, [binding]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!active || !canQuery || request.current) return;
    if (!text.trim() || Array.from(text).length > 4096 || new TextEncoder().encode(text).length > 16 * 1024) {
      setMessage('请输入 1–4,096 个字符，且不超过 16 KiB。'); return;
    }
    stop();
    const token = generation.current, context = binding, id = `sq-${crypto.randomUUID()}`;
    request.current = { profileId, id };
    setBusy(true); setMessage(''); setResponse(null);
    try {
      const value = await querySemantic({ requestId: id, profileId, sourceEpoch, indexId: index.indexId, generation: index.generation, text, topK: 5 });
      if (generation.current !== token || current.current !== context) return;
      if (value.requestId !== id || value.profileId !== profileId || value.sourceEpoch !== sourceEpoch || value.indexId !== index.indexId || value.generation !== index.generation) {
        setMessage('查询状态已变化。请重新提交。'); return;
      }
      if (value.failure) setMessage(semanticFailureText(value.failure));
      else setResponse({ value, binding: context });
    } catch { if (generation.current === token && current.current === context) setMessage('查询未完成。请检查本地模型后重新提交。'); }
    finally {
      if (generation.current === token && current.current === context) { request.current = null; setBusy(false); }
    }
  }

  return <section className="semantic-query" aria-labelledby="semantic-query-title" aria-busy={busy}>
    <h3 id="semantic-query-title">按意思查找</h3>
    <p className="secondary">点击查询时才将这段文字发送给本机模型。使用当前索引的模型与版本，最多显示 5 个结果。</p>
    <form className="semantic-query-form" onSubmit={submit} noValidate>
      <label>描述想找的内容<input value={text} maxLength={8192} disabled={!enabled} onChange={event => {
        stop(); setText(event.target.value); setResponse(null); setBusy(false); setMessage('');
      }} /></label>
      <button type="submit" disabled={!active || !canQuery || busy || !text.trim()}>查询语义索引</button>
      {busy && <button type="button" onClick={() => { stop(); setBusy(false); setMessage('查询已取消。'); }}>取消查询</button>}
    </form>
    {!canQuery && <p className="secondary">{!enabled ? '语义检索已关闭。普通搜索仍可使用。' : index.phase === 'running' ? '索引正在建立。完成或暂停后，可检索已完成的条目。' : '当前没有可用向量。请检查模型或重新建立索引。'}</p>}
    {index.phase === 'paused' && index.ready > 0 && enabled && <p className="secondary">索引已暂停，查询只使用已完成的 {index.ready} 个书签。</p>}
    {busy && <p role="status">正在查询本地模型与索引。</p>}
    {message && <p role="status">{message}</p>}
    {result && <>
      <p role="status">{result.hits.length ? `找到 ${result.hits.length} 个结果。相似度是排序分数，不代表准确率。` : '没有可显示的结果。请尝试其他描述，或补充摘要后更新索引。'}</p>
      <ol className="semantic-hits" aria-label="语义查询结果">{result.hits.map(hit => <li key={hit.bookmarkId}>
        <button type="button" className="semantic-hit" onClick={() => { if (!onSelect(hit.chromeId)) setMessage('这条书签已改变或离开当前资料。请刷新后重新查询。'); }}>
          <span>{hit.title || '未命名书签'}</span><span className="secondary">相似度 {hit.score.toFixed(3)}</span>
        </button>
      </li>)}</ol>
    </>}
  </section>;
}
