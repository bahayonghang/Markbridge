import { useEffect, useRef, useState } from 'react';
import type { DiagnosticSaveResult } from '@markbridge/protocol';
import { saveDiagnostics } from '../../backend';

export function DiagnosticExport({ native }: { native: boolean }) {
  const [result, setResult] = useState<DiagnosticSaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save() {
    if (!native || locked.current) return;
    locked.current = true; setBusy(true); setError(false); setResult(null);
    try {
      const value = await saveDiagnostics();
      if (alive.current) setResult(value);
    } catch { if (alive.current) setError(true); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="connection-panel" aria-label="诊断导出">
    <div className="panel-heading"><h2>诊断导出</h2></div>
    <p className="secondary">保存版本、系统类型和连接状态汇总，无需 Chrome 在线，不自动上传。</p>
    <p className="secondary">不含书签内容、资料名称、本机路径、密钥或模型配置。文件只在本机保存。</p>
    <button type="button" disabled={!native || busy} onClick={() => void save()}>导出诊断 JSON</button>
    {busy && <p role="status">请在系统对话框选择保存位置。</p>}
    {result?.status === 'saved' && <p role="status">诊断文件已保存到所选位置。</p>}
    {result?.status === 'cancelled' && <p role="status">已取消保存，没有生成诊断文件。</p>}
    {(error || result?.status === 'failed') && <p role="alert">诊断文件未保存。请检查目标位置的权限和可用空间，然后重试。</p>}
  </section>;
}
