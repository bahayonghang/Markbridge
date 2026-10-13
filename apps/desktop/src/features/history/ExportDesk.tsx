import { useEffect, useRef, useState } from 'react';
import type { ExportSaveResult, ExportSource } from '@markbridge/protocol';
import { saveExport } from '../../backend';

export function ExportDesk(props: { source: ExportSource; name: string; cachedAt: number | null }) {
  return <ExportContent key={`${props.source.kind}:${props.source.id}`} {...props} />;
}
function ExportContent({ source, name, cachedAt }: { source: ExportSource; name: string; cachedAt: number | null }) {
  const [result, setResult] = useState<ExportSaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(format: 'html' | 'sidecar') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false); setResult(null);
    try {
      const value = await saveExport(source, format);
      if (!alive.current) return;
      if (value.metadata && (value.metadata.source.kind !== source.kind || value.metadata.source.id !== source.id || value.metadata.format !== format)) throw new Error('WRONG_EXPORT');
      setResult(value);
    } catch { if (alive.current) setError(true); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="export-desk" aria-label="备份导出">
    <p className="secondary">{name} · {source.kind === 'mirror' ? '只读文件缓存' : '本地书签缓存'} · 缓存时间：{cachedAt == null ? '未知' : new Date(cachedAt).toLocaleString('zh-CN')}</p>
    <div className="export-row"><div><h4>书签 HTML</h4><p>保留标题、网址、文件夹和顺序，可供浏览器导入。</p></div><button type="button" disabled={busy} onClick={() => void save('html')}>导出 HTML</button></div>
    {source.kind === 'profile' ? <div className="export-row"><div><h4>本地侧车 JSON</h4><p>保留标签、备注、摘要和本地身份。它不是全库恢复文件。</p></div><button type="button" disabled={busy} onClick={() => void save('sidecar')}>导出侧车 JSON</button></div> : <p className="secondary">此文件来源没有本地侧车数据。</p>}
    <p className="secondary">保存时捕获完整缓存，不需要连接 Chrome。</p>
    {busy && <p role="status">请在系统对话框选择保存位置。</p>}
    {result?.status === 'saved' && <div role="status"><p>文件已保存到所选位置。</p><p className="secondary">{result.metadata?.displayName} · 缓存版本 {result.metadata?.revision} · 缓存时间 {result.metadata?.cachedAt == null ? '未知' : new Date(result.metadata.cachedAt).toLocaleString('zh-CN')}</p></div>}
    {result?.status === 'cancelled' && <p role="status">已取消保存，没有生成文件。</p>}
    {(error || result?.status === 'failed') && <p role="alert">文件未保存。请检查目标位置的权限和可用空间，然后重试。</p>}
  </section>;
}
