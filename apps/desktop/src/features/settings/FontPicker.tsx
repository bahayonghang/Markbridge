import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { InstalledFontCatalog } from '@markbridge/protocol';
import { VirtualRows } from '../library/VirtualRows';
import { fontFamilyCss, fontPresetLabels, resolveAppearanceMetrics, type UiFont } from './ui-preferences';
import type { FontCatalogSession } from './font-catalog';

export function FontPicker({ value, fontSizePx, session, returnFocus, onApply, onCancel, onCatalog }: {
  value: UiFont; fontSizePx: number; session: FontCatalogSession; returnFocus: RefObject<HTMLElement | null>;
  onApply: (font: UiFont) => void; onCancel: () => void; onCatalog: (catalog: InstalledFontCatalog) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [candidate, setCandidate] = useState(value);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState(session.peek);
  const [loading, setLoading] = useState(false);
  const callbacks = useRef({ onCatalog }); callbacks.current = { onCatalog };
  const [stableFont] = useState(() => fontFamilyCss(value));
  function read(refresh = false) {
    const request = ++generation.current;
    setLoading(true);
    void session.read(refresh).then(result => {
      if (request !== generation.current) return;
      setCatalog(result); setLoading(false); callbacks.current.onCatalog(result);
    });
  }
  useEffect(() => {
    const element = dialog.current!;
    session.retain(); element.showModal(); search.current?.focus(); read();
    return () => { generation.current += 1; session.release(); element.close(); returnFocus.current?.focus(); };
  }, [session, returnFocus]);
  const families = useMemo(() => catalog?.status === 'ready' ? [...catalog.families].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN') || a.family.localeCompare(b.family)) : [], [catalog]);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return families.filter(font => !needle || font.family.toLocaleLowerCase().includes(needle) || font.displayName.toLocaleLowerCase().includes(needle)).map((font, index) => ({ ...font, key: `font-${index}` }));
  }, [families, query]);
  const active = candidate.kind === 'installed' ? rows.find(row => row.family.toLowerCase() === candidate.family.toLowerCase()) : undefined;
  const available = candidate.kind === 'preset' || families.some(font => candidate.kind === 'installed' && font.family.toLowerCase() === candidate.family.toLowerCase());
  function choose(key: string) { const row = rows.find(row => row.key === key); if (row) setCandidate({ kind: 'installed', family: row.family }); }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = rows.findIndex(row => row.key === active?.key);
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
    if (next === null || !rows[next]) return;
    event.preventDefault(); choose(rows[next].key);
  }
  return <dialog ref={dialog} className="font-picker" aria-labelledby="font-picker-title" style={{ fontFamily: stableFont }} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="font-picker-title">选择字体</h2>
    <div className="font-picker-body">
      <section aria-labelledby="font-presets-title"><h3 id="font-presets-title">兼容预设</h3><div className="segmented-control font-presets" role="group" aria-labelledby="font-presets-title">
        {(['system', 'yahei', 'song'] as const).map(preset => <button key={preset} type="button" aria-pressed={candidate.kind === 'preset' && candidate.value === preset} onClick={() => setCandidate({ kind: 'preset', value: preset })}>{fontPresetLabels[preset]}</button>)}
      </div></section>
      <section className="installed-fonts" aria-labelledby="installed-fonts-title">
        <div className="font-catalog-heading"><h3 id="installed-fonts-title">已安装字体</h3><button type="button" disabled={loading} onClick={() => read(true)}>刷新字体列表</button></div>
        <label htmlFor="font-search">搜索已安装字体</label><input ref={search} id="font-search" type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'ArrowDown' && rows.length) { event.preventDefault(); choose(rows[0].key); requestAnimationFrame(() => document.getElementById(`library-row-${rows[0].key}`)?.focus()); }
        }} placeholder="按显示名称或字体族搜索" />
        {loading ? <p role="status">正在读取本机字体…</p> : catalog?.status === 'unavailable' ? <p role="status">{catalog.reason === 'unsupported_platform' ? '此平台暂不支持读取已安装字体。' : catalog.reason === 'catalog_limit' ? '字体目录超出可处理范围，请继续使用当前字体或兼容预设。' : '无法读取字体列表，请重试。当前字体保持不变。'}</p> : <p className="secondary" role="status">{families.length === 0 ? '未找到已安装字体，可使用兼容预设。' : rows.length === 0 ? '没有匹配的字体。' : `找到 ${rows.length} 个字体族`}</p>}
        <div className="font-catalog-list"><VirtualRows rows={rows} rowHeight={resolveAppearanceMetrics(fontSizePx).bookmarkRow} rowKey={row => row.key} label="已安装字体" role="listbox" itemRole="option" activeKey={active?.key ?? null} resetKey={query} onActive={choose} onKeyDown={navigate} render={row => <span className="font-option"><span>{row.displayName}</span>{row.displayName !== row.family && <small>{row.family}</small>}</span>} /></div>
      </section>
      <section className="well-group font-picker-sample" aria-labelledby="font-sample-title"><h3 id="font-sample-title">候选字体样例</h3><div style={{ fontFamily: fontFamilyCss(candidate) }}><p lang="zh-CN">让书签与灵感保持相连。</p><p lang="en">Markbridge Aa Bb Zz 0123456789 !?.,:;</p><p>长书签标题：阅读、设计与日常灵感的收藏与回顾</p></div><p className="secondary">未包含的中文字形会使用备用字体。</p></section>
    </div>
    <div className="actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="primary-button" disabled={!available || (loading && candidate.kind === 'installed')} onClick={() => onApply(candidate)}>使用此字体</button></div>
  </dialog>;
}
