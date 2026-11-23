import { useEffect, useRef, useState } from 'react';
import type { InstalledFontCatalog } from '@markbridge/protocol';
import { DEFAULT_UI_PREFERENCES, fontPresetLabels, validFontSize, type UiPreferences } from './ui-preferences';
import { createFontCatalogSession } from './font-catalog';
import { FontPicker } from './FontPicker';

export function GeneralSettings({ value, saveFailed, onChange }: {
  value: UiPreferences; saveFailed: boolean; onChange: (value: UiPreferences) => void;
}) {
  const [session] = useState(createFontCatalogSession);
  const [picker, setPicker] = useState(false);
  const [catalog, setCatalog] = useState<InstalledFontCatalog | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [sizeInput, setSizeInput] = useState(String(value.fontSizePx));
  const [sizeError, setSizeError] = useState(false);
  useEffect(() => { setSizeInput(String(value.fontSizePx)); setSizeError(false); }, [value.fontSizePx]);
  function commitSize() {
    const number = Number(sizeInput);
    if (!sizeInput.trim() || !validFontSize(number)) { setSizeError(true); return; }
    setSizeError(false); setSizeInput(String(number));
    if (number !== value.fontSizePx) onChange({ ...value, fontSizePx: number });
  }
  const missingFont = value.font.kind === 'installed' && catalog?.status === 'ready' && !catalog.families.some(font => value.font.kind === 'installed' && font.family.toLowerCase() === value.font.family.toLowerCase());
  return <section className="general-settings" aria-labelledby="general-title">
    <div className="page-intro"><h2 id="general-title">通用</h2></div>
    <div className="well-group">
      <div className="settings-row"><div><h3 id="theme-label">主题</h3></div>
        <div className="segmented-control theme-options" role="group" aria-labelledby="theme-label">
          {(['system', 'light', 'dark'] as const).map((theme, index) => <button type="button" key={theme} aria-pressed={value.theme === theme} onClick={() => onChange({ ...value, theme })}>{['跟随系统', '浅色', '深色'][index]}</button>)}
        </div>
      </div>
      <div className="settings-row"><div><h3>字体</h3></div>
        <div className="font-setting"><span id="ui-font-current">{value.font.kind === 'preset' ? fontPresetLabels[value.font.value] : value.font.family}</span><button ref={trigger} type="button" aria-describedby="ui-font-current" onClick={() => setPicker(true)}>选择字体</button></div>
      </div>
      {missingFont && <p role="status">所选字体当前不可用，已使用备用字体。</p>}
      <div className="settings-row"><div><label htmlFor="ui-font-size">字号</label><p>同步调整文字、控件和书签行的大小。</p></div>
        <div className="font-size-controls">
          <div className="font-size-row">
            <div className="font-size-input"><input id="ui-font-size" inputMode="numeric" value={sizeInput} aria-invalid={sizeError || undefined} aria-describedby="font-size-help" onChange={event => setSizeInput(event.target.value)} onBlur={commitSize} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitSize(); } else if (event.key === 'Escape') { setSizeInput(String(value.fontSizePx)); setSizeError(false); } }} /><span>px</span></div>
            <div className="segmented-control font-size-options" role="group" aria-label="常用字号">{[13, 14, 16].map(fontSizePx => <button key={fontSizePx} type="button" aria-pressed={value.fontSizePx === fontSizePx} onClick={() => { setSizeInput(String(fontSizePx)); setSizeError(false); if (fontSizePx !== value.fontSizePx) onChange({ ...value, fontSizePx }); }}>{fontSizePx} px</button>)}</div>
          </div>
          <p id="font-size-help" className={sizeError ? 'notice' : 'secondary'} role={sizeError ? 'alert' : undefined}>{sizeError ? '请输入 12–20 之间的整数；当前字号保持不变。' : '12–20 px，按 Enter 或离开输入框应用。'}</p>
        </div>
      </div>
    </div>
    <section className="well-group appearance-sample" aria-labelledby="appearance-sample-title"><h3 id="appearance-sample-title">文字样例</h3><p>让书签与灵感保持相连。</p><p lang="en">Markbridge Bookmarks 0123456789</p></section>
    <div className="settings-actions"><button type="button" onClick={() => { setSizeInput(String(DEFAULT_UI_PREFERENCES.fontSizePx)); setSizeError(false); onChange({ ...DEFAULT_UI_PREFERENCES }); }}>恢复默认外观</button><p className="secondary">仅重置主题、字体和字号。</p></div>
    {saveFailed && <p role="alert">当前外观已应用，但未能保存。重启后可能恢复默认。</p>}
    {picker && <FontPicker value={value.font} fontSizePx={value.fontSizePx} session={session} returnFocus={trigger} onCatalog={setCatalog} onCancel={() => setPicker(false)} onApply={font => { onChange({ ...value, font }); setPicker(false); }} />}
  </section>;
}
