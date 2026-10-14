import { DEFAULT_UI_PREFERENCES, type UiPreferences } from './ui-preferences';

export function GeneralSettings({ value, saveFailed, onChange }: {
  value: UiPreferences; saveFailed: boolean; onChange: (value: UiPreferences) => void;
}) {
  return <section className="general-settings" aria-labelledby="general-title">
    <div className="page-intro"><h2 id="general-title">通用</h2><p className="secondary">调整工作台的外观，选择后立即生效。</p></div>
    <div className="settings-row"><div><h3 id="theme-label">主题</h3><p>跟随系统，或固定使用浅色与深色。</p></div>
      <div className="theme-options" role="group" aria-labelledby="theme-label">
        {(['system', 'light', 'dark'] as const).map((theme, index) => <button type="button" key={theme} aria-pressed={value.theme === theme} onClick={() => onChange({ ...value, theme })}>{['跟随系统', '浅色', '深色'][index]}</button>)}
      </div>
    </div>
    <div className="settings-row"><div><label htmlFor="ui-font">字体</label><p>使用本机字体；缺少所选字体时使用备用字体。</p></div>
      <select id="ui-font" value={value.font} onChange={event => onChange({ ...value, font: event.target.value as UiPreferences['font'] })}><option value="system">系统字体</option><option value="yahei">微软雅黑</option><option value="song">宋体</option></select>
    </div>
    <div className="settings-row"><div><label htmlFor="ui-font-size">字号</label><p>同步调整文字、控件和书签行的大小。</p></div>
      <select id="ui-font-size" value={value.fontSize} onChange={event => onChange({ ...value, fontSize: event.target.value as UiPreferences['fontSize'] })}><option value="small">小</option><option value="standard">标准</option><option value="large">大</option></select>
    </div>
    <section className="settings-group appearance-sample" aria-labelledby="appearance-sample-title"><h3 id="appearance-sample-title">文字样例</h3><p>让书签与灵感保持相连。</p><p lang="en">Markbridge · Bookmarks 0123456789</p></section>
    <div className="settings-group"><button type="button" onClick={() => onChange({ ...DEFAULT_UI_PREFERENCES })}>恢复默认外观</button><p className="secondary">仅重置主题、字体和字号。</p></div>
    {saveFailed && <p role="alert">当前外观已应用，但未能保存。重启后可能恢复默认。</p>}
  </section>;
}
