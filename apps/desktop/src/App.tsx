import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasNativeBridge, setWindowTheme } from './backend';
import { AiSettings } from './features/ai/AiSettings';
import { SemanticSettings } from './features/semantic/SemanticSettings';
import { LibraryWorkspace } from './features/library/LibraryWorkspace';
import { WorkspaceIcon, type IconName } from './features/library/WorkspaceIcon';
import { ConnectionSettings } from './features/settings/ConnectionSettings';
import { SettingsWorkspace, type SettingsTab } from './features/settings/SettingsWorkspace';
import { GeneralSettings } from './features/settings/GeneralSettings';
import { resolveAppearanceMetrics, applyUiPreferences, readUiPreferences, saveUiPreferences, type UiPreferences } from './features/settings/ui-preferences';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH_PX, maxSidebarWidth, MIN_SIDEBAR_WIDTH_PX, readLayoutPreferences, saveLayoutPreferences, type LayoutPreferences } from './features/settings/layout-preferences';
import { RowHeightsContext } from './features/library/VirtualRows';
import { useBridge } from './useBridge';
import { connectionStatusLabels, resolveSource, type SourceRequest, type SourceTarget } from './features/settings/source-status';

type DragState = { pointerId: number; startX: number; startWidth: number; element: HTMLDivElement };

function isEditableElement(node: unknown): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (node.isContentEditable) return true;
  return !!node.closest('[contenteditable]:not([contenteditable="false"])');
}

function releaseDragCapture(drag: DragState) {
  try {
    if (drag.element.hasPointerCapture?.(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  } catch {
    // Ignore environments without active pointer capture.
  }
}

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
  const [layoutPrefs, setLayoutPrefs] = useState<LayoutPreferences>(() => readLayoutPreferences());
  const layoutPrefsRef = useRef(layoutPrefs);
  layoutPrefsRef.current = layoutPrefs;
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);

  function commitLayoutPrefs(updater: (current: LayoutPreferences) => LayoutPreferences) {
    const next = updater(layoutPrefsRef.current);
    layoutPrefsRef.current = next;
    setLayoutPrefs(next);
    saveLayoutPreferences(next);
  }

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        const drag = dragRef.current;
        dragRef.current = null;
        releaseDragCapture(drag);
        setDragWidth(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        if (dragRef.current !== null || window.innerWidth < 800) return;
        if (isEditableElement(event.target) || isEditableElement(document.activeElement)) return;
        event.preventDefault();
        commitLayoutPrefs((current) => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const effectiveMaxWidth = maxSidebarWidth(viewport.width);
  const effectiveSidebarWidth = clampSidebarWidth(dragWidth ?? layoutPrefs.sidebarWidthPx, viewport.width);

  function toggleSidebarCollapsed() {
    commitLayoutPrefs((current) => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
  }

  function handleSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = effectiveSidebarWidth;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      element: event.currentTarget,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore environments without pointer capture support.
    }
    setDragWidth(startWidth);
  }

  function handleSplitterPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDragWidth(clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX), window.innerWidth));
  }

  function handleSplitterPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releaseDragCapture(drag);
    const finalWidth = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX), window.innerWidth);
    setDragWidth(null);
    if (finalWidth !== drag.startWidth) {
      commitLayoutPrefs((current) => ({ ...current, sidebarWidthPx: finalWidth }));
    }
  }

  function handleSplitterPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releaseDragCapture(drag);
    setDragWidth(null);
  }

  function handleSplitterDoubleClick() {
    if (dragRef.current) {
      releaseDragCapture(dragRef.current);
      dragRef.current = null;
    }
    setDragWidth(null);
    const resetWidth = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH_PX, window.innerWidth);
    commitLayoutPrefs((current) => ({ ...current, sidebarWidthPx: resetWidth }));
  }

  function handleSplitterKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = clampSidebarWidth(effectiveSidebarWidth - step, window.innerWidth);
    else if (event.key === 'ArrowRight') nextWidth = clampSidebarWidth(effectiveSidebarWidth + step, window.innerWidth);
    else if (event.key === 'Home') nextWidth = clampSidebarWidth(MIN_SIDEBAR_WIDTH_PX, window.innerWidth);
    else if (event.key === 'End') nextWidth = effectiveMaxWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    commitLayoutPrefs((current) => ({ ...current, sidebarWidthPx: nextWidth }));
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
  const isIconRail = layoutPrefs.sidebarCollapsed || viewport.width < 800;

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

  return <RowHeightsContext.Provider value={resolveAppearanceMetrics(preferences.fontSizePx)}><div className={`workspace${layoutPrefs.sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${dragWidth !== null ? ' is-resizing-sidebar' : ''}`} style={{ '--sidebar-width': `${effectiveSidebarWidth}px` } as CSSProperties} lang="zh-CN">
    <a className="skip-link" href="#main-content">跳至内容</a>
    <aside id="app-sidebar" className="app-sidebar" aria-label="工作区导航">
      <div className="brand">
        <img className="brand-mark" src={brandIcon} alt="" width={32} height={32} />
        <strong lang="en">Markbridge</strong>
        <button
          type="button"
          className="icon-button sidebar-collapse-button"
          aria-label={layoutPrefs.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!layoutPrefs.sidebarCollapsed}
          aria-controls="app-sidebar"
          title={layoutPrefs.sidebarCollapsed ? '展开侧栏 (Ctrl+B)' : '收起侧栏 (Ctrl+B)'}
          onClick={toggleSidebarCollapsed}
        >
          <WorkspaceIcon name={layoutPrefs.sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'} />
        </button>
      </div>
      <nav className="primary-navigation" aria-label="主导航">
        {sections.map((item) => <button type="button" className="nav-button" key={item.id} aria-current={section === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => { if (item.id === 'settings') chooseSettingsTab('general'); navigate(item.id); }}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-library" ref={setSidebarHost} hidden={section !== 'library'} />
      <button type="button" className="connection-pill" aria-label={`连接状态：${pillConnection}`} title={pillConnection} onClick={() => { chooseSettingsTab('connection'); navigate('settings'); }}><WorkspaceIcon name="connection" /><span>{pillConnection}</span></button>
    </aside>
    <div
      className={`sidebar-splitter${dragWidth !== null ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-controls="app-sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH_PX}
      aria-valuemax={effectiveMaxWidth}
      aria-valuenow={effectiveSidebarWidth}
      tabIndex={0}
      onPointerDown={handleSplitterPointerDown}
      onPointerMove={handleSplitterPointerMove}
      onPointerUp={handleSplitterPointerUp}
      onPointerCancel={handleSplitterPointerCancel}
      onDoubleClick={handleSplitterDoubleClick}
      onKeyDown={handleSplitterKeyDown}
    />
    <main id="main-content" className="app-main" tabIndex={-1}>
      <header className="workspace-heading"><h1 ref={heading} tabIndex={-1}>{title}</h1><span className={`connection${isIconRail ? '' : ' visually-hidden'}`} role="status">{connection}</span></header>
      {error === 'startup' ? <section className="empty-state" role="alert"><h2>无法读取启动状态</h2><p>请关闭窗口后重新打开应用。</p></section> : <>
        {error === 'event' && <p className="notice global-notice" role="alert">收到无效连接状态。请重新打开应用。</p>}
        <LibraryWorkspace state={state} invalid={error === 'event'} native={native} focusMirrorId={null} sourceRequest={sourceRequest} onCurrentSource={setCurrentSource}
          section={section === 'settings' ? 'export' : section} active={!onboarding && (section !== 'settings' || settingsTab === 'export')}
          sidebarCollapsed={layoutPrefs.sidebarCollapsed}
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
