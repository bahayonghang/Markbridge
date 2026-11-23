import { useLayoutEffect, useRef, useState } from 'react';
import { hasNativeBridge, setWindowTheme } from './backend';
import { AiSettings } from './features/ai/AiSettings';
import { SemanticSettings } from './features/semantic/SemanticSettings';
import { LibraryWorkspace } from './features/library/LibraryWorkspace';
import { WorkspaceIcon, type IconName } from './features/library/WorkspaceIcon';
import { ConnectionSettings } from './features/settings/ConnectionSettings';
import { SettingsWorkspace, type SettingsTab } from './features/settings/SettingsWorkspace';
import { GeneralSettings } from './features/settings/GeneralSettings';
import { resolveAppearanceMetrics, applyUiPreferences, readUiPreferences, saveUiPreferences, type UiPreferences } from './features/settings/ui-preferences';
import { RowHeightsContext } from './features/library/VirtualRows';
import { useBridge } from './useBridge';
import { connectionStatusLabels, resolveSource, type SourceRequest, type SourceTarget } from './features/settings/source-status';

const brandIcon = new URL('./assets/markbridge.png', import.meta.url).href;
type Section = 'library' | 'organize' | 'semantic' | 'history' | 'settings';
const sections: { id: Section; label: string; icon: IconName }[] = [
  { id: 'library', label: '书签', icon: 'bookmark' },
  { id: 'organize', label: '整理', icon: 'organize' },
  { id: 'semantic', label: '语义检索', icon: 'search' },
  { id: 'history', label: '操作历史', icon: 'history' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

export function App({ initialPreferences }: { initialPreferences?: UiPreferences } = {}) {
  const [preferences, setPreferences] = useState(() => initialPreferences ?? readUiPreferences());
  const [saveFailed, setSaveFailed] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      applyUiPreferences(preferences, media.matches);
      void setWindowTheme(preferences.theme);
    };
    apply();
    if (preferences.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences]);
  function changePreferences(next: UiPreferences) {
    setPreferences(next);
    setSaveFailed(!saveUiPreferences(next));
  }
  const { state, error, accept } = useBridge();
  const native = hasNativeBridge();
  const [section, setSection] = useState<Section>('library');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [visitedSettings, setVisitedSettings] = useState(false);
  const [visitedAi, setVisitedAi] = useState(false);
  const [visitedSemantic, setVisitedSemantic] = useState(false);
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | null>(null);
  const [currentSource, setCurrentSource] = useState<SourceTarget | null>(null);
  const [sidebarHost, setSidebarHost] = useState<HTMLDivElement | null>(null);
  const [exportHost, setExportHost] = useState<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = sections.find((item) => item.id === section)!.label;
  const fallbackSource = currentSource ? null : resolveSource(state, null, null);
  const selectedProfile = currentSource?.kind === 'profile'
    ? state?.profiles.find((profile) => profile.profileId === currentSource.id)
    : fallbackSource?.kind === 'profile' ? fallbackSource.profile : undefined;
  const selectedMirror = currentSource?.kind === 'mirror'
    ? state?.mirrors.find((mirror) => mirror.mirrorSourceId === currentSource.id)
    : fallbackSource?.kind === 'mirror' ? fallbackSource.mirror : undefined;
  const { header: connection, pill: pillConnection } = connectionStatusLabels(state, error, selectedProfile, selectedMirror);
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

  return <RowHeightsContext.Provider value={resolveAppearanceMetrics(preferences.fontSizePx)}><div className="workspace" lang="zh-CN">
    <a className="skip-link" href="#main-content">跳至内容</a>
    <aside className="app-sidebar" aria-label="工作区导航">
      <div className="brand"><img className="brand-mark" src={brandIcon} alt="" width={32} height={32} /><strong lang="en">Markbridge</strong></div>
      <nav className="primary-navigation" aria-label="主导航">
        {sections.map((item) => <button type="button" className="nav-button" key={item.id} aria-current={section === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => { if (item.id === 'settings') chooseSettingsTab('general'); navigate(item.id); }}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-library" ref={setSidebarHost} hidden={section !== 'library'} />
      <button type="button" className="connection-pill" aria-label={`连接状态：${pillConnection}`} title={pillConnection} onClick={() => { chooseSettingsTab('connection'); navigate('settings'); }}><WorkspaceIcon name="connection" /><span>{pillConnection}</span></button>
    </aside>
    <main id="main-content" className="app-main" tabIndex={-1}>
      <header className="workspace-heading"><h1 ref={heading} tabIndex={-1}>{title}</h1><span className="connection" role="status">{connection}</span></header>
      {error === 'startup' ? <section className="empty-state" role="alert"><h2>无法读取启动状态</h2><p>请关闭窗口后重新打开应用。</p></section> : <>
        {error === 'event' && <p className="notice global-notice" role="alert">收到无效连接状态。请重新打开应用。</p>}
        <LibraryWorkspace state={state} invalid={error === 'event'} native={native} focusMirrorId={null} sourceRequest={sourceRequest} onCurrentSource={setCurrentSource}
          section={section === 'settings' ? 'export' : section} active={!onboarding && (section !== 'settings' || settingsTab === 'export')}
          sidebarHost={sidebarHost} exportHost={exportHost} onSettings={() => { setSettingsTab('connection'); navigate('settings'); }} onLibrary={() => navigate('library')}
          onExport={() => { chooseSettingsTab('export'); navigate('settings'); }} onOrganize={() => navigate('organize')}
          onSemanticSettings={() => { chooseSettingsTab('semantic'); navigate('settings'); }}
          onAiSettings={() => { chooseSettingsTab('ai'); navigate('settings'); }} onHistory={() => navigate('history')} />
        <SettingsWorkspace active={section === 'settings'} onboarding={onboarding} tab={settingsTab} onTab={chooseSettingsTab}>
            {!native && <p className="preview-note">浏览器预览 · 仅显示界面。当前预览不能读取书签，请在桌面应用中连接。</p>}
            <div role="tabpanel" tabIndex={0} id="settings-panel-general" aria-labelledby="settings-tab-general" hidden={onboarding || settingsTab !== 'general'}><GeneralSettings value={preferences} saveFailed={saveFailed} onChange={changePreferences} /></div>
            <div role={onboarding ? undefined : 'tabpanel'} tabIndex={0} id="settings-panel-connection" aria-labelledby={onboarding ? undefined : 'settings-tab-connection'} hidden={!onboarding && settingsTab !== 'connection'}>{(visitedSettings || onboarding) && <ConnectionSettings state={state} error={error} native={native} accept={accept} onboarding={onboarding} onBrowseSource={browseSource} />}</div>
            <div role="tabpanel" tabIndex={0} id="settings-panel-ai" aria-labelledby="settings-tab-ai" hidden={onboarding || settingsTab !== 'ai'}>{visitedAi && <AiSettings native={native} />}</div>
            <div role="tabpanel" tabIndex={0} id="settings-panel-semantic" aria-labelledby="settings-tab-semantic" hidden={onboarding || settingsTab !== 'semantic'}>{visitedSemantic && <SemanticSettings native={native} active={section === 'settings' && settingsTab === 'semantic'} />}</div>
            <div role="tabpanel" tabIndex={0} id="settings-panel-export" aria-labelledby="settings-tab-export" hidden={onboarding || settingsTab !== 'export'}><div className="settings-export-host" ref={setExportHost} /></div>
        </SettingsWorkspace>
      </>}
    </main>
  </div></RowHeightsContext.Provider>;
}
