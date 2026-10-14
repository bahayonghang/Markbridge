import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode, SemanticScopeReview, SemanticStatus } from '@markbridge/protocol';
import { deleteSemanticIndex, pauseSemanticIndex, resumeSemanticIndex, reviewSemanticScope, saveSemanticConfig, semanticStatus, startSemanticIndex } from '../../backend';
import { displayTitle, folderPath, indexFlat } from '../library/model';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { SemanticQueryPanel } from './SemanticQueryPanel';
import { indexBytes, semanticFailureText } from './model';

export function SemanticWorkspace({ profileId, profileName, sourceEpoch, revision, visit, refreshVersion, active, nodes, selected, folderId, onLibrary, onSettings, onSelect }: {
  profileId: string; profileName: string; sourceEpoch: number; revision: number; visit: number; refreshVersion: number; active: boolean;
  nodes: BookmarkNode[]; selected: BookmarkNode[]; folderId: string | null;
  onLibrary?: () => void; onSettings?: () => void; onSelect: (chromeId: string) => boolean;
}) {
  const [statusSnapshot, setStatusSnapshot] = useState<{ value: SemanticStatus; binding: string } | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<{ value: SemanticScopeReview; binding: string } | null>(null);
  const [scopeName, setScopeName] = useState('');
  const [mode, setMode] = useState<'selection' | 'folder'>('selection');
  const [chosenFolder, setChosenFolder] = useState(folderId ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const action = useRef(0), lock = useRef(false), mounted = useRef(true), poll = useRef(0);
  const workKind = useRef<'review' | 'action' | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const binding = JSON.stringify([profileId, sourceEpoch, revision, visit, refreshVersion, active]);
  const scopeBinding = JSON.stringify([binding, mode, mode === 'selection' ? selected.map(node => node.chromeId) : chosenFolder]);
  const currentScope = useRef(scopeBinding); currentScope.current = scopeBinding;
  const status = statusSnapshot?.binding === binding ? statusSnapshot.value : null;
  const review = reviewSnapshot?.binding === scopeBinding ? reviewSnapshot.value : null;
  function setReview(value: SemanticScopeReview | null) { setReviewSnapshot(value ? { value, binding: scopeBinding } : null); }
  const current = useRef(binding); current.current = binding;
  const flat = useMemo(() => indexFlat(nodes), [nodes]);
  const folders = useMemo(() => nodes.filter(node => node.kind === 'folder').map(node => ({ id: node.chromeId,
    name: folderPath(flat, node.chromeId).map(item => displayTitle(item.title)).join(' / ') })), [nodes, flat]);
  const index = status?.index ?? null;
  const enabled = status?.settings.enabled ?? false;
  const ready = !!status && !busy && active;

  function accept(value: SemanticStatus): boolean {
    if (value.index && (value.index.profileId !== profileId || value.index.sourceEpoch !== sourceEpoch)) {
      setMessage('索引身份与当前资料不一致。请重新打开此工作区。'); return false;
    }
    setStatusSnapshot({ value, binding }); return true;
  }

  useEffect(() => {
    mounted.current = true;
    const token = ++action.current, context = binding;
    lock.current = false; workKind.current = null; setBusy(false); setReview(null); setDeleting(false); setMessage('');
    if (active) void semanticStatus(profileId, sourceEpoch).then(value => {
      if (mounted.current && current.current === context && action.current === token) accept(value);
    }, () => { if (mounted.current && current.current === context && action.current === token) setMessage('无法读取本地索引状态。请点击刷新状态。'); });
    return () => { mounted.current = false; action.current += 1; poll.current += 1; };
  }, [binding, profileId, sourceEpoch]);

  useEffect(() => {
    setReview(null);
    if (workKind.current === 'review') {
      action.current += 1; lock.current = false; workKind.current = null; setBusy(false);
      setMessage('范围已改变，旧审查已取消。请重新审查。');
    }
  }, [scopeBinding]);

  useEffect(() => {
    if (!active || busy || index?.phase !== 'running') return;
    const token = ++poll.current, context = binding, owner = action.current;
    let disposed = false, reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void semanticStatus(profileId, sourceEpoch).then(value => {
        if (!disposed && mounted.current && poll.current === token && action.current === owner && current.current === context) accept(value);
      }, () => {
        if (!disposed && mounted.current && poll.current === token && action.current === owner && current.current === context) setMessage('无法刷新索引进度。可手动刷新状态。');
      }).finally(() => { reading = false; });
    }, 750);
    return () => { disposed = true; clearInterval(timer); poll.current += 1; };
  }, [active, busy, index?.phase, index?.indexId, index?.generation, binding, profileId, sourceEpoch]);

  async function run(work: (valid: () => boolean) => Promise<void>, kind: 'review' | 'action' = 'action') {
    if (!active || lock.current) return;
    lock.current = true; setBusy(true); setMessage(''); poll.current += 1;
    workKind.current = kind;
    const token = ++action.current, context = binding;
    const valid = () => mounted.current && action.current === token && current.current === context;
    try { await work(valid); }
    catch { if (valid()) setMessage('语义操作未完成。没有改动书签、标签或摘要。请刷新状态后重试。'); }
    finally { if (valid()) { lock.current = false; workKind.current = null; setBusy(false); } }
  }

  function replaceScope() { setReview(null); setMessage(''); }

  function reviewScope() {
    const context = scopeBinding;
    const selectedChromeIds = mode === 'selection' ? selected.map(node => node.chromeId) : [];
    const name = mode === 'selection' ? '当前勾选的书签' : `${folders.find(folder => folder.id === chosenFolder)?.name ?? '指定目录'}（含子目录）`;
    void run(async valid => {
      const value = await reviewSemanticScope({ profileId, sourceEpoch, expectedRevision: revision, selectedChromeIds, folderId: mode === 'folder' ? chosenFolder : null });
      if (!valid() || currentScope.current !== context) return;
      if (value.profileId !== profileId || value.sourceEpoch !== sourceEpoch || value.expectedRevision !== revision) { setMessage('范围已变化。请重新审查。'); return; }
      setScopeName(name); setReview(value);
    }, 'review');
  }

  const phase = !enabled ? '已关闭' : !index ? '尚未建立' : index.phase === 'running' ? '正在建立索引'
    : index.phase === 'paused' ? '已暂停' : index.phase === 'ready' ? '可以检索' : index.phase === 'stale' ? '需要重新建立'
      : index.failure === 'MISSING_MODEL' || index.failure === 'UNREACHABLE' ? '本地模型不可用' : '建立未完成';
  const resumable = index && index.pending > 0 && (index.phase === 'paused' || index.phase === 'failed')
    && !['MODEL_CHANGED', 'DIMENSION_MISMATCH', 'STALE_INDEX'].includes(index.failure ?? '');

  return <section className="semantic-workspace" aria-label="本地语义工作区">
    <div className="page-intro semantic-heading"><div><h2>本地语义检索</h2><p className="secondary">用标题与已保存摘要建立本机索引。按意思查找，与普通搜索分别使用。</p></div><button type="button" onClick={onLibrary}>返回普通搜索</button></div>
    <div className="scope-bar"><div><strong>{profileName}</strong><p>索引状态：{status ? phase : '正在读取'}</p></div><div className="edit-actions"><button type="button" onClick={onSettings}>语义设置</button><button type="button" disabled={busy} onClick={() => void run(async valid => { const value = await semanticStatus(profileId, sourceEpoch); if (valid()) accept(value); })}>刷新状态</button></div></div>
    {!enabled && status && <p className="secondary">语义检索默认关闭。请在语义设置中选择本机模型并启用，再审查本次范围。</p>}
    {index && <div className="semantic-index" role="region" aria-label="当前语义索引">
      <dl className="semantic-facts"><dt>模型</dt><dd>{index.model}</dd><dt>已完成</dt><dd>{index.ready} / {index.total} 个书签，{index.pending} 个待处理</dd><dt>向量空间</dt><dd>{indexBytes(index.storedBytes)}{index.dimension ? `，${index.dimension} 维` : '，维度尚未确认'}</dd></dl>
      {index.phase === 'running' && <progress max={index.total} value={index.ready} aria-label="索引建立进度" />}
      {index.failure && <p role="status">{semanticFailureText(index.failure)}</p>}
      <div className="edit-actions">
        <button type="button" disabled={!ready || index.phase !== 'running'} onClick={() => void run(async valid => { const value = await pauseSemanticIndex(profileId, sourceEpoch); if (valid() && accept(value)) setMessage('索引已暂停。已完成的条目保留。'); })}>暂停索引</button>
        <button type="button" disabled={!ready || !enabled || !resumable} onClick={() => void run(async valid => { const value = await resumeSemanticIndex(profileId, sourceEpoch); if (valid()) accept(value); })}>继续索引</button>
        <button type="button" ref={deleteTrigger} className="danger-button" disabled={!ready} onClick={() => setDeleting(true)}>删除派生索引</button>
      </div>
    </div>}
    {enabled && <div className="edit-actions"><button type="button" disabled={!ready} onClick={() => void run(async valid => {
      if (!status) return;
      await saveSemanticConfig({ enabled: false, endpoint: status.settings.endpointLabel, model: status.settings.model });
      if (!valid()) return;
      const value = await semanticStatus(profileId, sourceEpoch);
      if (valid() && accept(value)) { setReview(null); setMessage('语义检索已关闭。普通搜索、标签、备注和摘要保留。'); }
    })}>停用语义检索</button></div>}
    {index && <SemanticQueryPanel key={`${index.indexId}:${index.generation}`} profileId={profileId} sourceEpoch={sourceEpoch} visit={visit} revision={revision} refreshVersion={refreshVersion} index={index} enabled={enabled} active={active && !busy} onSelect={onSelect} />}
    <section className="semantic-scope" aria-labelledby="semantic-scope-title">
      <h3 id="semantic-scope-title">审查索引范围</h3>
      <p className="secondary">只发送书签标题与已保存摘要，不追加网址、本地标签、备注或正文。不抓取网页；新增书签不会自动加入。</p>
      <div className="scope-choices" role="radiogroup" aria-label="语义索引范围">
        <label><input type="radio" name="semantic-scope" checked={mode === 'selection'} disabled={!ready || !enabled} onChange={() => { replaceScope(); setMode('selection'); }} />当前选择（{selected.length} 个书签）</label>
        <label><input type="radio" name="semantic-scope" checked={mode === 'folder'} disabled={!ready || !enabled} onChange={() => { replaceScope(); setMode('folder'); }} />指定目录及后代</label>
      </div>
      <div className="edit-actions">{mode === 'folder' && <label>索引目录<select value={chosenFolder} disabled={!ready || !enabled} onChange={event => { replaceScope(); setChosenFolder(event.target.value); }}><option value="">请选择目录</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
        <button type="button" disabled={!ready || !enabled || index?.phase === 'running' || (mode === 'selection' ? !selected.length || selected.length > 10000 : !chosenFolder)} onClick={reviewScope}>审查本次范围</button>
      </div>
      {!selected.length && mode === 'selection' && <p className="secondary">先在书签列表勾选条目，或明确选择一个目录。范围最多 10,000 个书签，超限不会截断。</p>}
      {review && <div className="semantic-review" role="region" aria-label="索引确认审查">
        <h4>确认建立这份索引</h4>
        <dl className="semantic-facts"><dt>资料与范围</dt><dd>{profileName} / {scopeName}</dd><dt>模型</dt><dd>{review.model}</dd><dt>书签数量</dt><dd>{review.count} 个</dd><dt>向量空间上界</dt><dd>{indexBytes(review.upperBytes)}，另加 SQLite 开销与模型自身空间</dd><dt>输入裁剪</dt><dd>{review.clippedCount} 个输入会裁剪；每条最多 {review.maxInputChars.toLocaleString()} 个字符、{indexBytes(review.maxInputBytes)}</dd></dl>
        <p className="secondary">仅处理这次确认的范围。标题或摘要变化会使条目待更新；暂停后须主动继续。已有派生索引会由本次范围替换。</p>
        <div className="edit-actions"><button type="button" className="primary-button" disabled={!ready || !enabled} onClick={() => void run(async valid => { const value = await startSemanticIndex(review.reviewId); if (valid() && accept(value)) setReview(null); })}>确认并建立索引</button><button type="button" disabled={busy} onClick={() => setReview(null)}>取消本次审查</button></div>
      </div>}
    </section>
    {!index && status && <p className="secondary">还没有语义索引。普通搜索不受影响；完成范围确认后可在这里查询。</p>}
    {busy && <p role="status">正在完成你请求的语义操作。</p>}
    {message && <p role="status">{message}</p>}
    {deleting && <ConfirmDialog title="删除这份派生索引？" confirmLabel="确认删除派生索引" returnFocus={deleteTrigger} onCancel={() => setDeleting(false)} onConfirm={() => {
      setDeleting(false); void run(async valid => { const value = await deleteSemanticIndex(profileId, sourceEpoch); if (valid() && accept(value)) { setReview(null); setMessage('派生索引已删除。书签、标签、备注、摘要和普通搜索保留。'); } });
    }}><p>会停止当前语义工作，并删除此资料的向量、索引范围与进度。不会删除书签、标签、备注、摘要、预览或 AI 配置。</p><p>SQLite 文件不一定立即变小。以后可重新审查范围并建立索引。</p></ConfirmDialog>}
  </section>;
}
