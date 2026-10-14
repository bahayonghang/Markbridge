import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type SettingsTab = 'general' | 'connection' | 'ai' | 'semantic' | 'export';
const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'connection', label: 'Chrome 连接' }, { id: 'ai', label: 'AI' },
  { id: 'semantic', label: '语义检索' }, { id: 'export', label: '备份导出' },
];

export function SettingsWorkspace({ active, onboarding, tab, onTab, children }: {
  active: boolean; onboarding: boolean; tab: SettingsTab;
  onTab: (tab: SettingsTab) => void; children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [tab, onboarding]);
  return <section className={onboarding ? 'onboarding-page' : 'settings-page'} hidden={!active && !onboarding} aria-label={onboarding ? '首次接入' : '设置内容'}>
    <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation="vertical" hidden={onboarding}>
      {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`settings-tab-${item.id}`} aria-controls={`settings-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => onTab(item.id)} onKeyDown={event => {
          const next = event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); onTab(tabs[next].id);
          document.getElementById(`settings-tab-${tabs[next].id}`)?.focus();
        }}>{item.label}</button>)}
    </div>
    <div className="settings-scroll" ref={scroller}><div className="settings-content">{children}</div></div>
  </section>;
}
