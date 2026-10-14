import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SemanticSettings as Settings, SemanticModelCheck } from '@markbridge/protocol';
import { checkSemanticModel, saveSemanticConfig, semanticSettings } from '../../backend';
import { semanticFailureText } from './model';

export function SemanticSettings({ native, active }: { native: boolean; active: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [model, setModel] = useState('');
  const [check, setCheck] = useState<SemanticModelCheck | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), lock = useRef(false), dirty = useRef(false);
  const current = useRef(active); current.current = active;

  useEffect(() => {
    const token = ++generation.current;
    lock.current = false; setBusy(false);
    if (!native || !active) return;
    void semanticSettings().then(value => {
      if (generation.current !== token || !current.current) return;
      setSettings(value);
      if (!dirty.current) {
        setEnabled(value.enabled); setEndpoint(value.endpointLabel ?? 'http://localhost:11434'); setModel(value.model ?? '');
      }
    }, () => { if (generation.current === token && current.current) setMessage('无法读取语义配置。请重新打开此设置页。'); });
    return () => { generation.current += 1; };
  }, [native, active]);

  function changed() { dirty.current = true; setCheck(null); setMessage(''); }

  async function run(work: (token: number) => Promise<void>) {
    if (!native || !active || lock.current || !settings) return;
    lock.current = true; setBusy(true); setMessage('');
    const token = ++generation.current;
    try { await work(token); }
    catch { if (generation.current === token && current.current) setMessage('操作未完成。请检查本机地址和模型名称后重试。'); }
    finally { if (generation.current === token && current.current) { lock.current = false; setBusy(false); } }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (enabled && (!endpoint.trim() || !model.trim())) { setMessage('启用前请填写本机 Ollama 地址和模型名称。'); return; }
    void run(async token => {
      const value = await saveSemanticConfig({ enabled, endpoint: endpoint.trim() || null, model: model.trim() || null });
      if (generation.current !== token || !current.current) return;
      dirty.current = false; setSettings(value); setCheck(null);
      setMessage(value.enabled ? '语义配置已保存。选择并审查范围后，才会建立索引。' : '语义检索已关闭。普通搜索、标签和摘要保留。');
    });
  }

  return <section className="connection-panel semantic-settings" aria-labelledby="semantic-settings-title">
    <div className="panel-heading"><h2 id="semantic-settings-title">本地语义检索</h2><span className="secondary">{settings?.enabled ? '已启用' : '默认关闭'}</span></div>
    <p className="secondary">使用本机模型按意思寻找书签。与 AI 建议分别配置，普通搜索始终可用。</p>
    <p className="secondary">只发送书签标题与已保存摘要，不追加网址、本地标签、备注或正文。确认范围后才发送；不抓取网页，也不下载模型。</p>
    <form className="semantic-config-form" onSubmit={save} noValidate>
      <label className="check-label"><input type="checkbox" checked={enabled} disabled={!native || !settings || busy} onChange={event => { changed(); setEnabled(event.target.checked); }} />启用本地语义检索</label>
      <label>本机 Ollama 地址<input value={endpoint} maxLength={512} spellCheck={false} autoCapitalize="off" disabled={!native || !settings || busy} onChange={event => { changed(); setEndpoint(event.target.value); }} /></label>
      <label>向量模型<input value={model} maxLength={128} placeholder="已安装的模型名称" spellCheck={false} autoCapitalize="off" disabled={!native || !settings || busy} onChange={event => { changed(); setModel(event.target.value); }} /></label>
      <div className="edit-actions"><button type="submit" disabled={!native || !settings || busy}>保存语义配置</button><button type="button" disabled={!native || !settings || busy || !endpoint.trim() || !model.trim()} onClick={() => {
        void run(async token => {
          const value = await checkSemanticModel(endpoint.trim(), model.trim());
          if (generation.current !== token || !current.current) return;
          setCheck(value); setMessage(value.available ? '本地模型可用。尚未发送书签内容。' : semanticFailureText(value.failure));
        });
      }}>检查本地模型</button></div>
    </form>
    <p className="secondary">保存不会连接模型。检查按钮只读取本机模型信息；不生成向量。</p>
    <p className="secondary">每次最多授权 10,000 个书签。确认前展示数量、裁剪和空间上界；每条向量最多 16 KiB，另有 SQLite 开销与模型自身空间。</p>
    <p className="secondary">更换地址、模型或模型版本后，需要重新审查范围并建立索引。关闭会停止语义工作，已保存的索引仍可在语义工作区删除。</p>
    {check?.available && <dl className="semantic-facts"><dt>本地模型</dt><dd>{check.model}</dd><dt>向量维度</dt><dd>{check.dimension ?? '建立索引时确认'}</dd></dl>}
    {busy && <p role="status">正在完成你请求的操作。</p>}
    {message && <p role="status">{message}</p>}
    {!native && <p className="secondary">浏览器预览不能访问本机模型。请在桌面应用中配置。</p>}
  </section>;
}
