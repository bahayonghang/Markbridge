import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BridgeState, ChromeProfileList } from '@markbridge/protocol';
import { DiagnosticExport } from './DiagnosticExport';
import {
  associateFileMirror, attachFileMirror,
  detachFileMirror, ensureLocalLibrary, enumerateChromeUserData,
  ignoreProfile, reconnectProfile, rescanFileMirrors, retryBridgeListener,
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
  if (code === 'STORAGE_ERROR') return '本机存储不可用。请检查缓存权限及系统凭据服务是否已解锁，再重试。';
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState('');
  const [choices, setChoices] = useState<ChromeProfileList['profiles']>([]);
  const [profileChoice, setProfileChoice] = useState('');
  const [path, setPath] = useState<'connect' | 'readonly'>('connect');
  const [revoke, setRevoke] = useState<BridgeState['profiles'][number] | null>(null);
  const [listedPath, setListedPath] = useState('');
  const mounted = useRef(false);
  const actionGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionGeneration.current += 1; };
  }, []);

  async function act(work: () => Promise<void>, failure = '操作未完成。请检查连接状态后重试。') {
    if (busy || !native) return;
    const generation = ++actionGeneration.current;
    setBusy(true);
    setMessage(null);
    try { await work(); } catch (code) {
      if (mounted.current && generation === actionGeneration.current) {
        setMessage(code === 'STORAGE_ERROR' ? safeError(code) : failure);
      }
    } finally {
      if (mounted.current && generation === actionGeneration.current) setBusy(false);
    }
  }

  function start(event: FormEvent) {
    event.preventDefault();
    void act(async () => { accept(await retryBridgeListener()); }, '无法启动本机连接。请检查端口是否占用，或更换端口后重试。');
  }

  const pairedChromeProfiles = state?.profiles.filter((profile) => profile.connection !== 'local') ?? [];
  const hasLocalLibrary = !!state?.profiles.some((profile) => profile.connection === 'local');
  const unavailable = !native || busy || !state || error === 'event';
  const hasSources = !!(state?.profiles.length || state?.mirrors.length);
  const setup = (
    <div key="setup" className="connection-setup" hidden={onboarding && path !== 'connect'}>
    {hasSources && !onboarding && <h2 className="settings-group-title">接入新的 Chrome 资料</h2>}
    <details className="connection-panel extension-instructions" open={!hasSources}>
      <summary><h2 id="extension-title">1. 准备 Chrome 扩展</h2></summary>
      <p>在要接入的 Chrome 资料中打开 <code>chrome://extensions</code>，启用开发者模式，选择“加载已解压的扩展程序”，选择 Markbridge 扩展目录。</p>
      <p className="secondary">加载后扩展将直接自动探测本地端口连接，无需复制配对串。</p>
      <details className="connection-advanced"><summary>开发构建：扩展目录</summary><p className="secondary">从源码构建时，扩展目录为 <code>apps/extension/dist</code>。开发和验收请使用单独的临时 Chrome 资料。</p></details>
    </details>
            <section className="connection-panel" aria-labelledby="listener-title">
              <div className="panel-heading"><h2 id="listener-title">2. 启动本机连接</h2><span className="secondary">{state?.port ? `127.0.0.1:${state.port}` : '监听尚未启动'}</span></div>
              <form className="inline-form" onSubmit={start} noValidate>
                <details className="connection-advanced"><summary>高级：连接端口</summary><label htmlFor="bridge-port">端口<input id="bridge-port" inputMode="numeric" value={state?.port?.toString() ?? '49153'} readOnly disabled /></label></details>
                <button disabled={unavailable || state?.port != null} type="submit">{state?.port ? '连接已启动' : '启动连接'}</button>
              </form>
              <p className="secondary">默认端口 49153。端口占用时，更换端口后重试。</p>
            </section>
    </div>
  );
  const sources = (
    <div key="sources" className="connection-sources">
            <section className="connection-panel" aria-labelledby="profiles-title" hidden={!state?.profiles.length}>
              <div className="panel-heading"><h2 id="profiles-title">已配对资料</h2><span className="secondary">{state?.profiles.length ?? 0} 个资料</span></div>
              {!state?.profiles.length ? <p className="secondary">尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。</p> : state.profiles.map((profile) => {
                const isLocal = profile.connection === 'local';
                return <article className="profile" key={profile.profileId}>
                  <div className="panel-heading"><h3>{profile.displayName}</h3><span className="source-state">{error === 'event' ? '状态无效 · 只读' : connectionLabels[profile.connection]}</span></div>
                  <dl className="profile-metrics"><div><dt>缓存节点</dt><dd>{profile.nodeCount}</dd></div><div><dt>来源版本</dt><dd>{profile.revision}</dd></div><div><dt>最近同步</dt><dd>{cacheTime(profile.lastSyncedAt)}</dd></div></dl>
                  {profile.errorCode && <p className="secondary">{safeError(profile.errorCode)}</p>}
                  <p className="secondary">{profileNextStep(profile.connection)}</p>
                  <div className="actions">
                    <button type="button" disabled={unavailable} onClick={() => onBrowseSource({ kind: 'profile', id: profile.profileId })}>浏览此资料</button>
                    {!isLocal && <button disabled={unavailable || profile.connection === 'ignored'} onClick={() => { void act(async () => { accept(await reconnectProfile(profile.profileId)); }); }}>重新连接</button>}
                    {!isLocal && <button className="secondary-button" disabled={unavailable || profile.connection === 'ignored'} onClick={() => setRevoke(profile)}>吊销配对</button>}
                  </div>
                </article>;
              })}
            </section>
            <section className="connection-panel" aria-labelledby="local-library-title" hidden={onboarding || hasLocalLibrary}>
              <div className="panel-heading"><h2 id="local-library-title">本地 Skills 书签库</h2><span className="secondary">独立 SQLite 空间</span></div>
              <p className="secondary">启用本机专属书签空间（Skills 书签），可由项目 Skills 或命令行直接维护，不会同步或写回 Chrome。</p>
              <div className="actions">
                <button type="button" disabled={unavailable} onClick={() => {
                  void act(async () => {
                    const next = await ensureLocalLibrary();
                    accept(next);
                    const created = next.profiles.find((profile) => profile.connection === 'local');
                    if (created) onBrowseSource({ kind: 'profile', id: created.profileId });
                  }, '无法启用本地 Skills 书签库。请检查本机存储状态后重试。');
                }}>启用本地 Skills 书签库</button>
              </div>
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
                {pairedChromeProfiles.length > 0 && <form className="inline-form" onSubmit={(event) => {
                  event.preventDefault();
                  if (!profileChoice) { setMessage('请选择要验证的已配对资料。'); return; }
                  void act(async () => { accept(await associateFileMirror(mirror.mirrorSourceId, profileChoice)); }, '文件与在线资料不一致，保持独立只读。');
                }}>
                  <label htmlFor={`associate-${mirror.mirrorSourceId}`}>已配对资料<select id={`associate-${mirror.mirrorSourceId}`} value={profileChoice} onChange={(event) => setProfileChoice(event.target.value)} disabled={unavailable || mirror.fileStatus !== 'current'}>
                    <option value="">选择已配对资料</option>
                    {pairedChromeProfiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName}</option>)}
                  </select></label>
                  <button type="submit" disabled={unavailable || mirror.fileStatus !== 'current' || !profileChoice}>验证关联</button>
                </form>}
              </article>)}
            </section>
    <DiagnosticExport native={native} />
    </div>
  );
  return <div className={`connection-settings ${hasSources ? 'has-sources' : 'first-connection'}`}>
    {onboarding && <div className="onboarding-intro">
      <h2>连接你的 Chrome 书签</h2>
      <p>连接扩展后可实时查看和管理书签。无需配置 AI。</p>
      <div className="actions"><button type="button" aria-pressed={path === 'connect'} onClick={() => setPath('connect')}>连接 Chrome</button><button type="button" aria-pressed={path === 'readonly'} onClick={() => setPath('readonly')}>只读浏览文件</button></div>
    </div>}
    {(message || state?.errorCode) && <p className="notice" role="alert">{message ?? safeError(state?.errorCode ?? null)}</p>}
    <div className="connection-columns">{hasSources ? [sources, setup] : [setup, sources]}</div>
    {revoke && <ConfirmDialog title={`吊销“${revoke.displayName}”的配对？`} confirmLabel="确认吊销配对" onCancel={() => setRevoke(null)} onConfirm={() => {
      const id = revoke.profileId;
      setRevoke(null);
      void act(async () => { accept(await ignoreProfile(id)); });
    }}><p>此扩展将不能继续同步或修改这份资料。Chrome 书签、本机缓存、标签和备注都会保留。</p><p>重新连接需要在桌面与扩展重新配对；旧凭据不会恢复。</p></ConfirmDialog>}
  </div>;
}
