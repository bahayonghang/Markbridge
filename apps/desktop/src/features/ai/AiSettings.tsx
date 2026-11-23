import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiSettings as AiSettingsDto } from '@markbridge/protocol';
import { aiSettings, clearAiCredential, saveAiConfig, setAiCredential, testAiConnection } from '../../backend';

const empty: AiSettingsDto = {
  enabled: false,
  provider: null,
  endpointLabel: null,
  model: null,
  credentialConfigured: false,
  schemaSupported: null,
};
const credentialFailure = '密钥未保存。请检查系统凭据服务是否已解锁，再重试。';

export function AiSettings({ native }: { native: boolean }) {
  const [settings, setSettings] = useState<AiSettingsDto>(empty);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const secretRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!native) return () => { mounted.current = false; };
    void aiSettings().then(
      (value) => {
        if (!mounted.current) return;
        setSettings(value);
        setEnabled(value.enabled);
        setProvider(value.provider ?? '');
        setBaseUrl(value.endpointLabel ?? '');
        setModel(value.model ?? '');
      },
      () => {
        if (mounted.current) setMessage('无法读取 AI 配置。');
      },
    );
    return () => { mounted.current = false; };
  }, [native]);

  async function run(work: () => Promise<void>, failure = '操作未完成。没有发送页面内容。') {
    if (!native || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      if (mounted.current) setMessage(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const next = await saveAiConfig(enabled, provider, baseUrl.trim(), model.trim());
      if (!mounted.current) return;
      setSettings(next);
      setMessage(next.enabled ? '已保存端点和模型。' : 'AI 未启用。');
    });
  }

  function storeSecret() {
    const input = secretRef.current;
    const secret = input?.value.trim() ?? '';
    if (!secret) {
      setMessage('请输入密钥。密钥不会写入页面状态。');
      return;
    }
    if (input) input.value = '';
    void run(async () => {
      const next = await setAiCredential(secret);
      if (input) input.value = '';
      if (!mounted.current) return;
      setSettings(next);
      setMessage(next.credentialConfigured ? '密钥已保存到系统凭据存储。' : credentialFailure);
    }, credentialFailure);
  }

  function clearSecret() {
    const input = secretRef.current;
    if (input) input.value = '';
    void run(async () => {
      const next = await clearAiCredential();
      if (!mounted.current) return;
      setSettings(next);
      setMessage('已清除已保存的密钥。');
    });
  }

  const schema = settings.schemaSupported === true ? '端点接受结构化输出' : settings.schemaSupported === false ? '使用本地格式校验' : '尚未测试连接';

  return (
    <section className="connection-panel ai-desk" aria-labelledby="ai-settings-title">
      <div className="panel-heading"><h2 id="ai-settings-title">AI 建议</h2><span className="secondary">{settings.enabled ? '已启用' : '默认关闭'}</span></div>
      <p className="secondary settings-desk-intro">模型只生成可编辑建议。确认前不写书签。密钥只进入系统凭据存储。</p>
      <div className="well-group">
        <h3 className="settings-group-title">提供者与模型</h3>
        <form className="ai-config-form" onSubmit={save} noValidate>
          <div className="settings-row"><div><span>AI 建议</span><p>开启后仍需主动生成，并逐项审查。</p></div><label className="ai-enabled-control"><input id="ai-enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!native || busy} />启用 AI</label></div>
          <div className="settings-row"><label htmlFor="ai-provider">提供者</label>
            <select id="ai-provider" value={provider} onChange={(event) => setProvider(event.target.value)} disabled={!native || busy}>
              <option value="">未选择</option>
              <option value="ollama">Ollama</option>
              <option value="compatible">兼容端点</option>
            </select>
          </div>
          <div className="settings-row"><label htmlFor="ai-endpoint">端点</label><input id="ai-endpoint" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={!native || busy} spellCheck={false} autoCapitalize="off" /></div>
          <div className="settings-row"><label htmlFor="ai-model">模型</label><input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={!native || busy} spellCheck={false} autoCapitalize="off" /></div>
          <button type="submit" className="primary-button" disabled={!native || busy}>保存配置</button>
        </form>
      </div>
      <div className="well-group">
        <h3 className="settings-group-title">凭据与连接测试</h3>
        <div className="settings-facts">
          <span>{settings.credentialConfigured ? '已保存密钥' : '未保存密钥'}</span>
          <span>{schema}</span>
        </div>
        <p className="secondary">保存配置不会连接模型。测试连接仅发送测试提示；书签内容只在整理页主动生成时发送。</p>
        <div className="settings-row"><label htmlFor="ai-secret">模型密钥</label><input id="ai-secret" ref={secretRef} type="password" autoComplete="new-password" spellCheck={false} disabled={!native || busy} /></div>
        <div className="edit-actions">
          <button type="button" disabled={!native || busy} onClick={storeSecret}>保存密钥</button>
          <button type="button" disabled={!native || busy} onClick={clearSecret}>清除凭据</button>
          <button type="button" disabled={!native || busy} onClick={() => {
            void run(async () => {
              const result = await testAiConnection();
              if (!mounted.current) return;
              setSettings(result.settings);
              setMessage(result.ok ? '连接可用。' : result.failureMessage ?? '无法连接模型端点。没有写入书签。');
            });
          }}>测试连接</button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
