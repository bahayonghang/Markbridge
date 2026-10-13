import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BridgeState, ChromeProfileList, PairingOffer } from '@markbridge/protocol';
import {
  associateFileMirror, attachFileMirror, beginPairing, cancelPairing, confirmPairing,
  detachFileMirror, enumerateChromeUserData,
  reconnectProfile, rescanFileMirrors, revokePairing, startBridge,
} from '../../backend';

import { cacheTime, connectionLabels, fileLabels, profileNextStep, type SourceTarget } from './source-status';
import { ConfirmDialog } from './ConfirmDialog';

const associationLabels: Record<BridgeState['mirrors'][number]['association'], string> = {
  independent: '独立只读', confirmed: '已关联 · 只读',
};

function mirrorProblem(code: string | null): string | null {
  if (!code) return null;
  if (code === 'PATH_UNAVAILABLE') return '无法读取所选 Chrome 目录。请重新选择后重试。';
  if (code === 'INVALID_TREE' || code === 'LIMIT_EXCEEDED') return '书签文件暂不可解析。已保留上次有效缓存。';
  return '文件来源暂不可用。已保留上次有效缓存。';
}

function safeError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'CONFLICT') return '连接状态发生冲突。请检查端口和扩展后重试。';
  if (code === 'STORAGE_ERROR') return '无法读取本机缓存。请重新打开应用。';
  return '连接不可用。请检查扩展状态后重试。';
}

