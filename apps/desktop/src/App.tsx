import { useRef, useState } from 'react';
import { hasNativeBridge } from './backend';
import { AiSettings } from './features/ai/AiSettings';
import { SemanticSettings } from './features/semantic/SemanticSettings';
import { LibraryWorkspace } from './features/library/LibraryWorkspace';
import { WorkspaceIcon, type IconName } from './features/library/WorkspaceIcon';
import { ConnectionSettings } from './features/settings/ConnectionSettings';
import { useBridge } from './useBridge';
import { connectionLabels, fileLabels, type SourceRequest, type SourceTarget } from './features/settings/source-status';

type Section = 'library' | 'organize' | 'semantic' | 'history' | 'settings';
type SettingsTab = 'connection' | 'ai' | 'semantic' | 'export';
const sections: { id: Section; label: string; icon: IconName }[] = [
  { id: 'library', label: '书签', icon: 'bookmark' },
  { id: 'organize', label: '整理', icon: 'organize' },
  { id: 'semantic', label: '语义检索', icon: 'search' },
  { id: 'history', label: '操作历史', icon: 'history' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

export function App() {
  const { state, error, accept } = useBridge();
  const native = hasNativeBridge();
  const [section, setSection] = useState<Section>('library');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connection');
  const [visitedSettings, setVisitedSettings] = useState(false);
  const [visitedAi, setVisitedAi] = useState(false);
  const [visitedSemantic, setVisitedSemantic] = useState(false);
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | null>(null);
  const [currentSource, setCurrentSource] = useState<SourceTarget | null>(null);
  const [sidebarHost, setSidebarHost] = useState<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = sections.find((item) => item.id === section)!.label;
  const selectedProfile = currentSource?.kind === 'profile' ? state?.profiles.find((profile) => profile.profileId === currentSource.id) : !currentSource ? state?.profiles[0] : undefined;
  const selectedMirror = currentSource?.kind === 'mirror' ? state?.mirrors.find((mirror) => mirror.mirrorSourceId === currentSource.id) : !currentSource && !selectedProfile ? state?.mirrors[0] : undefined;
  const connection = error === 'startup' ? '启动失败' : error === 'event' ? '连接错误 · 只读'
    : !state ? '正在加载' : selectedProfile?.connection === 'live' ? '已连接 Chrome'
      : selectedProfile?.connection === 'cached_read_only' ? '未连接 · 只读'
        : selectedProfile ? connectionLabels[selectedProfile.connection]
          : selectedMirror ? `${fileLabels[selectedMirror.fileStatus]} · 只读` : '未连接 · 只读';
  const onboarding = section === 'library' && !!state && !state.profiles.length && !state.mirrors.length;

  function browseSource(source: SourceTarget) {
    setSourceRequest((previous) => ({ ...source, request: (previous?.request ?? 0) + 1 }));
    navigate('library');
  }

  function chooseSettingsTab(tab: SettingsTab) {
    setSettingsTab(tab);
    if (tab === 'ai') setVisitedAi(true);
    if (tab === 'semantic') setVisitedSemantic(true);
  }

  function navigate(next: Section) {
    setSection(next);
    if (next === 'settings') setVisitedSettings(true);
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <div className="workspace" lang="zh-CN">
    <a className="skip-link" href="#main-content">跳至内容</a>
    <aside className="app-sidebar" aria-label="工作区导航">
      <div className="brand"><span className="brand-mark"><WorkspaceIcon name="bookmark" /></span><strong lang="en">Markbridge</strong></div>
      <nav aria-label="主导航">
        {sections.slice(0, 1).map((item) => <button type="button" className="nav-button" key={item.id} aria-current={section === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => navigate(item.id)}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-library" ref={setSidebarHost} />
      <nav className="secondary-navigation" aria-label="更多工作区">
        {sections.slice(1).map((item) => <button type="button" className="nav-button" key={item.id} aria-current={section === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => navigate(item.id)}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
    </aside>
    <main id="main-content" className="app-main" tabIndex={-1}>
      <header className="workspace-heading"><h1 ref={heading} tabIndex={-1}>{title}</h1><span className="connection" role="status">{connection}</span></header>
      {error === 'startup' ? <section className="empty-state" role="alert"><h2>无法读取启动状态</h2><p>请关闭窗口后重新打开应用。</p></section> : <>
        {error === 'event' && <p className="notice global-notice" role="alert">收到无效连接状态。请重新打开应用。</p>}
        <LibraryWorkspace state={state} invalid={error === 'event'} native={native} focusMirrorId={null} sourceRequest={sourceRequest} onCurrentSource={setCurrentSource}
          section={section === 'settings' ? 'export' : section} active={!onboarding && (section !== 'settings' || settingsTab === 'export')}
          sidebarHost={sidebarHost} onSettings={() => { setSettingsTab('connection'); navigate('settings'); }} onLibrary={() => navigate('library')}
          onExport={() => { chooseSettingsTab('export'); navigate('settings'); }} onOrganize={() => navigate('organize')}
          onSemanticSettings={() => { chooseSettingsTab('semantic'); navigate('settings'); }}
          onAiSettings={() => { chooseSettingsTab('ai'); navigate('settings'); }} onHistory={() => navigate('history')} />
        <section className="settings-page" hidden={section !== 'settings' && !onboarding} aria-label={onboarding ? '首次接入' : '设置内容'}>
          <div className="settings-tabs" hidden={onboarding} role="tablist" aria-label="设置分类" onKeyDown={(event) => {
            const tabs: SettingsTab[] = ['connection', 'ai', 'semantic', 'export'];
            const current = tabs.indexOf(settingsTab);
            const next = event.key === 'ArrowRight' ? tabs[(current + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(current + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
            if (!next) return;
            event.preventDefault();
            chooseSettingsTab(next);
            document.getElementById(`settings-tab-${next}`)?.focus();
          }}>
            {([{ id: 'connection', label: 'Chrome 连接' }, { id: 'ai', label: 'AI' }, { id: 'semantic', label: '语义检索' }, { id: 'export', label: '备份导出' }] as const).map((tab) => <button type="button" key={tab.id} role="tab" id={`settings-tab-${tab.id}`} aria-controls={`settings-panel-${tab.id}`} tabIndex={settingsTab === tab.id ? 0 : -1} aria-selected={settingsTab === tab.id} onClick={() => chooseSettingsTab(tab.id)}>{tab.label}</button>)}
          </div>
          <div className="settings-scroll" hidden={!onboarding && settingsTab === 'export'}>
            {!native && <p className="preview-note">浏览器预览 · 仅显示界面。当前预览不能读取书签，请在桌面应用中连接。</p>}
            <div role="tabpanel" id="settings-panel-connection" aria-labelledby="settings-tab-connection" hidden={!onboarding && settingsTab !== 'connection'}>{(visitedSettings || onboarding) && <ConnectionSettings state={state} error={error} native={native} accept={accept} onboarding={onboarding} onBrowseSource={browseSource} />}</div>
            <div role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai" hidden={onboarding || settingsTab !== 'ai'}>{visitedAi && <AiSettings native={native} />}</div>
            <div role="tabpanel" id="settings-panel-semantic" aria-labelledby="settings-tab-semantic" hidden={onboarding || settingsTab !== 'semantic'}>{visitedSemantic && <SemanticSettings native={native} active={section === 'settings' && settingsTab === 'semantic'} />}</div>
          </div>
        </section>
      </>}
      <footer className="status-bar"><span>书签保留在 Chrome</span><span>标签和备注保留在本机</span></footer>
    </main>
  </div>;
}
