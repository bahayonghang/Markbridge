import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BridgeState, PairingOffer } from '@markbridge/protocol';
import {
  beginPairing, cancelPairing, confirmPairing, hasNativeBridge,
  reconnectProfile, revokePairing, startBridge,
} from './backend';
import { useBridge } from './useBridge';

const connectionLabels: Record<BridgeState['profiles'][number]['connection'], string> = {
  unpaired: '未配对 · 只读', connecting: '连接中 · 只读', reconciling: '核对中 · 只读',
  live: '实时同步', cached_read_only: '缓存 · 只读', error: '连接错误 · 只读',
};

function safeError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'CONFLICT') return '连接状态发生冲突。请检查端口和扩展后重试。';
  if (code === 'STORAGE_ERROR') return '无法读取本机缓存。请重新打开应用。';
  return '连接不可用。请检查扩展状态后重试。';
}

export function App() {
  const { state, error, accept } = useBridge();
  const native = hasNativeBridge();
  const [port, setPort] = useState('49153');
  const [displayName, setDisplayName] = useState('Chrome 资料');
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const actionGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionGeneration.current += 1; };
  }, []);

  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(() => {
      setOffer(null);
      setMessage('配对串已到期。请取消旧配对后重新生成。');
    }, Math.max(0, offer.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [offer]);

  useEffect(() => {
    if (offer && state?.profiles.some((profile) => profile.profileId === offer.profileId)) setOffer(null);
  }, [state, offer]);

  async function act(work: () => Promise<void>, failure = '操作未完成。请检查连接状态后重试。') {
    if (busy || !native) return;
    const generation = ++actionGeneration.current;
    setBusy(true);
    setMessage(null);
    try { await work(); } catch {
      if (mounted.current && generation === actionGeneration.current) {
        setMessage(failure);
      }
    } finally {
      if (mounted.current && generation === actionGeneration.current) setBusy(false);
    }
  }

  function start(event: FormEvent) {
    event.preventDefault();
    const value = Number(port);
    if (!/^\d+$/.test(port) || !Number.isInteger(value) || value < 1024 || value > 65535) {
      setMessage('端口必须是 1024–65535 之间的整数。');
      return;
    }
    void act(async () => { accept(await startBridge(value)); }, '无法启动本机连接。请检查端口是否占用，或更换端口后重试。');
  }

  function pair(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || [...name].length > 128) { setMessage('资料名称须为 1–128 个字符。'); return; }
    void act(async () => {
      const next = await beginPairing(name);
      if (mounted.current) setOffer(next);
    });
  }

  const pending = state?.pending ?? [];
  const title = !state ? '正在加载' : state.profiles.some((profile) => profile.connection === 'live')
    ? '已连接 Chrome' : '未连接 · 只读';
  const unavailable = !native || busy || !state || error === 'event';

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">跳至内容</a>
      <header className="app-header">
        <div><strong lang="en">Markbridge</strong><span className="product-name">签桥</span></div>
        <span className="connection" role="status">{error === 'startup' ? '启动失败' : error === 'event' ? '连接错误 · 只读' : title}</span>
      </header>
      <main id="main-content">
        <div className="section-heading"><h1>Chrome 连接</h1><span>本机同步</span></div>
        {error === 'startup' ? (
          <section className="empty-state" role="alert">
            <h2>无法读取启动状态</h2><p>请关闭窗口后重新打开应用。</p>
          </section>
        ) : (
          <>
            {!native && <p className="preview-note">浏览器预览 · 仅显示界面。配对和连接操作需在桌面应用中进行。</p>}
            {(message || state?.errorCode || error === 'event') && <p className="notice" role="alert">
              {message ?? (error === 'event' ? '收到无效连接状态。请重新打开应用。' : safeError(state?.errorCode ?? null))}
            </p>}
            <section className="connection-panel" aria-labelledby="listener-title">
              <div className="panel-heading"><h2 id="listener-title">本机连接</h2><span className="secondary">{state?.port ? `127.0.0.1:${state.port}` : '监听尚未启动'}</span></div>
              <form className="inline-form" onSubmit={start} noValidate>
                <label htmlFor="bridge-port">端口<input id="bridge-port" inputMode="numeric" value={state?.port?.toString() ?? port} onChange={(event) => setPort(event.target.value)} disabled={unavailable || state?.port != null} /></label>
                <button disabled={unavailable || state?.port != null} type="submit">{state?.port ? '连接已启动' : '启动连接'}</button>
              </form>
              <p className="secondary">默认端口 49153。端口占用时，更换端口后重试。</p>
            </section>
            <section className="connection-panel" aria-labelledby="pairing-title">
              <div className="panel-heading"><h2 id="pairing-title">配对 Chrome 扩展</h2><span className="secondary">需在两端确认</span></div>
              <form className="inline-form" onSubmit={pair} noValidate>
                <label htmlFor="profile-name">资料名称<input id="profile-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={unavailable || pending.length > 0} /></label>
                <button type="submit" disabled={unavailable || !state?.port || pending.length > 0 || !!offer}>生成配对串</button>
              </form>
              <p className="secondary">复制配对串到扩展选项页，再核对下方的扩展身份。配对串有效期为 120 秒。</p>
              {offer && <div className="pairing-offer">
                <label htmlFor="pairing-code">一次性配对串<textarea id="pairing-code" readOnly value={offer.pairingCode} spellCheck={false} /></label>
                <div className="actions">
                  <button disabled={busy} onClick={() => { void act(async () => { await navigator.clipboard.writeText(offer.pairingCode); if (mounted.current) setMessage('配对串已复制。请粘贴到扩展选项页。'); }); }}>复制配对串</button>
                  {!pending.some((candidate) => candidate.profileId === offer.profileId) && <button disabled={busy} onClick={() => { void act(async () => { accept(await cancelPairing(offer.profileId)); if (mounted.current) setOffer(null); }); }}>取消配对</button>}
                </div>
              </div>}
              {pending.map((candidate) => <div className="pending-pair" key={candidate.profileId}>
                <h3>{candidate.displayName}</h3>
                {candidate.instanceId && candidate.origin ? <>
                  <p>核对已验证的扩展身份后确认配对。</p>
                  <dl className="identity"><dt>扩展身份</dt><dd>{candidate.instanceId}</dd><dt>扩展来源</dt><dd>{candidate.origin}</dd></dl>
                  <button disabled={unavailable} onClick={() => { void act(async () => { accept(await confirmPairing(candidate.profileId, candidate.instanceId!)); if (mounted.current) setOffer(null); }); }}>确认此扩展</button>
                </> : <p>等待扩展连接。请将配对串粘贴到扩展选项页。</p>}
                <button className="secondary-button" disabled={unavailable} onClick={() => { void act(async () => { accept(await cancelPairing(candidate.profileId)); if (mounted.current) setOffer(null); }); }}>取消配对</button>
              </div>)}
            </section>
            <section className="connection-panel" aria-labelledby="profiles-title">
              <div className="panel-heading"><h2 id="profiles-title">已配对资料</h2><span className="secondary">{state?.profiles.length ?? 0} 个资料</span></div>
              {!state?.profiles.length ? <p className="secondary">尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。</p> : state.profiles.map((profile) => <article className="profile" key={profile.profileId}>
                <div className="panel-heading"><h3>{profile.displayName}</h3><span className="source-state">{error === 'event' ? '状态无效 · 只读' : connectionLabels[profile.connection]}</span></div>
                <dl className="profile-metrics"><div><dt>缓存节点</dt><dd>{profile.nodeCount}</dd></div><div><dt>来源版本</dt><dd>{profile.revision}</dd></div><div><dt>最近同步</dt><dd>{profile.lastSyncedAt === null ? '尚未同步' : new Date(profile.lastSyncedAt).toLocaleString('zh-CN', { hour12: false })}</dd></div></dl>
                {profile.errorCode && <p className="secondary">{safeError(profile.errorCode)}</p>}
                <p className="secondary">{profile.connection === 'live' && !error ? '已完成全树核对。当前页面仅提供同步诊断。' : '浏览器写入已禁用，保留本机缓存供只读查看。'}</p>
                <div className="actions">
                  <button disabled={unavailable || profile.connection === 'unpaired'} onClick={() => { void act(async () => { accept(await reconnectProfile(profile.profileId)); }); }}>重新连接</button>
                  <button className="secondary-button" disabled={unavailable || profile.connection === 'unpaired'} onClick={() => { void act(async () => { accept(await revokePairing(profile.profileId)); }); }}>吊销配对</button>
                </div>
              </article>)}
            </section>
          </>
        )}
      </main>
      <footer>书签保留在 Chrome；标签和备注保留在本机。</footer>
    </div>
  );
}