export function ConnectionSettings({ state, error, native, accept, onBrowseSource, onboarding = false }: {
  state: BridgeState | null;
  error: 'startup' | 'event' | null;
  native: boolean;
  accept: (state: BridgeState) => void;
  onBrowseSource: (source: SourceTarget) => void;
  onboarding?: boolean;
}) {
  const [port, setPort] = useState('49153');
  const [displayName, setDisplayName] = useState('Chrome 资料');
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState('');
  const [choices, setChoices] = useState<ChromeProfileList['profiles']>([]);
  const [profileChoice, setProfileChoice] = useState('');
  const [path, setPath] = useState<'connect' | 'readonly'>('connect');
  const [revoke, setRevoke] = useState<BridgeState['profiles'][number] | null>(null);
  const [now, setNow] = useState(Date.now);
  const [listedPath, setListedPath] = useState('');
  const mounted = useRef(false);
  const actionGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionGeneration.current += 1; };
  }, []);

  useEffect(() => {
    const deadlines = [...(state?.pending.map((candidate) => candidate.expiresAt) ?? []), ...(offer ? [offer.expiresAt] : [])].filter((deadline) => deadline > now);
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      setMessage('配对串已到期。请重新生成配对串，并在扩展中重新粘贴。');
      setOffer(null);
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [offer, state?.pending, now]);

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
      for (const candidate of state?.pending ?? []) {
        if (candidate.expiresAt <= Date.now()) accept(await cancelPairing(candidate.profileId));
      }
      const next = await beginPairing(name);
      if (mounted.current) setOffer(next);
    });
  }

  const pending = state?.pending.filter((candidate) => candidate.expiresAt > now) ?? [];
  const unavailable = !native || busy || !state || error === 'event';
  return <div className="connection-settings">
    {onboarding && <div className="onboarding-intro">
      <h2>连接你的 Chrome 书签</h2>
      <p>连接扩展后可实时查看和管理书签。无需配置 AI。</p>
      <div className="actions"><button type="button" aria-pressed={path === 'connect'} onClick={() => setPath('connect')}>连接 Chrome</button><button type="button" aria-pressed={path === 'readonly'} onClick={() => setPath('readonly')}>只读浏览文件</button></div>
    </div>}
    {(message || state?.errorCode) && <p className="notice" role="alert">{message ?? safeError(state?.errorCode ?? null)}</p>}
    <div hidden={onboarding && path !== 'connect'}>
    <section className="connection-panel" aria-labelledby="extension-title">
      <h2 id="extension-title">1. 准备 Chrome 扩展</h2>
      <p>在要接入的 Chrome 资料中打开 <code>chrome://extensions</code>，启用开发者模式，选择“加载已解压的扩展程序”，选择 Markbridge 扩展目录。</p>
      <p className="secondary">加载后打开扩展的“配对设置”。应用不会自动安装或扫描 Chrome。</p>
      <details className="connection-advanced"><summary>开发构建：扩展目录</summary><p className="secondary">从源码构建时，扩展目录为 <code>apps/extension/dist</code>。开发和验收请使用单独的临时 Chrome 资料。</p></details>
    </section>
            <section className="connection-panel" aria-labelledby="listener-title">
              <div className="panel-heading"><h2 id="listener-title">2. 启动本机连接</h2><span className="secondary">{state?.port ? `127.0.0.1:${state.port}` : '监听尚未启动'}</span></div>
              <form className="inline-form" onSubmit={start} noValidate>
                <details className="connection-advanced"><summary>高级：连接端口</summary><label htmlFor="bridge-port">端口<input id="bridge-port" inputMode="numeric" value={state?.port?.toString() ?? port} onChange={(event) => setPort(event.target.value)} disabled={unavailable || state?.port != null} /></label></details>
                <button disabled={unavailable || state?.port != null} type="submit">{state?.port ? '连接已启动' : '启动连接'}</button>
              </form>
              <p className="secondary">默认端口 49153。端口占用时，更换端口后重试。</p>
            </section>
            <section className="connection-panel" aria-labelledby="pairing-title">
              <div className="panel-heading"><h2 id="pairing-title">3. 配对 Chrome 扩展</h2><span className="secondary">需在两端确认</span></div>
              <form className="inline-form" onSubmit={pair} noValidate>
                <label htmlFor="profile-name">资料名称<input id="profile-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={unavailable || pending.length > 0} /></label>
                <button type="submit" disabled={unavailable || !state?.port || pending.length > 0 || !!offer}>生成配对串</button>
              </form>
              <p className="secondary">复制配对串到扩展选项页，再核对下方的扩展身份。配对串有效期为 120 秒。</p>
              {offer && <div className="pairing-offer">
                <label htmlFor="pairing-code">一次性配对串<textarea id="pairing-code" readOnly value={offer.pairingCode} spellCheck={false} /></label>
                <div className="actions">
                  <button disabled={busy} onClick={() => { void act(async () => { await navigator.clipboard.writeText(offer.pairingCode); if (mounted.current) setMessage('配对串已复制。请粘贴到扩展选项页。'); }); }}>复制配对串</button>
                  {!pending.some((candidate) => candidate.profileId === offer.profileId) && <button disabled={busy} onClick={() => { void act(async () => { accept(await cancelPairing(offer.profileId)); if (mounted.current) { setOffer(null); setMessage('配对已取消。可重新生成配对串。'); } }); }}>取消配对</button>}
                </div>
              </div>}
              {pending.map((candidate) => <div className="pending-pair" key={candidate.profileId}>
                <h3>{candidate.displayName}</h3><p className="secondary">配对有效至 {cacheTime(candidate.expiresAt)}</p>
                {candidate.instanceId && candidate.origin ? <>
                  <p>请与扩展选项页显示的身份核对。只有你发起的请求才能确认；不认识的请求请取消配对。</p>
                  <dl className="identity"><dt>扩展身份</dt><dd>{candidate.instanceId}</dd><dt>扩展来源</dt><dd>{candidate.origin}</dd></dl>
                  <button disabled={unavailable} onClick={() => { void act(async () => { accept(await confirmPairing(candidate.profileId, candidate.instanceId!)); if (mounted.current) setOffer(null); }); }}>确认此扩展</button>
                </> : <p>等待扩展连接。请将配对串粘贴到扩展选项页。</p>}
                <button className="secondary-button" disabled={unavailable} onClick={() => { void act(async () => { accept(await cancelPairing(candidate.profileId)); if (mounted.current) { setOffer(null); setMessage('配对已取消。可重新生成配对串。'); } }); }}>取消配对</button>
              </div>)}
            </section>
    </div>
            <section className="connection-panel" aria-labelledby="profiles-title" hidden={onboarding && !state?.profiles.length}>
              <div className="panel-heading"><h2 id="profiles-title">已配对资料</h2><span className="secondary">{state?.profiles.length ?? 0} 个资料</span></div>
              {!state?.profiles.length ? <p className="secondary">尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。</p> : state.profiles.map((profile) => <article className="profile" key={profile.profileId}>
                <div className="panel-heading"><h3>{profile.displayName}</h3><span className="source-state">{error === 'event' ? '状态无效 · 只读' : connectionLabels[profile.connection]}</span></div>
                <dl className="profile-metrics"><div><dt>缓存节点</dt><dd>{profile.nodeCount}</dd></div><div><dt>来源版本</dt><dd>{profile.revision}</dd></div><div><dt>最近同步</dt><dd>{cacheTime(profile.lastSyncedAt)}</dd></div></dl>
                {profile.errorCode && <p className="secondary">{safeError(profile.errorCode)}</p>}
                <p className="secondary">{profileNextStep(profile.connection)}</p>
                <div className="actions">
                  <button type="button" disabled={unavailable} onClick={() => onBrowseSource({ kind: 'profile', id: profile.profileId })}>浏览此资料</button>
                  <button disabled={unavailable || profile.connection === 'unpaired'} onClick={() => { void act(async () => { accept(await reconnectProfile(profile.profileId)); }); }}>重新连接</button>
                  <button className="secondary-button" disabled={unavailable || profile.connection === 'unpaired'} onClick={() => setRevoke(profile)}>吊销配对</button>
                </div>
              </article>)}
            </section>
            <section className="connection-panel" aria-labelledby="mirrors-title" hidden={onboarding && path !== 'readonly'}>
              <div className="panel-heading"><h2 id="mirrors-title">只读文件来源</h2><span className="secondary">{state?.mirrors.length ?? 0} 个来源</span></div>
              <p className="secondary">无需扩展，可浏览最后有效的文件缓存。不能写入 Chrome；文件时间不代表实时连接。</p>
              <details className="connection-advanced" open={onboarding || undefined}><summary>选择只读文件目录</summary>
              <form className="inline-form" onSubmit={(event) => {
                event.preventDefault();
                const path = userDataPath.trim();
                if (!path) { setMessage('请输入 Chrome 用户数据目录的绝对路径。'); return; }
                void act(async () => {
                  const listed = await enumerateChromeUserData(path);
                  if (!mounted.current) return;
                  setListedPath(path);
                  setChoices(listed.profiles);
                  if (!listed.profiles.length) setMessage('所选目录中没有可接入的 Chrome 资料。请检查 User Data 路径。');
                }, '无法读取所选 Chrome 目录。请选择本机 User Data 路径后重试。');
              }} noValidate>
                <label htmlFor="user-data-path">用户数据目录<input id="user-data-path" value={userDataPath} onChange={(event) => { setUserDataPath(event.target.value); setChoices([]); }} disabled={unavailable} spellCheck={false} /></label>
                <button type="submit" disabled={unavailable}>枚举资料</button>
                <button type="button" disabled={unavailable || !state?.mirrors.some((mirror) => mirror.watching)} onClick={() => { void act(async () => { accept(await rescanFileMirrors()); }); }}>重新读取</button>
              </form>
              <p className="secondary">只读取 Local State 的资料名称和所选资料的 Bookmarks 文件。文件来源不能写入 Chrome。</p>
              {choices.length > 0 && <ul className="mirror-tree">{choices.map((choice) => <li key={choice.directoryKey}>
                <span>{choice.displayName}</span>
                <span className="secondary"> {choice.directoryKey}</span>
                <button type="button" disabled={unavailable || !choice.bookmarksPresent} onClick={() => { void act(async () => { accept(await attachFileMirror(listedPath, choice.directoryKey)); }); }}>{choice.bookmarksPresent ? '接入只读镜像' : '未找到书签文件'}</button>
              </li>)}</ul>}
              </details>
              {!state?.mirrors.length && <p className="secondary">尚未接入只读文件来源。Chrome 关闭后，已接入的最后有效树仍可浏览。</p>}
              {state?.mirrors.map((mirror) => <article className="profile" key={mirror.mirrorSourceId}>
                <div className="panel-heading"><h3>{mirror.displayName}</h3><span className="source-state">{associationLabels[mirror.association]} · {mirror.watching ? '正在监听' : '已停止监听'}</span></div>
                <dl className="profile-metrics">
                  <div><dt>文件状态</dt><dd>{fileLabels[mirror.fileStatus]}</dd></div>
                  <div><dt>缓存节点</dt><dd>{mirror.nodeCount}</dd></div>
                  <div><dt>缓存版本</dt><dd>{mirror.revision}</dd></div>
                  <div><dt>最近读取</dt><dd>{cacheTime(mirror.lastSyncedAt)}</dd></div>
                </dl>
                {mirror.errorCode && <p className="secondary">{mirrorProblem(mirror.errorCode)}</p>}
                <p className="secondary">浏览器写入已禁用。在线资料优先于已关联的文件来源。</p>
                <div className="actions">
                  <button type="button" disabled={unavailable} onClick={() => onBrowseSource({ kind: 'mirror', id: mirror.mirrorSourceId })}>浏览缓存</button>
                  <button type="button" className="secondary-button" disabled={unavailable || !mirror.watching} onClick={() => { void act(async () => { accept(await detachFileMirror(mirror.mirrorSourceId)); }); }}>停止监听</button>
                </div>
                {!!state.profiles.length && <form className="inline-form" onSubmit={(event) => {
                  event.preventDefault();
                  if (!profileChoice) { setMessage('请选择要验证的已配对资料。'); return; }
                  void act(async () => { accept(await associateFileMirror(mirror.mirrorSourceId, profileChoice)); }, '文件与在线资料不一致，保持独立只读。');
                }}>
                  <label htmlFor={`associate-${mirror.mirrorSourceId}`}>已配对资料<select id={`associate-${mirror.mirrorSourceId}`} value={profileChoice} onChange={(event) => setProfileChoice(event.target.value)} disabled={unavailable || mirror.fileStatus !== 'current'}>
                    <option value="">选择已配对资料</option>
                    {state.profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName}</option>)}
                  </select></label>
                  <button type="submit" disabled={unavailable || mirror.fileStatus !== 'current' || !profileChoice}>验证关联</button>
                </form>}
              </article>)}
            </section>
    {revoke && <ConfirmDialog title={`吊销“${revoke.displayName}”的配对？`} confirmLabel="确认吊销配对" onCancel={() => setRevoke(null)} onConfirm={() => {
      const id = revoke.profileId;
      setRevoke(null);
      void act(async () => { accept(await revokePairing(id)); });
    }}><p>此扩展将不能继续同步或修改这份资料。Chrome 书签、本机缓存、标签和备注都会保留。</p><p>重新连接需要在桌面与扩展重新配对；旧凭据不会恢复。</p></ConfirmDialog>}
  </div>;
}
